import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import type { CodexItem } from '../../shared/types/model';
import { DEFAULT_HAIKU_CONFIG } from '../../shared/types/model';
import { AgentProvider, AgentProviderRequest, AgentProviderResult } from './AgentTypes';
import {
  DEFAULT_PROVIDER_MAX_TOOL_TURNS,
  describeLoadedToolNames,
  executeProviderToolCallWithEvents,
  mergeLoadedTools,
  normalizeProviderMaxToolTurns,
  publishProviderFinalOutput,
  resolveLoadedToolExpansion,
} from './providerToolRuntime';

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
const MAX_STREAM_RECOVERY_ATTEMPTS = 2;
const MAX_CONVERSATION_TURNS = 10;
const anthropicToolCache = new Map<string, Anthropic.Messages.Tool[]>();

type AnthropicMessageStream = {
  on(
    event: 'text',
    callback: (text: string, snapshot: string) => void,
  ): AnthropicMessageStream;
  on(
    event: 'streamEvent',
    callback: (
      event: Anthropic.Messages.MessageStreamEvent,
      snapshot: Anthropic.Messages.Message,
    ) => void,
  ): AnthropicMessageStream;
  on(event: 'error', callback: (error: unknown) => void): AnthropicMessageStream;
  abort: () => void;
  finalMessage: () => Promise<Anthropic.Messages.Message>;
  currentMessage?: Anthropic.Messages.Message;
};

type StreamAttemptResult = {
  response: Anthropic.Messages.Message;
  recoveredTextPrefix: string;
};

function isHaiku45Model(modelId: string): boolean {
  return /haiku-4-5/i.test(modelId);
}

function isRecoverableStreamError(error: unknown, timeoutMessage: string): boolean {
  if (!(error instanceof Error)) return false;
  if (error.message === timeoutMessage) return true;

  const name = error.name || '';
  const message = error.message.toLowerCase();
  return (
    name === 'APIConnectionError' ||
    name === 'APIConnectionTimeoutError' ||
    name === 'InternalServerError' ||
    name === 'RateLimitError' ||
    message.includes('overloaded') ||
    message.includes('connection') ||
    message.includes('timed out')
  );
}

function extractResumableTextPrefix(
  snapshot: Anthropic.Messages.Message | undefined,
): string | null {
  if (!snapshot?.content?.length) return null;

  let sawText = false;
  const parts: string[] = [];
  for (const block of snapshot.content) {
    if (block.type !== 'text') {
      return null;
    }
    if (block.text) {
      sawText = true;
      parts.push(block.text);
    }
  }

  if (!sawText) return null;
  const combined = parts.join('');
  return combined.trim() ? combined : null;
}

function mergeRecoveredText(prefix: string, text: string): string {
  if (!prefix) return text;
  if (!text) return prefix;
  return text.startsWith(prefix) ? text : `${prefix}${text}`;
}

function mergeRecoveredContent(
  prefix: string,
  content: Anthropic.Messages.ContentBlock[],
): Anthropic.Messages.ContentBlock[] {
  if (!prefix) return content;

  const first = content[0];
  if (!first) {
    return [{ type: 'text', text: prefix, citations: null }];
  }

  if (first.type === 'text') {
    if (first.text.startsWith(prefix)) return content;
    return [
      { ...first, text: `${prefix}${first.text}` },
      ...content.slice(1),
    ];
  }

  return [{ type: 'text', text: prefix, citations: null }, ...content];
}

