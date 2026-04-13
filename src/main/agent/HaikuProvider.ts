import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import type { CodexItem } from '../../shared/types/model';
import { DEFAULT_HAIKU_CONFIG } from '../../shared/types/model';
import { AgentProvider, AgentProviderRequest, AgentProviderResult } from './AgentTypes';
import {
  DEFAULT_PROVIDER_MAX_TOOL_TURNS,
  executeProviderToolCallWithEvents,
  normalizeProviderMaxToolTurns,
  publishProviderFinalOutput,
  resolveToolPackExpansion,
} from './providerToolRuntime';
import { mergeExpandedTools } from './toolPacks';

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

function fromAnthropicToolName(name: string) {
  return name.replace(/__/g, '.');
}

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

function buildInitialUserContent(request: AgentProviderRequest): string | Anthropic.Messages.ContentBlockParam[] {
  const textParts: string[] = [];
  if (request.contextPrompt?.trim()) {
    textParts.push(request.contextPrompt.trim(), '', '## Current User Request');
  }
  textParts.push(request.task);
  const text = textParts.join('\n');

  const attachments = request.attachments;
  if (!attachments?.length) return text;

  const content: Anthropic.Messages.ContentBlockParam[] = [];

  for (const att of attachments) {
    if (att.type === 'image') {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: att.mediaType,
          data: att.data,
        },
      });
    }
  }

  content.push({ type: 'text', text });
  return content;
}

export class HaikuProvider implements AgentProvider {
  readonly modelId: string;
  readonly supportsAppToolExecutor = true;

  private readonly client: Anthropic;
  private aborted = false;
  private activeStream: { abort: () => void } | null = null;

  constructor(apiKey = loadEnvValue('ANTHROPIC_API_KEY')) {
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not configured.');
    }

