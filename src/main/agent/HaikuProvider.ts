import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import { AgentProvider, AgentProviderRequest, AgentProviderResult, AgentToolName } from './AgentTypes';
import { DEFAULT_HAIKU_CONFIG } from '../../shared/types/model';
import { agentToolExecutor } from './AgentToolExecutor';
import { chatKnowledgeStore } from '../chatKnowledge/ChatKnowledgeStore';
import { formatValidationForModel } from './ConstraintValidator';

function loadEnvValue(key: string): string | null {
  if (process.env[key]) return process.env[key] || null;

  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return null;

  const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const eq = trimmed.indexOf('=');
    const name = trimmed.slice(0, eq).trim();
    if (name !== key) continue;

    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) {
      process.env[key] = value;
      return value;
    }
  }
  return null;
}

function textFromContent(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.Messages.TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('');
}

function toAnthropicToolName(name: string): string {
  return name.replace(/\./g, '__');
}

function fromAnthropicToolName(name: string): AgentToolName {
  return name.replace(/__/g, '.') as AgentToolName;
}

function compactToolResult(result: unknown): string {
  const text = typeof result === 'string' ? result : JSON.stringify(result, null, 0);
  if (!text) return '';
  return text.length > 8_000 ? `${text.slice(0, 8_000)}\n...[tool result truncated]` : text;
}

const DEFAULT_MAX_TOOL_TURNS = 20;
const MAX_ALLOWED_TOOL_TURNS = 40;
const MODEL_STREAM_TIMEOUT_MS = 180_000;
const FINAL_SYNTHESIS_TIMEOUT_MS = 120_000;

