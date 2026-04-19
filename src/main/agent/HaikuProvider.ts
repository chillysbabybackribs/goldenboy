import Anthropic from '@anthropic-ai/sdk';
import type { CodexItem } from '../../shared/types/model';
import { DEFAULT_HAIKU_CONFIG } from '../../shared/types/model';
import { AgentProvider, AgentProviderRequest, AgentProviderResult } from './AgentTypes';
import {
  applyAutoExpandedToolPack,
  applyRuntimeToolExpansion,
  DEFAULT_PROVIDER_MAX_TOOL_TURNS,
  executeProviderToolCallWithEvents,
  formatAutoExpandedToolPackLines,
  formatQueuedExpansionLines,
  normalizeProviderMaxToolTurns,
  publishProviderFinalOutput,
} from './providerToolRuntime';
import { createRequestToolBindingStore } from './toolBindingScope';
import { loadEnvInteger, loadEnvValue } from './loadEnv';
import { runtimeLedgerStore } from '../models/runtimeLedgerStore';
import { estimateTokenCountFromText } from './tokenUsageObservability';

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
const MAX_TOOL_DESCRIPTION_CHARS = 100;
const MAX_TOOL_SCHEMA_PROPERTIES = 40;
const MAX_TOOL_SCHEMA_ENUM_ITEMS = 20;
const MAX_TOOL_SCHEMA_ENUM_STRINGS = 80;

function compactPromptText(text: string, maxChars: number, suffix: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const limit = Math.max(0, maxChars - suffix.length);
  return `${trimmed.slice(0, limit)}${suffix}`;
}

function recordHaikuTurnTokenUsage(input: {
  request: AgentProviderRequest;
  providerId?: 'haiku';
  modelId: string;
  stage: 'tool-planning' | 'final';
  turnIndex: number;
  inputTokens: number;
  outputTokens: number;
  promptText: string;
  responseText: string;
  toolCalls: number;
  autoExpanded?: boolean;
}): void {
  runtimeLedgerStore.recordToolEvent({
    taskId: input.request.taskId,
    providerId: input.providerId ?? 'haiku',
    runId: input.request.runId,
    summary: `Model turn token accounting: ${input.stage} #${input.turnIndex}`,
    metadata: {
      category: 'model-turn',
      providerId: input.providerId ?? 'haiku',
      modelId: input.modelId,
      stage: input.stage,
      turnIndex: input.turnIndex,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      promptLength: input.promptText.length,
      responseLength: input.responseText.length,
      promptTokenEstimate: estimateTokenCountFromText(input.promptText),
      responseTokenEstimate: estimateTokenCountFromText(input.responseText),
      toolCalls: input.toolCalls,
      autoExpanded: Boolean(input.autoExpanded),
    },
  });
}

function compactToolSchema(value: unknown, depth = 0): unknown {
  if (value == null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.slice(0, MAX_TOOL_SCHEMA_ENUM_ITEMS).map((item) => compactToolSchema(item, depth + 1));
  }

  const source = value as Record<string, unknown>;
  const compacted: Record<string, unknown> = {};
  const safeKeys = new Set([
    'type',
    'enum',
    'required',
    'properties',
    'items',
    'additionalProperties',
    'oneOf',
    'anyOf',
    'allOf',
    'minimum',
    'maximum',
    'minLength',
    'maxLength',
    'pattern',
    'format',
    'const',
  ]);

  for (const [key, childValue] of Object.entries(source)) {
    if (key === 'description' || key === 'title' || key === '$schema' || key === '$id') continue;
    if (!safeKeys.has(key) && depth > 0) continue;

    if (key === 'properties' && childValue && typeof childValue === 'object') {
      const properties = childValue as Record<string, unknown>;
      compacted[key] = Object.fromEntries(
        Object.entries(properties)
          .slice(0, MAX_TOOL_SCHEMA_PROPERTIES)
          .map(([propertyName, propertySchema]) => [
            propertyName,
            compactToolSchema(propertySchema, depth + 1),
          ]),
      );
      continue;
    }

    if (key === 'enum' && Array.isArray(childValue)) {
      compacted[key] = childValue
        .slice(0, MAX_TOOL_SCHEMA_ENUM_ITEMS)
        .map((item) => (typeof item === 'string'
          ? compactPromptText(item, MAX_TOOL_SCHEMA_ENUM_STRINGS, '...')
          : item));
      continue;
    }

    if (depth > 2 && (typeof childValue === 'object')) {
      compacted[key] = {};
      continue;
    }

    compacted[key] = compactToolSchema(childValue, depth + 1);
  }

  return compacted;
}

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

function buildAnthropicToolCacheKey(
  tools: AgentProviderRequest['promptTools'],
  compactDescriptions: boolean,
): string {
  return JSON.stringify({
    compactDescriptions,
    tools: tools.map((tool) => ({
      name: tool.name,
      description: compactDescriptions
        ? compactPromptText(tool.description, MAX_TOOL_DESCRIPTION_CHARS, '...')
        : tool.description,
      schema: compactToolSchema(tool.inputSchema),
    })),
  });
}