    this.modelId = loadEnvValue('ANTHROPIC_MODEL') || DEFAULT_HAIKU_CONFIG.modelId;
    this.client = new Anthropic({ apiKey });
  }

  abort(): void {
    this.aborted = true;
    if (this.activeStream) {
      this.activeStream.abort();
      this.activeStream = null;
    }
  }

  async invoke(request: AgentProviderRequest): Promise<AgentProviderResult> {
    this.aborted = false;
    this.activeStream = null;
    const startedAt = Date.now();
    let inputTokens = 0;
    let outputTokens = 0;
    const completedItems = new Map<string, CodexItem>();
    const messages: Anthropic.Messages.MessageParam[] = [
      {
        role: 'user',
        content: buildInitialUserContent(request),
      },
    ];

    let currentTools = [...request.tools];
    const toolCatalog = request.toolCatalog?.length ? request.toolCatalog : request.tools;

    const maxToolTurns = normalizeProviderMaxToolTurns(request.maxToolTurns ?? DEFAULT_PROVIDER_MAX_TOOL_TURNS);
    let finalOutput = '';
    let reachedToolTurnLimit = false;
    for (let turn = 0; turn < maxToolTurns; turn++) {
      if (this.aborted) {
        throw new Error('Task cancelled by user.');
      }

      let turnTextBuffer = '';
      const tools: Anthropic.Messages.Tool[] = currentTools.map(tool => ({
        name: toAnthropicToolName(tool.name),
        description: `${tool.description}\n\nV2 tool name: ${tool.name}`,
        input_schema: tool.inputSchema as Anthropic.Messages.Tool.InputSchema,
      }));
      const allowedToolNames = new Set(currentTools.map(tool => tool.name));

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
      this.activeStream = stream;

      stream.on('text', (text) => {
        turnTextBuffer += text;
      });

      let response: Anthropic.Messages.Message;
      try {
        response = await finalMessageWithTimeout(
          stream,
          MODEL_STREAM_TIMEOUT_MS,
          `Model stream timed out after ${MODEL_STREAM_TIMEOUT_MS / 1000}s`,
        );
      } catch (err) {
        this.activeStream = null;
        if (this.aborted) throw new Error('Task cancelled by user.');
        throw err;
      }
      this.activeStream = null;

      inputTokens += response.usage.input_tokens;
      outputTokens += response.usage.output_tokens;
      finalOutput = textFromContent(response.content);

      const toolUses = response.content.filter(
        (block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use',
      );

      if (toolUses.length === 0) {
        if (request.onToken && turnTextBuffer) {
          request.onToken(turnTextBuffer);
        }
        break;
      }

      if (request.onStatus && turnTextBuffer.trim()) {
        request.onStatus(turnTextBuffer.trim());
      }

      messages.push({
        role: 'assistant',
        content: response.content as Anthropic.Messages.ContentBlockParam[],
      });

      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (let index = 0; index < toolUses.length; index++) {
        const toolUse = toolUses[index];
        const v2ToolName = fromAnthropicToolName(toolUse.name);

        if (!allowedToolNames.has(v2ToolName as any)) {
          const message = `Tool is not available in this runtime scope: ${v2ToolName}`;
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            is_error: true,
            content: message,
          });
          request.onStatus?.(`tool-done:${v2ToolName} ... error: ${message.slice(0, 80)}`);
          continue;
        }

        const execution = await executeProviderToolCallWithEvents({
          providerId: 'haiku',
          request,
          toolName: v2ToolName as any,
          toolInput: toolUse.input,
          itemId: `haiku-tool-${turn + 1}-${index + 1}-${Date.now()}`,
        });
        completedItems.set(execution.completedItem.id, execution.completedItem);

        if (execution.ok) {
          const expansion = resolveToolPackExpansion(request, v2ToolName as any, execution.result);
          if (expansion) {
            currentTools = mergeExpandedTools(currentTools, toolCatalog, expansion);
            const expandedToolNames = expansion.scope === 'all'
              ? ['all eligible tools']
              : expansion.tools;
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: [
                `Loaded tool pack "${expansion.pack}".`,
                `Description: ${expansion.description}`,
                `Expanded tools: ${expandedToolNames.join(', ')}`,
              ].join('\n'),
            });
            continue;
          }

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: execution.toolContent,
          });
          continue;
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          is_error: true,
          content: execution.errorMessage,
        });
      }

      messages.push({
        role: 'user',
        content: toolResults,
      });

      reachedToolTurnLimit = turn === maxToolTurns - 1;
    }

    if (reachedToolTurnLimit) {
      const tools: Anthropic.Messages.Tool[] = currentTools.map(tool => ({
        name: toAnthropicToolName(tool.name),
        description: `${tool.description}\n\nV2 tool name: ${tool.name}`,
        input_schema: tool.inputSchema as Anthropic.Messages.Tool.InputSchema,
      }));
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
      this.activeStream = synthesisStream;
      synthesisStream.on('text', (text) => {
        request.onToken?.(text);
      });

      const synthesisResponse = await finalMessageWithTimeout(
        synthesisStream,
        FINAL_SYNTHESIS_TIMEOUT_MS,
        `Final synthesis timed out after ${FINAL_SYNTHESIS_TIMEOUT_MS / 1000}s`,
      );
      this.activeStream = null;
      inputTokens += synthesisResponse.usage.input_tokens;
      outputTokens += synthesisResponse.usage.output_tokens;
      finalOutput = textFromContent(synthesisResponse.content);
    }

    const finalItem = publishProviderFinalOutput({
      request,
      itemId: `haiku-final-${Date.now()}`,
      text: finalOutput.trim()
        ? finalOutput
        : 'The run ended without a text response. Please retry the task; no final answer was produced.',
      emitToken: false,
    });
    completedItems.set(finalItem.id, finalItem);

    return {
      output: finalItem.text,
      codexItems: Array.from(completedItems.values()),
      usage: {
        inputTokens,
        outputTokens,
        durationMs: Date.now() - startedAt,
      },
    };
  }
}