async function finalMessageWithRecovery(
  createStream: (messages: Anthropic.Messages.MessageParam[]) => AnthropicMessageStream,
  messages: Anthropic.Messages.MessageParam[],
  timeoutMs: number,
  message: string,
  onText: ((text: string) => void) | undefined,
  allowRecovery: boolean,
  onRecovery?: ((attempt: number, recoveredText: string) => void) | undefined,
): Promise<StreamAttemptResult> {
  let attempt = 0;
  let recoveredTextPrefix = '';

  while (true) {
    const activeMessages = recoveredTextPrefix
      ? [...messages, { role: 'assistant' as const, content: recoveredTextPrefix }]
      : messages;
    const stream = createStream(activeMessages);
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let rejectTimeout: ((error: Error) => void) | null = null;

    const timeoutPromise = new Promise<Anthropic.Messages.Message>((_, reject) => {
      rejectTimeout = reject;
    });

    const scheduleTimeout = () => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        timeout = null;
        stream.abort();
        rejectTimeout?.(new Error(message));
      }, timeoutMs);
    };

    stream.on('text', (text) => {
      scheduleTimeout();
      onText?.(text);
    });
    stream.on('streamEvent', () => {
      scheduleTimeout();
    });
    stream.on('error', () => {
      if (timeout) clearTimeout(timeout);
      timeout = null;
    });

    try {
      scheduleTimeout();
      const response = await Promise.race([
        stream.finalMessage(),
        timeoutPromise,
      ]);
      return { response, recoveredTextPrefix };
    } catch (error) {
      if (
        !allowRecovery ||
        attempt >= MAX_STREAM_RECOVERY_ATTEMPTS ||
        !isRecoverableStreamError(error, message)
      ) {
        throw error;
      }

      const resumableText = extractResumableTextPrefix(stream.currentMessage);
      if (!resumableText) {
        throw error;
      }

      recoveredTextPrefix = mergeRecoveredText(recoveredTextPrefix, resumableText);
      attempt += 1;
      onRecovery?.(attempt, recoveredTextPrefix);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}

