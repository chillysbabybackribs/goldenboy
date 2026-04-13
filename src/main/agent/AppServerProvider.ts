import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { app } from 'electron';
import {
  PRIMARY_PROVIDER_ID,
  type CodexItem,
  type ProviderId,
} from '../../shared/types/model';
import type {
  AgentProvider,
  AgentProviderRequest,
  AgentProviderResult,
  AgentToolName,
} from './AgentTypes';
import {
  DEFAULT_PROVIDER_MAX_TOOL_TURNS,
  describeProviderToolCall,
  normalizeProviderMaxToolTurns,
  publishProviderFinalOutput,
  resolveToolPackExpansion,
} from './providerToolRuntime';
import { mergeExpandedTools, resolveAutoExpandedToolPack } from './toolPacks';
import type { AppServerProcess } from './AppServerProcess';

// ─── Constants ───────────────────────────────────────────────────────────

const THREAD_FILE = 'codex-threads.json';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const TURN_TIMEOUT_MS = 3 * 60 * 1000;
const CONTEXT_PATH = path.join(os.tmpdir(), 'v2-tool-context.json');

// Use the Node 24 built-in WebSocket global via type cast.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const NativeWebSocket = (globalThis as any).WebSocket as typeof WebSocket;

// ─── Thread Registry Types ───────────────────────────────────────────────

type ThreadEntry = { threadId: string; savedAt: number };
type ThreadRegistry = Record<string, ThreadEntry>;

// ─── Thread Registry Persistence ─────────────────────────────────────────

function getThreadFilePath(): string {
  try {
    return path.join(app.getPath('userData'), THREAD_FILE);
  } catch {
    return path.join(os.tmpdir(), THREAD_FILE);
  }
}

export function pruneExpiredEntries(entries: ThreadRegistry, now: number): ThreadRegistry {
  const result: ThreadRegistry = {};
  for (const [taskId, entry] of Object.entries(entries)) {
    if (now - entry.savedAt <= SEVEN_DAYS_MS) {
      result[taskId] = entry;
    }
  }
  return result;
}

export function loadThreadRegistry(): ThreadRegistry {
  try {
    const filePath = getThreadFilePath();
    if (!fs.existsSync(filePath)) return {};
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ThreadRegistry;
    return pruneExpiredEntries(typeof parsed === 'object' && parsed ? parsed : {}, Date.now());
  } catch {
    return {};
  }
}

export function saveThreadRegistry(registry: ThreadRegistry): void {
  try {
    fs.writeFileSync(getThreadFilePath(), JSON.stringify(registry, null, 2), 'utf-8');
  } catch (err) {
    console.error('AppServerProvider: failed to persist thread registry:', err);
  }
}

// ─── MCP Name Translation ────────────────────────────────────────────────

function fromMcpName(mcpName: string): string {
  return mcpName.replace(/__/g, '.');
}

function toMcpName(toolName: string): string {
  return toolName.replace(/\./g, '__');
}

// ─── WebSocket Message Types ─────────────────────────────────────────────

type WsMsg = Record<string, unknown>;

type TurnEvent =
  | { type: 'item/agentMessage/delta'; delta: string }
  | { type: 'item/started'; itemType: string; item: WsMsg }
  | { type: 'item/completed'; itemType: string; item: WsMsg }
  | { type: 'thread/tokenUsage/updated'; last: { inputTokens: number; outputTokens: number } }
  | { type: 'turn/completed' }
  | { type: 'turn/failed'; error: { message: string } }
  | { type: string; [key: string]: unknown };

// ─── Provider Options ────────────────────────────────────────────────────

type AppServerProviderOptions = {
  providerId?: ProviderId;
  modelId?: string;
  process: AppServerProcess;
};

// ─── Provider Implementation ─────────────────────────────────────────────

export class AppServerProvider implements AgentProvider {
  readonly providerId: ProviderId;
  readonly modelId: string;
  readonly supportsAppToolExecutor = true;