async function finalMessageWithTimeout(
  stream: { finalMessage: () => Promise<Anthropic.Messages.Message>; abort: () => void },
  timeoutMs: number,
  message: string,
): Promise<Anthropic.Messages.Message> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      stream.finalMessage(),
      new Promise<Anthropic.Messages.Message>((_, reject) => {
        timeout = setTimeout(() => {
          stream.abort();
          reject(new Error(message));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function serializeToolMemory(input: {
  toolName: AgentToolName;
  toolInput: unknown;
  result?: unknown;
  error?: string;
}): string {
  const payload = {
    tool: input.toolName,
    input: input.toolInput,
    result: input.result,
    error: input.error,
  };
  const text = JSON.stringify(payload, null, 2);
  return text.length > 50_000 ? `${text.slice(0, 50_000)}\n...[tool memory truncated]` : text;
}

function buildInitialUserMessage(request: AgentProviderRequest): string {
  if (!request.contextPrompt?.trim()) return request.task;
  return [
    request.contextPrompt.trim(),
    '',
    '## Current User Request',
    request.task,
  ].join('\n');
}

export class HaikuProvider implements AgentProvider {
  readonly modelId: string;
  private readonly client: Anthropic;

  constructor(apiKey = loadEnvValue('ANTHROPIC_API_KEY')) {
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not configured.');
    }

    this.modelId = loadEnvValue('ANTHROPIC_MODEL') || DEFAULT_HAIKU_CONFIG.modelId;
    this.client = new Anthropic({ apiKey });
  }

  async invoke(request: AgentProviderRequest): Promise<AgentProviderResult> {
    const startedAt = Date.now();
    let inputTokens = 0;
    let outputTokens = 0;
    const messages: Anthropic.Messages.MessageParam[] = [
      {
        role: 'user',
        content: buildInitialUserMessage(request),
      },
    ];

    const tools: Anthropic.Messages.Tool[] = request.tools.map(tool => ({
      name: toAnthropicToolName(tool.name),
      description: `${tool.description}\n\nV2 tool name: ${tool.name}`,
      input_schema: tool.inputSchema as Anthropic.Messages.Tool.InputSchema,
    }));
    const allowedToolNames = new Set(request.tools.map(tool => tool.name));

    const maxToolTurns = Math.min(
      Math.max(Math.floor(request.maxToolTurns ?? DEFAULT_MAX_TOOL_TURNS), 1),
      MAX_ALLOWED_TOOL_TURNS,
    );
    let finalOutput = '';
    let reachedToolTurnLimit = false;
    for (let turn = 0; turn < maxToolTurns; turn++) {
      const stream = this.client.messages.stream({
        model: this.modelId as Anthropic.Messages.MessageCreateParams['model'],
        max_tokens: DEFAULT_HAIKU_CONFIG.maxTokens,
        system: [
          {
            type: 'text',
            text: request.systemPrompt,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages,
        tools,
        tool_choice: { type: 'auto' },
      });

      if (request.onToken) {
        stream.on('text', (text) => {
          request.onToken!(text);
        });
      }

      const response = await finalMessageWithTimeout(
        stream,
        MODEL_STREAM_TIMEOUT_MS,
        `Model stream timed out after ${MODEL_STREAM_TIMEOUT_MS / 1000}s`,
      );

      inputTokens += response.usage.input_tokens;
      outputTokens += response.usage.output_tokens;
      finalOutput = textFromContent(response.content);

      const toolUses = response.content.filter(
        (block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use',
      );
      if (toolUses.length === 0) {
        break;
      }

      messages.push({
        role: 'assistant',
        content: response.content as Anthropic.Messages.ContentBlockParam[],
      });

      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        try {
          const v2ToolName = fromAnthropicToolName(toolUse.name);
          if (!allowedToolNames.has(v2ToolName)) {
            throw new Error(`Tool is not available in this runtime scope: ${v2ToolName}`);
          }
          const result = await agentToolExecutor.execute(v2ToolName, toolUse.input, {
            runId: request.runId,
            agentId: request.agentId,
            mode: request.mode,
            taskId: request.taskId,
          });
          if (request.taskId && !v2ToolName.startsWith('chat.')) {
            chatKnowledgeStore.recordToolMessage(
              request.taskId,
              serializeToolMemory({ toolName: v2ToolName, toolInput: toolUse.input, result }),
              'haiku',
              request.runId,
            );
          }
          let toolContent = compactToolResult(result);
          if (result.validation) {
            toolContent += formatValidationForModel(result.validation);
          }
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: toolContent,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const v2ToolName = fromAnthropicToolName(toolUse.name);
          if (request.taskId && !v2ToolName.startsWith('chat.')) {
            chatKnowledgeStore.recordToolMessage(
              request.taskId,
              serializeToolMemory({ toolName: v2ToolName, toolInput: toolUse.input, error: message }),
              'haiku',
              request.runId,
            );
          }
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            is_error: true,
            content: message,
          });
        }
      }

      messages.push({
        role: 'user',
        content: toolResults,
      });

      reachedToolTurnLimit = turn === maxToolTurns - 1;
    }

    if (reachedToolTurnLimit) {
      const synthesisStream = this.client.messages.stream({
        model: this.modelId as Anthropic.Messages.MessageCreateParams['model'],
        max_tokens: DEFAULT_HAIKU_CONFIG.maxTokens,
        system: [
          {
            type: 'text',
            text: request.systemPrompt,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          ...messages,
          {
            role: 'user',
            content: [
              'The tool-call turn limit has been reached. Stop using tools and provide the best final answer from the evidence already gathered.',
              'If the evidence is insufficient, say exactly what could not be verified and which constraints prevented a concrete answer.',
            ].join('\n'),
          },
        ],
        tools,
        tool_choice: { type: 'none' },
      });

      if (request.onToken) {
        synthesisStream.on('text', (text) => {
          request.onToken!(text);
        });
      }

      const synthesisResponse = await finalMessageWithTimeout(
        synthesisStream,
        FINAL_SYNTHESIS_TIMEOUT_MS,
        `Final synthesis timed out after ${FINAL_SYNTHESIS_TIMEOUT_MS / 1000}s`,
      );
      inputTokens += synthesisResponse.usage.input_tokens;
      outputTokens += synthesisResponse.usage.output_tokens;
      finalOutput = textFromContent(synthesisResponse.content);
    }

    return {
      output: finalOutput.trim()
        ? finalOutput
        : 'The run ended without a text response. Please retry the task; no final answer was produced.',
      usage: {
        inputTokens,
        outputTokens,
        durationMs: Date.now() - startedAt,
      },
    };
  }
}