function buildAnthropicTools(
  tools: AgentProviderRequest['promptTools'],
  compactDescriptions: boolean,
  cache: Map<string, Anthropic.Messages.Tool[]>,
): Anthropic.Messages.Tool[] {
  const cacheKey = buildAnthropicToolCacheKey(tools, compactDescriptions);
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const built = tools.map((tool) => ({
    name: toAnthropicToolName(tool.name),
    description: compactDescriptions
      ? compactPromptText(tool.description, MAX_TOOL_DESCRIPTION_CHARS, '...')
      : tool.description,
    input_schema: compactToolSchema(tool.inputSchema) as Anthropic.Messages.Tool.InputSchema,
  }));

  cache.set(cacheKey, built);
  return built;
}

export class HaikuProvider implements AgentProvider {
  readonly modelId: string;
  readonly supportsAppToolExecutor = true;
  private readonly maxTokens: number;

  private readonly client: Anthropic;
  private aborted = false;
  private activeStream: { abort: () => void } | null = null;

  constructor(apiKey = loadEnvValue('ANTHROPIC_API_KEY')) {
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not configured.');
    }

    this.modelId = loadEnvValue('ANTHROPIC_MODEL') || DEFAULT_HAIKU_CONFIG.modelId;
    this.maxTokens = Math.max(
      1,
      loadEnvInteger('V2_HAIKU_MAX_TOKENS')
      ?? loadEnvInteger('ANTHROPIC_MAX_TOKENS')
      ?? DEFAULT_HAIKU_CONFIG.maxTokens,
    );
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

    const toolCatalog = request.toolCatalog;
    const toolBindingStore = createRequestToolBindingStore(request);
    const anthropicToolCache = new Map<string, Anthropic.Messages.Tool[]>();

    const maxToolTurns = normalizeProviderMaxToolTurns(request.maxToolTurns ?? DEFAULT_PROVIDER_MAX_TOOL_TURNS);
    let finalOutput = '';
    let reachedToolTurnLimit = false;
    const modelId = this.modelId;
    for (let turn = 0; turn < maxToolTurns; turn++) {
      if (this.aborted) {
        throw new Error('Task cancelled by user.');
      }
      const turnPromptText = JSON.stringify(messages);
      const callableTools = toolBindingStore.beginTurn();

      let turnTextBuffer = '';
      const turnTextChunks: string[] = [];
      const tools = buildAnthropicTools(callableTools, true, anthropicToolCache);
      const allowedToolNames = new Set(callableTools.map(tool => tool.name));

      const stream = this.client.messages.stream({
        model: this.modelId as Anthropic.Messages.MessageCreateParams['model'],
        max_tokens: this.maxTokens,
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
        turnTextChunks.push(text);
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

      if (toolUses.length > 0 && turnTextBuffer.trim()) {
        request.onStatus?.('thought-migrate');
      }

      if (toolUses.length === 0) {
        const autoExpansion = applyAutoExpandedToolPack({
          message: finalOutput,
          toolCatalog,
          toolBindingStore,
        });
        recordHaikuTurnTokenUsage({
          request,
          modelId,
          stage: autoExpansion ? 'tool-planning' : 'final',
          turnIndex: turn + 1,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          promptText: turnPromptText,
          responseText: finalOutput,
          toolCalls: 0,
          autoExpanded: Boolean(autoExpansion),
        });
        if (autoExpansion) {
          messages.push({
            role: 'assistant',
            content: response.content as Anthropic.Messages.ContentBlockParam[],
          });
          messages.push({
            role: 'user',
            content: formatAutoExpandedToolPackLines(autoExpansion, { continueInstruction: true }).join('\n'),
          });
          request.onStatus?.(`tool-auto-expand:${autoExpansion.pack}`);
          continue;
        }

        for (const chunk of turnTextChunks) {
          request.onToken?.(chunk);
        }
        // Final answer emitted; model turn complete.
        break;
      }

      recordHaikuTurnTokenUsage({
        request,
        providerId: 'haiku',
        modelId,
        stage: 'tool-planning',
        turnIndex: turn + 1,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        promptText: turnPromptText,
        responseText: finalOutput,
        toolCalls: toolUses.length,
      });

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
          currentTools: callableTools,
        });
        completedItems.set(execution.completedItem.id, execution.completedItem);

        if (execution.ok) {
          const expansion = applyRuntimeToolExpansion({
            request,
            toolBindingStore,
            toolName: v2ToolName as any,
            result: execution.result,
          });
          if (expansion) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: formatQueuedExpansionLines(expansion, { style: 'haiku' }).join('\n'),
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
      const finalPromptText = JSON.stringify([
        ...messages,
        {
          role: 'user',
          content: [
            'The tool-call turn limit has been reached. Stop using tools and provide the best final answer from the evidence already gathered.',
            'If the evidence is insufficient, say exactly what could not be verified and which constraints prevented a concrete answer.',
          ].join('\n'),
        },
      ]);
      const tools = buildAnthropicTools(toolBindingStore.beginTurn(), false, anthropicToolCache);
      const synthesisStream = this.client.messages.stream({
        model: this.modelId as Anthropic.Messages.MessageCreateParams['model'],
        max_tokens: this.maxTokens,
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
      recordHaikuTurnTokenUsage({
        request,
        providerId: 'haiku',
        modelId,
        stage: 'final',
        turnIndex: maxToolTurns + 1,
        inputTokens: synthesisResponse.usage.input_tokens,
        outputTokens: synthesisResponse.usage.output_tokens,
        promptText: finalPromptText,
        responseText: finalOutput,
        toolCalls: 0,
      });
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