function buildAnthropicStream(
  client: Anthropic,
  modelId: string,
  systemPrompt: string,
  messages: Anthropic.Messages.MessageParam[],
  tools: Anthropic.Messages.Tool[],
  toolChoice: Anthropic.Messages.ToolChoice,
): AnthropicMessageStream {
  return client.messages.stream({
    model: modelId as Anthropic.Messages.MessageCreateParams['model'],
    max_tokens: DEFAULT_HAIKU_CONFIG.maxTokens,
    system: [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages,
    tools,
    tool_choice: toolChoice,
  }) as AnthropicMessageStream;
}

function slidingWindowMessages(
  messages: Anthropic.Messages.MessageParam[],
  maxTurns: number,
): Anthropic.Messages.MessageParam[] {
  // messages[0] is the initial user message; subsequent entries are interleaved
  // assistant (may contain tool_use) + user (tool_results). They must always be
  // trimmed as aligned pairs — never cut an assistant message without also cutting
  // its following tool_result user message, and vice versa.
  if (messages.length <= 1) return messages;
  const tail = messages.slice(1);
  // pair = [assistant, user(tool_results)]; maxTurns * 2 entries max
  const maxEntries = maxTurns * 2;
  if (tail.length <= maxEntries) return messages;
  // drop from the front in steps of 2 to keep pairs aligned
  const excess = tail.length - maxEntries;
  const dropCount = excess % 2 === 0 ? excess : excess + 1;
  return [messages[0], ...tail.slice(dropCount)];
}

function buildInitialUserContent(request: AgentProviderRequest): string | Anthropic.Messages.ContentBlockParam[] {
  const textParts: string[] = [];
  if (request.contextPrompt?.trim()) {
    textParts.push(request.contextPrompt.trim(), '', '## Current User Request');
  }
  textParts.push(request.task);
  const text = textParts.join('\n').trim();

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

  if (text) {
    content.push({ type: 'text', text });
  }
  return content;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function buildAnthropicToolSignature(tools: AgentProviderRequest['tools']): string {
  return tools.map((tool) => [
    tool.name,
    tool.description,
    stableStringify(tool.inputSchema),
  ].join('::')).join('||');
}

function buildAnthropicTools(tools: AgentProviderRequest['tools']): Anthropic.Messages.Tool[] {
  const signature = buildAnthropicToolSignature(tools);
  const cached = anthropicToolCache.get(signature);
  if (cached) return cached;

  const built: Anthropic.Messages.Tool[] = tools.map((tool, i) => {
    const entry: Anthropic.Messages.Tool = {
      name: toAnthropicToolName(tool.name),
      description: tool.description,
      input_schema: tool.inputSchema as Anthropic.Messages.Tool.InputSchema,
    };
    if (i === tools.length - 1) {
      (entry as Anthropic.Messages.Tool & { cache_control: unknown }).cache_control = { type: 'ephemeral' };
    }
    return entry;
  });
  anthropicToolCache.set(signature, built);
  return built;
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
    const loadableTools = request.loadableTools;

    const maxToolTurns = normalizeProviderMaxToolTurns(request.maxToolTurns ?? DEFAULT_PROVIDER_MAX_TOOL_TURNS);
    let finalOutput = '';
    let reachedToolTurnLimit = false;
    for (let turn = 0; turn < maxToolTurns; turn++) {
      if (this.aborted) {
        throw new Error('Task cancelled by user.');
      }

      let turnTextBuffer = '';
      const tools = buildAnthropicTools(currentTools);
      const allowedToolNames = new Set(currentTools.map(tool => tool.name));

      let response: Anthropic.Messages.Message;
      let recoveredTextPrefix = '';
      try {
        const streamResult = await finalMessageWithRecovery(
          (turnMessages) => {
            const stream = buildAnthropicStream(
              this.client,
              this.modelId,
              request.systemPrompt,
              slidingWindowMessages(turnMessages, MAX_CONVERSATION_TURNS),
              tools,
              { type: 'auto' },
            );
            this.activeStream = stream;
            return stream;
          },
          messages,
          MODEL_STREAM_TIMEOUT_MS,
          `Model stream timed out after ${MODEL_STREAM_TIMEOUT_MS / 1000}s`,
          (text) => {
            turnTextBuffer += text;
          },
          isHaiku45Model(this.modelId),
          (attempt, recoveredText) => {
            request.onStatus?.(
              `stream-recover:${attempt} resumed after interruption (${recoveredText.length} chars)`,
            );
          },
        );
        response = streamResult.response;
        recoveredTextPrefix = streamResult.recoveredTextPrefix;
      } catch (err) {
        this.activeStream = null;
        if (this.aborted) throw new Error('Task cancelled by user.');
        throw err;
      }
      this.activeStream = null;

      inputTokens += response.usage.input_tokens;
      outputTokens += response.usage.output_tokens;
      const mergedContent = mergeRecoveredContent(recoveredTextPrefix, response.content);
      finalOutput = mergeRecoveredText(recoveredTextPrefix, textFromContent(response.content));

      const toolUses = mergedContent.filter(
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
        content: mergedContent as Anthropic.Messages.ContentBlockParam[],
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
          currentToolNames: currentTools.map((tool) => tool.name),
          itemId: `haiku-tool-${turn + 1}-${index + 1}-${Date.now()}`,
        });
        completedItems.set(execution.completedItem.id, execution.completedItem);

        if (execution.ok) {
          const expansion = resolveLoadedToolExpansion(request, v2ToolName as any, execution.result);
          if (expansion) {
            currentTools = mergeLoadedTools(currentTools, loadableTools, expansion);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: `Loaded tools: ${describeLoadedToolNames(execution.result)}`,
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
      const tools = buildAnthropicTools(currentTools);
      const synthesisMessages: Anthropic.Messages.MessageParam[] = [
        ...messages,
        {
          role: 'user',
          content: [
            'The tool-call turn limit has been reached. Stop using tools and provide the best final answer from the evidence already gathered.',
            'If the evidence is insufficient, say exactly what could not be verified and which constraints prevented a concrete answer.',
          ].join('\n'),
        },
      ];
      const streamResult = await finalMessageWithRecovery(
        (turnMessages) => {
          const stream = buildAnthropicStream(
            this.client,
            this.modelId,
            request.systemPrompt,
            slidingWindowMessages(turnMessages, MAX_CONVERSATION_TURNS),
            tools,
            { type: 'none' },
          );
          this.activeStream = stream;
          return stream;
        },
        synthesisMessages,
        FINAL_SYNTHESIS_TIMEOUT_MS,
        `Final synthesis timed out after ${FINAL_SYNTHESIS_TIMEOUT_MS / 1000}s`,
        (text) => {
          request.onToken?.(text);
        },
        isHaiku45Model(this.modelId),
        (attempt, recoveredText) => {
          request.onStatus?.(
            `stream-recover:${attempt} resumed final synthesis (${recoveredText.length} chars)`,
          );
        },
      );
      const synthesisResponse = streamResult.response;
      this.activeStream = null;
      inputTokens += synthesisResponse.usage.input_tokens;
      outputTokens += synthesisResponse.usage.output_tokens;
      finalOutput = mergeRecoveredText(
        streamResult.recoveredTextPrefix,
        textFromContent(synthesisResponse.content),
      );
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