  private aborted = false;
  private abortCurrentTurn: (() => void) | null = null;
  private ws: WebSocket | null = null;
  private threadRegistry: ThreadRegistry = loadThreadRegistry();

  constructor(private readonly options: AppServerProviderOptions) {
    this.providerId = options.providerId ?? PRIMARY_PROVIDER_ID;
    this.modelId = options.modelId ?? this.providerId;
  }

  abort(): void {
    this.aborted = true;
    this.abortCurrentTurn?.();
  }

  async connect(wsPort: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new NativeWebSocket(`ws://127.0.0.1:${wsPort}`);

      const timer = setTimeout(() => {
        ws.removeEventListener('message', messageHandler);
        ws.close();
        reject(new Error('AppServerProvider: initialize handshake timed out'));
      }, 30_000);

      const messageHandler = (event: MessageEvent): void => {
        try {
          const msg = JSON.parse(
            typeof event.data === 'string' ? event.data : event.data.toString(),
          ) as WsMsg;
          if (msg.type === 'initialized') {
            clearTimeout(timer);
            ws.removeEventListener('message', messageHandler);
            this.ws = ws;
            resolve();
          }
        } catch {
          // ignore parse errors during handshake
        }
      };

      ws.addEventListener('message', messageHandler);

      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({ type: 'initialize', version: '2' }));
      });

      ws.addEventListener('error', (event: Event) => {
        clearTimeout(timer);
        ws.removeEventListener('message', messageHandler);
        ws.close();
        reject(new Error(`AppServerProvider: WebSocket error during connect: ${event.type}`));
      });

      ws.addEventListener('close', () => {
        clearTimeout(timer);
        ws.removeEventListener('message', messageHandler);
        if (!this.ws) {
          reject(new Error('AppServerProvider: WebSocket closed before initialized'));
        }
      });
    });
  }

  async invoke(request: AgentProviderRequest): Promise<AgentProviderResult> {
    this.aborted = false;
    const startedAt = Date.now();
    let inputTokens = 0;
    let outputTokens = 0;
    const codexItems: CodexItem[] = [];
    let currentTools = [...request.tools];
    const toolCatalog = request.toolCatalog?.length ? request.toolCatalog : request.tools;
    const maxToolTurns = normalizeProviderMaxToolTurns(
      request.maxToolTurns ?? DEFAULT_PROVIDER_MAX_TOOL_TURNS,
    );

    const ws = this.ws;
    if (!ws) throw new Error('AppServerProvider: not connected');

    // Write context file for the MCP shim to discover tool metadata
    this.writeContextFile(request);

    // Acquire or resume a thread
    const taskId = request.taskId ?? request.runId;
    const threadId = await this.acquireThread(ws, taskId, request.systemPrompt);

    let accumulatedMessage = '';
    let nextTurnInput: string | null = null;

    // Turn loop
    for (let turn = 0; turn < maxToolTurns; turn++) {
      if (this.aborted) throw new Error('Task cancelled by user.');

      const turnInput = nextTurnInput ?? (turn === 0 ? request.task : accumulatedMessage);
      nextTurnInput = null;

      const turnResult = await this.runOneTurn(ws, {
        threadId,
        task: turnInput,
        request,
        currentTools,
        toolCatalog,
      });

      inputTokens += turnResult.inputTokens;
      outputTokens += turnResult.outputTokens;
      accumulatedMessage = turnResult.message;

      for (const item of turnResult.codexItems) {
        codexItems.push(item);
      }

      // Apply explicit tool pack expansion (from runtime.request_tool_pack)
      if (turnResult.toolPackExpanded && turnResult.expandedTools && turnResult.expansion) {
        currentTools = mergeExpandedTools(currentTools, toolCatalog, turnResult.expansion);
      }

      // Check for auto tool pack expansion
      if (turnResult.kind === 'final') {
        const autoExpansion = resolveAutoExpandedToolPack(
          turnResult.message,
          currentTools,
          toolCatalog,
        );
        if (autoExpansion) {
          currentTools = mergeExpandedTools(currentTools, toolCatalog, autoExpansion);
          request.onStatus?.(`tool-auto-expand:${autoExpansion.pack}`);
          const expandedNames = autoExpansion.scope === 'all'
            ? ['all eligible tools']
            : autoExpansion.tools;
          nextTurnInput = [
            `Host auto-expanded tool pack "${autoExpansion.pack}".`,
            `Reason: ${autoExpansion.reason}`,
            `Description: ${autoExpansion.description}`,
            `Expanded tools: ${expandedNames.join(', ')}`,
          ].join('\n');
          continue;
        }

        // Emit the final output
        const finalItem = publishProviderFinalOutput({
          request,
          itemId: `${this.itemPrefix('final')}-${Date.now()}`,
          text: turnResult.message,
          emitToken: false,
        });
        codexItems.push(finalItem);

        return {
          output: finalItem.text,
          codexItems,
          usage: {
            inputTokens,
            outputTokens,
            durationMs: Date.now() - startedAt,
          },
        };
      }

      // kind === 'tool_calls' -> next turn
    }

    // Exhausted tool turns; synthesize final
    const finalItem = publishProviderFinalOutput({
      request,
      itemId: `${this.itemPrefix('final')}-${Date.now()}`,
      text: accumulatedMessage || 'Max tool turns reached without a final answer.',
      emitToken: false,
    });
    codexItems.push(finalItem);

    return {
      output: finalItem.text,
      codexItems,
      usage: {
        inputTokens,
        outputTokens,
        durationMs: Date.now() - startedAt,
      },
    };
  }

  // ─── Private: Thread Management ──────────────────────────────────────────

  private async acquireThread(
    ws: WebSocket,
    taskId: string,
    systemPrompt: string,
  ): Promise<string> {
    const existing = this.threadRegistry[taskId];
    if (existing) {
      try {
        return await this.resumeThread(ws, taskId, existing.threadId, systemPrompt);
      } catch {
        // resume failed; delete stale entry and fall through to start new thread
        delete this.threadRegistry[taskId];
        saveThreadRegistry(this.threadRegistry);
      }
    }
    return this.startThread(ws, taskId, systemPrompt);
  }

  private startThread(
    ws: WebSocket,
    taskId: string,
    developerInstructions: string,
  ): Promise<string> {
    const msgId = `thread-start-${Date.now()}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('AppServerProvider: thread/start timed out'));
      }, TURN_TIMEOUT_MS);

      const handler = (event: MessageEvent): void => {
        try {
          const msg = JSON.parse(
            typeof event.data === 'string' ? event.data : event.data.toString(),
          ) as WsMsg;
          if (msg.type === 'thread/started' && typeof msg.threadId === 'string') {
            cleanup();
            const threadId = msg.threadId;
            this.threadRegistry[taskId] = { threadId, savedAt: Date.now() };
            saveThreadRegistry(this.threadRegistry);
            resolve(threadId);
          }
        } catch {
          // ignore parse errors
        }
      };

      const cleanup = (): void => {
        clearTimeout(timer);
        ws.removeEventListener('message', handler);
      };

      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({
        type: 'thread/start',
        id: msgId,
        developerInstructions,
        approvalPolicy: 'never',
        sandbox: 'danger-full-access',
        persistExtendedHistory: true,
      }));
    });
  }

  private resumeThread(
    ws: WebSocket,
    taskId: string,
    threadId: string,
    developerInstructions: string,
  ): Promise<string> {
    const msgId = `thread-resume-${Date.now()}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('AppServerProvider: thread/resume timed out'));
      }, TURN_TIMEOUT_MS);

      const handler = (event: MessageEvent): void => {
        try {
          const msg = JSON.parse(
            typeof event.data === 'string' ? event.data : event.data.toString(),
          ) as WsMsg;
          if (msg.type === 'thread/resumed') {
            cleanup();
            this.threadRegistry[taskId] = { threadId, savedAt: Date.now() };
            saveThreadRegistry(this.threadRegistry);
            resolve(threadId);
          }
          // If resume fails with an error, reject so acquireThread falls back to start
          if (msg.type === 'error' || msg.type === 'thread/error') {
            cleanup();
            reject(new Error(`thread/resume failed: ${String(msg.message || msg.error || 'unknown')}`));
          }
        } catch {
          // ignore parse errors
        }
      };

      const cleanup = (): void => {
        clearTimeout(timer);
        ws.removeEventListener('message', handler);
      };

      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({
        type: 'thread/resume',
        id: msgId,
        threadId,
        developerInstructions,
        approvalPolicy: 'never',
        sandbox: 'danger-full-access',
        persistExtendedHistory: true,
      }));
    });
  }

  // ─── Private: Turn Execution ─────────────────────────────────────────────

  private runOneTurn(
    ws: WebSocket,
    params: {
      threadId: string;
      task: string;
      request: AgentProviderRequest;
      currentTools: AgentProviderRequest['tools'];
      toolCatalog: AgentProviderRequest['tools'];
    },
  ): Promise<{
    kind: 'final' | 'tool_calls';
    message: string;
    inputTokens: number;
    outputTokens: number;
    toolPackExpanded: boolean;
    expansion?: { pack: string; description: string; tools: AgentToolName[]; scope: 'named' | 'all'; relatedPackIds: string[] };
    expandedTools?: AgentProviderRequest['tools'];
    codexItems: CodexItem[];
  }> {
    const { threadId, task, request, currentTools, toolCatalog } = params;
    const turnId = `turn-${Date.now()}`;

    return new Promise((resolve, reject) => {
      let message = '';
      let lastInputTokens = 0;
      let lastOutputTokens = 0;
      let toolsCalled = false;
      let toolPackExpanded = false;
      let expansion: { pack: string; description: string; tools: AgentToolName[]; scope: 'named' | 'all'; relatedPackIds: string[] } | undefined;
      let expandedTools: AgentProviderRequest['tools'] | undefined;
      const turnCodexItems: CodexItem[] = [];

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('AppServerProvider: turn timed out'));
      }, TURN_TIMEOUT_MS);

      // Wire abort
      this.abortCurrentTurn = (): void => {
        ws.send(JSON.stringify({ type: 'turn/interrupt', threadId }));
      };

      const handler = (event: MessageEvent): void => {
        try {
          const msg = JSON.parse(
            typeof event.data === 'string' ? event.data : event.data.toString(),
          ) as TurnEvent;

          switch (msg.type) {
            case 'item/agentMessage/delta': {
              const delta = typeof msg.delta === 'string' ? msg.delta : '';
              message += delta;
              request.onToken?.(delta);
              break;
            }

            case 'item/started': {
              if (msg.itemType === 'mcpToolCall') {
                toolsCalled = true;
                const item = msg.item as WsMsg;
                const rawToolName = typeof item.tool === 'string' ? item.tool : '';
                const toolName = fromMcpName(rawToolName);
                const toolInput = (item.arguments && typeof item.arguments === 'object')
                  ? item.arguments
                  : {};

                const callDescription = describeProviderToolCall(toolName, toolInput);
                request.onStatus?.(`tool-start:${callDescription}`);

                const startedItem: CodexItem = {
                  id: typeof item.id === 'string' ? item.id : `mcp-${Date.now()}`,
                  type: 'mcp_tool_call',
                  server: typeof item.server === 'string' ? item.server : 'v2-tools',
                  tool: toolName,
                  arguments: (toolInput && typeof toolInput === 'object')
                    ? toolInput as Record<string, unknown>
                    : {},
                  result: null,
                  error: null,
                  status: 'in_progress',
                };
                request.onItem?.({ item: startedItem, eventType: 'item.started' });
                turnCodexItems.push(startedItem);
              }
              break;
            }

            case 'item/completed': {
              if (msg.itemType === 'mcpToolCall') {
                const item = msg.item as WsMsg;
                const rawToolName = typeof item.tool === 'string' ? item.tool : '';
                const toolName = fromMcpName(rawToolName);
                const toolInput = (item.arguments && typeof item.arguments === 'object')
                  ? item.arguments
                  : {};
                const result = item.result ?? null;
                const error = item.error
                  ? { message: typeof (item.error as WsMsg).message === 'string' ? (item.error as WsMsg).message as string : String(item.error) }
                  : null;

                const callDescription = describeProviderToolCall(toolName, toolInput);
                const resultSummary = error
                  ? `error: ${error.message.slice(0, 80)}`
                  : 'done';
                request.onStatus?.(`tool-done:${callDescription} -> ${resultSummary}`);

                const completedItem: CodexItem = {
                  id: typeof item.id === 'string' ? item.id : `mcp-${Date.now()}`,
                  type: 'mcp_tool_call',
                  server: typeof item.server === 'string' ? item.server : 'v2-tools',
                  tool: toolName,
                  arguments: (toolInput && typeof toolInput === 'object')
                    ? toolInput as Record<string, unknown>
                    : {},
                  result,
                  error,
                  status: error ? 'failed' : 'completed',
                };
                request.onItem?.({ item: completedItem, eventType: 'item.completed' });
                turnCodexItems.push(completedItem);

                // Check for tool pack expansion from runtime.request_tool_pack
                if (toolName === 'runtime.request_tool_pack' && !error && result) {
                  const toolResult = {
                    summary: '',
                    data: (typeof result === 'object' && result !== null)
                      ? result as Record<string, unknown>
                      : {},
                  };
                  const exp = resolveToolPackExpansion(
                    { toolCatalog },
                    toolName as AgentToolName,
                    toolResult,
                  );
                  if (exp) {
                    toolPackExpanded = true;
                    expansion = exp;
                    expandedTools = mergeExpandedTools(currentTools, toolCatalog, exp);
                  }
                }
              }
              break;
            }

            case 'thread/tokenUsage/updated': {
              // Each event is a running total for the current turn (snapshot, not delta).
              // Overwrite rather than accumulate to avoid double-counting.
              const last = msg.last as { inputTokens?: number; outputTokens?: number } | undefined;
              if (last) {
                lastInputTokens = last.inputTokens ?? 0;
                lastOutputTokens = last.outputTokens ?? 0;
              }
              break;
            }

            case 'turn/completed': {
              cleanup();
              resolve({
                kind: toolsCalled ? 'tool_calls' : 'final',
                message,
                inputTokens: lastInputTokens,
                outputTokens: lastOutputTokens,
                toolPackExpanded,
                expansion,
                expandedTools,
                codexItems: turnCodexItems,
              });
              break;
            }

            case 'turn/failed': {
              cleanup();
              const errMsg = (msg.error as { message?: string } | undefined)?.message
                || 'Turn failed';
              reject(new Error(`AppServerProvider: turn failed: ${errMsg}`));
              break;
            }

            default:
              break;
          }
        } catch {
          // ignore parse errors for individual messages
        }
      };

      const cleanup = (): void => {
        clearTimeout(timer);
        this.abortCurrentTurn = null;
        ws.removeEventListener('message', handler);
      };

      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({
        type: 'turn/start',
        id: turnId,
        threadId,
        input: [{ type: 'message', role: 'user', content: task }],
        approvalPolicy: 'never',
        sandboxPolicy: { type: 'danger-full-access' },
      }));
    });
  }

  // ─── Private: Helpers ────────────────────────────────────────────────────

  private writeContextFile(request: AgentProviderRequest): void {
    try {
      const toolNames = request.tools.map((t) => t.name);
      fs.writeFileSync(
        CONTEXT_PATH,
        JSON.stringify({
          runId: request.runId,
          agentId: request.agentId,
          mode: request.mode,
          taskId: request.taskId,
          toolNames,
        }, null, 2),
        'utf-8',
      );
    } catch {
      // best-effort; the shim will fall back to defaults
    }
  }

  private itemPrefix(kind: 'tool' | 'final'): string {
    return `${this.providerId.replace(/[^a-zA-Z0-9]+/g, '-')}-${kind}`;
  }
}
