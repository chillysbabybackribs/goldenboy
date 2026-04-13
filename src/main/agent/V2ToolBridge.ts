import http from 'http';
import fs from 'fs';
import { agentToolExecutor } from './AgentToolExecutor';
import { formatValidationForModel } from './ConstraintValidator';
import { chatKnowledgeStore } from '../chatKnowledge/ChatKnowledgeStore';
import type { AgentToolContext } from './AgentTypes';
import type { AnyProviderId } from '../../shared/types/model';

const MAX_TOOL_RESULT_CHARS = 8_000;

function toMcpName(agentName: string): string {
  return agentName.replace(/\./g, '__');
}

function fromMcpName(mcpName: string): string {
  return mcpName.replace(/__/g, '.');
}

function readContext(contextPath: string): AgentToolContext {
  try {
    const raw = fs.readFileSync(contextPath, 'utf-8');
    return JSON.parse(raw) as AgentToolContext;
  } catch {
    return { runId: 'unknown', agentId: 'unknown', mode: 'unrestricted-dev' };
  }
}

function compactResult(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 0);
  if (!text) return '';
  return text.length > MAX_TOOL_RESULT_CHARS
    ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n...[tool result truncated]`
    : text;
}

export class V2ToolBridge {
  private server: http.Server | null = null;
  private port = 0;

  constructor(private readonly contextPath: string) {}

  getPort(): number {
    return this.port;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        void this.handleRequest(req, res);
      });
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address();
        this.port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
      this.server.on('error', reject);
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) { resolve(); return; }
      this.server.close(() => resolve());
      this.server.once('error', reject);
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const body = Buffer.concat(chunks).toString('utf-8');

    const send = (data: unknown, status = 200): void => {
      const payload = JSON.stringify(data);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(payload);
    };

    try {
      if (req.url === '/tools/list') {
        const tools = agentToolExecutor.list().map((t) => ({
          name: toMcpName(t.name),
          description: t.description,
          inputSchema: t.inputSchema,
        }));
        send({ tools });
        return;
      }

      if (req.url === '/tools/call') {
        const payload = JSON.parse(body) as { name: string; arguments: unknown; contextPath?: string };
        const toolName = fromMcpName(payload.name);
        const ctxPath = payload.contextPath || this.contextPath;
        const ctx = readContext(ctxPath);

        const result = await agentToolExecutor.execute(
          toolName as Parameters<typeof agentToolExecutor.execute>[0],
          payload.arguments,
          ctx,
        );

        if (ctx.taskId && !toolName.startsWith('chat.')) {
          chatKnowledgeStore.recordToolMessage(
            ctx.taskId,
            JSON.stringify({ tool: toolName, input: payload.arguments, result }, null, 2).slice(0, 50_000),
            ctx.agentId as AnyProviderId,
            ctx.runId,
          );
        }

        let text = compactResult(result);
        if (result.validation) {
          text += formatValidationForModel(result.validation);
        }
        send({ content: [{ type: 'text', text }] });
        return;
      }

      send({ error: 'Not found' }, 404);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      send({ content: [{ type: 'text', text: `Tool execution error: ${message}` }] });
    }
  }
}
