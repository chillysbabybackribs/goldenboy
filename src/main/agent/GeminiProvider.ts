import type { CodexItem } from '../../shared/types/model';
import {
  DEFAULT_GEMINI_CONFIG,
  GEMINI_PROVIDER_ID,
} from '../../shared/types/model';
import { AgentProvider, AgentProviderRequest, AgentProviderResult } from './AgentTypes';
import {
  DEFAULT_PROVIDER_MAX_TOOL_TURNS,
  executeProviderToolCallWithEvents,
  normalizeProviderFinalOutput,
  normalizeProviderMaxToolTurns,
  publishProviderFinalOutput,
} from './providerToolRuntime';
import { createToolScopeState, hasActiveTool, listActiveTools } from './toolScopeState';
import {
  GeminiClient,
  type GeminiContent,
  type GeminiFunctionDeclaration,
  type GeminiPart,
  extractGeminiText,
  loadGeminiEnvValue,
} from './GeminiClient';
import {
  estimateGeminiPromptPrefixSize,
  geminiPromptCache,
  hashGeminiPromptPrefix,
} from './GeminiPromptCache';
import { routeGeminiModel } from './GeminiModelRouter';

function toGeminiToolName(name: string): string {
  return name.replace(/\./g, '__');
}

function fromGeminiToolName(name: string): string {
  return name.replace(/__/g, '.');
}

function buildInitialParts(request: AgentProviderRequest): GeminiPart[] {
  const textParts: string[] = [];
  if (request.contextPrompt?.trim()) {
    textParts.push(request.contextPrompt.trim(), '', '## Current User Request');
  }
  textParts.push(request.task);
  const text = textParts.join('\n').trim();

  const parts: GeminiPart[] = [];
  for (const attachment of request.attachments || []) {
    if (attachment.type !== 'image') continue;
    parts.push({
      inlineData: {
        mimeType: attachment.mediaType,
        data: attachment.data,
      },
    });
  }
  if (text) {
    parts.push({ text });
  }
  return parts.length > 0 ? parts : [{ text: request.task }];
}

function sanitizeGeminiSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeGeminiSchema(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const sanitizedEntries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== 'additionalProperties')
    .map(([key, child]) => [key, sanitizeGeminiSchema(child)] as const);
  return Object.fromEntries(sanitizedEntries);
}

function buildGeminiTools(tools: AgentProviderRequest['tools']): Array<{ functionDeclarations: GeminiFunctionDeclaration[] }> | undefined {
  if (tools.length === 0) return undefined;
  return [{
    functionDeclarations: tools.map((tool) => ({
      name: toGeminiToolName(tool.name),
      description: tool.description,
      parameters: sanitizeGeminiSchema(tool.inputSchema) as Record<string, unknown>,
    })),
  }];
}

function textFromParts(parts: GeminiPart[] | undefined): string {
  if (!parts?.length) return '';
  return parts
    .filter((part): part is Extract<GeminiPart, { text: string }> => typeof (part as { text?: unknown }).text === 'string')
    .map((part) => part.text)
    .join('');
}

function functionCallsFromParts(parts: GeminiPart[] | undefined): Array<{ name: string; args: Record<string, unknown> }> {
  if (!parts?.length) return [];
  return parts
    .filter((part): part is Extract<GeminiPart, { functionCall: { name: string; args?: Record<string, unknown> } }> => Boolean((part as { functionCall?: unknown }).functionCall))
    .map((part) => ({
      name: part.functionCall.name,
      args: (part.functionCall.args && typeof part.functionCall.args === 'object')
        ? part.functionCall.args
        : {},
    }));
}

function buildTurnGuidance(turn: number, toolCallsUsed: number): string {
  const lines = [
    'Use the evidence already gathered before asking for more tools.',
    'If you need another tool, request only the single minimal next tool call unless multiple calls are clearly independent.',
  ];

  if (turn > 0 || toolCallsUsed > 1) {
    lines.push('If the current evidence is sufficient or runtime validation is decisive, stop and provide the final answer.');
  }

  return lines.join('\n');
}

const GEMINI_CACHE_MIN_PREFIX_CHARS = 3_000;
const GEMINI_CACHE_TTL_SECONDS = 30 * 60;
const GEMINI_MAX_LIVE_CONTENTS = 6;
const GEMINI_KEEP_RECENT_CONTENTS = 4;
const GEMINI_MAX_SUMMARY_CHARS = 2_400;

function envInt(name: string, fallback: number): number {
  const value = loadGeminiEnvValue(name);
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function summarizeGeminiPart(part: GeminiPart): string {
  if ('text' in part) {
    return normalizeWhitespace(part.text).slice(0, 240);
  }
  if ('inlineData' in part) {
    return `Included ${part.inlineData.mimeType} attachment`;
  }
  if ('functionCall' in part) {
    return `Requested tool ${fromGeminiToolName(part.functionCall.name)} with ${JSON.stringify(part.functionCall.args || {})}`.slice(0, 280);
  }
  const response = part.functionResponse.response || {};
  const result = typeof response.result === 'string'
    ? response.result
    : JSON.stringify(response.result ?? response.error ?? response);
  return `Tool ${fromGeminiToolName(part.functionResponse.name)} returned ${normalizeWhitespace(result || '').slice(0, 220)}`;
}

function summarizeGeminiContent(content: GeminiContent): string {
  const joined = content.parts.map((part) => summarizeGeminiPart(part)).filter(Boolean).join(' | ');
  return `${content.role}: ${joined}`.trim();
}

function appendRollingSummary(existing: string | null, compacted: GeminiContent[]): string {
  const nextEntries = compacted
    .map((content) => summarizeGeminiContent(content))
    .filter(Boolean)
    .map((line) => `- ${line}`);

  const combined = [
    existing?.trim() || '',
    ...nextEntries,
  ]
    .filter(Boolean)
    .join('\n');

  if (combined.length <= GEMINI_MAX_SUMMARY_CHARS) {
    return combined;
  }
  return combined.slice(combined.length - GEMINI_MAX_SUMMARY_CHARS);
}

function maybeCompactGeminiContents(input: {
  rollingSummary: string | null;
  liveContents: GeminiContent[];
}): { rollingSummary: string | null; liveContents: GeminiContent[] } {
  if (input.liveContents.length <= GEMINI_MAX_LIVE_CONTENTS) {
    return input;
  }

  const compactCount = Math.max(1, input.liveContents.length - GEMINI_KEEP_RECENT_CONTENTS);
  const compacted = input.liveContents.slice(0, compactCount);
  const remaining = input.liveContents.slice(compactCount);
  return {
    rollingSummary: appendRollingSummary(input.rollingSummary, compacted),
    liveContents: remaining,
  };
}

function buildEffectiveGeminiContents(rollingSummary: string | null, liveContents: GeminiContent[]): GeminiContent[] {
  if (!rollingSummary?.trim()) {
    return liveContents;
  }
  return [
    {
      role: 'user',
      parts: [{
        text: [
          'Earlier conversation summary.',
          'Treat this as compressed authoritative context for older turns.',
          rollingSummary.trim(),
        ].join('\n'),
      }],
    },
    ...liveContents,
  ];
}

function assertUsableCandidate(
  candidate: { finishReason?: string } | undefined,
  turnText: string,
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>,
): void {
  if (!candidate) {
    throw new Error('Gemini returned no candidate response.');
  }

  const finishReason = (candidate.finishReason || '').trim();
  if (!finishReason) return;

  const producedUsableOutput = Boolean(turnText.trim()) || toolCalls.length > 0;
  if (finishReason === 'STOP') return;
  if (finishReason === 'MAX_TOKENS' && producedUsableOutput) return;

  if (!producedUsableOutput) {
    throw new Error(`Gemini stopped with finishReason=${finishReason} without usable output.`);
  }
}

export class GeminiProvider implements AgentProvider {
  readonly providerId = GEMINI_PROVIDER_ID;
  readonly modelId: string;
  readonly supportsAppToolExecutor = true;

  private readonly client: GeminiClient;
  private aborted = false;
  private partialUsage: AgentProviderResult['usage'] | null = null;

  getPartialUsage(): AgentProviderResult['usage'] | null {
    return this.partialUsage;
  }

  constructor(options: string | { apiKey?: string | null; modelId?: string | null } = loadGeminiEnvValue('GEMINI_API_KEY') || '') {
    const apiKey = typeof options === 'string'
      ? options
      : (options.apiKey ?? loadGeminiEnvValue('GEMINI_API_KEY') ?? '');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured.');
    }
    this.client = new GeminiClient(apiKey);
    const requestedModelId = typeof options === 'string' ? null : options.modelId;
    this.modelId = requestedModelId?.trim() || routeGeminiModel({
      task: '',
      contextPrompt: '',
    }).modelId;
  }

  abort(): void {
    this.aborted = true;
  }

  async invoke(request: AgentProviderRequest): Promise<AgentProviderResult> {
    const toolScope = request.toolScope ?? createToolScopeState(request.tools);
    const runtimeRequest = request.toolScope ? request : { ...request, toolScope };
    this.aborted = false;
    this.partialUsage = null;
    const startedAt = Date.now();
    let inputTokens = 0;
    let cachedInputTokens = 0;
    let outputTokens = 0;
    const snapshotPartial = (): void => {
      this.partialUsage = {
        inputTokens,
        cachedInputTokens,
        outputTokens,
        durationMs: Date.now() - startedAt,
      };
    };
    const completedItems = new Map<string, CodexItem>();
    let liveContents: GeminiContent[] = [
      {
        role: 'user',
        parts: buildInitialParts(request),
      },
    ];
    let rollingSummary: string | null = null;

    let currentTools = listActiveTools(toolScope);
    const maxToolTurns = normalizeProviderMaxToolTurns(request.maxToolTurns ?? DEFAULT_PROVIDER_MAX_TOOL_TURNS);
    const modelRoute = routeGeminiModel({
      task: request.task,
      contextPrompt: request.contextPrompt,
      hasAttachments: Boolean(request.attachments?.length),
      canUseTools: currentTools.length > 0,
    });
    const initialGeminiTools = buildGeminiTools(currentTools);
    const cacheKey = hashGeminiPromptPrefix({
      modelId: modelRoute.modelId,
      systemPrompt: request.systemPrompt,
      tools: initialGeminiTools?.[0]?.functionDeclarations || [],
    });
    const cacheablePrefixSize = estimateGeminiPromptPrefixSize({
      systemPrompt: request.systemPrompt,
      tools: initialGeminiTools?.[0]?.functionDeclarations || [],
    });
    const minCacheChars = envInt('GEMINI_CACHE_MIN_PREFIX_CHARS', GEMINI_CACHE_MIN_PREFIX_CHARS);
    const cacheTtlSeconds = envInt('GEMINI_CACHE_TTL_SECONDS', GEMINI_CACHE_TTL_SECONDS);
    let cachedContentName: string | null = null;
    const cachedEntry = cacheablePrefixSize >= minCacheChars ? geminiPromptCache.get(cacheKey) : null;
    if (cachedEntry) {
      cachedContentName = cachedEntry.cacheName;
    }

    let finalOutput = '';
    let reachedToolTurnLimit = false;
    let completion: AgentProviderResult['completion'] | undefined;

    for (let turn = 0; turn < maxToolTurns; turn++) {
      if (this.aborted) throw new Error('Task cancelled by user.');
      currentTools = listActiveTools(toolScope);
      const geminiTools = buildGeminiTools(currentTools);

      if (!cachedContentName && turn === 0 && geminiTools && cacheablePrefixSize >= minCacheChars) {
        try {
          const createdCache = await this.client.createCachedContent({
            modelId: modelRoute.modelId,
            systemPrompt: request.systemPrompt,
            tools: geminiTools,
            allowFunctionCalls: currentTools.length > 0,
            ttlSeconds: cacheTtlSeconds,
          });
          if (createdCache.name) {
            cachedContentName = createdCache.name;
            geminiPromptCache.set({
              key: cacheKey,
              cacheName: createdCache.name,
              modelId: modelRoute.modelId,
              ttlMs: cacheTtlSeconds * 1000,
            });
          }
        } catch {
          cachedContentName = null;
        }
      }

      const response = await this.client.generateContent({
        modelId: modelRoute.modelId,
        systemPrompt: request.systemPrompt,
        contents: buildEffectiveGeminiContents(rollingSummary, liveContents),
        tools: geminiTools,
        allowFunctionCalls: currentTools.length > 0,
        maxOutputTokens: DEFAULT_GEMINI_CONFIG.maxOutputTokens,
        thinkingBudget: modelRoute.thinkingBudget,
        cachedContent: cachedContentName || undefined,
      });

      inputTokens += response.usageMetadata?.promptTokenCount || 0;
      cachedInputTokens += response.usageMetadata?.cachedContentTokenCount || 0;
      outputTokens += (response.usageMetadata?.candidatesTokenCount || 0)
        + (response.usageMetadata?.thoughtsTokenCount || 0);
      snapshotPartial();

      const candidate = response.candidates?.[0];
      const modelContent: GeminiContent = {
        role: candidate?.content?.role === 'user' ? 'user' : 'model',
        parts: candidate?.content?.parts || [],
      };
      const turnText = textFromParts(modelContent.parts);
      if (turnText.trim()) {
        finalOutput = turnText;
      }

      const toolCalls = functionCallsFromParts(modelContent.parts);
      assertUsableCandidate(candidate, turnText, toolCalls);
      if (candidate?.finishReason === 'MAX_TOKENS' && toolCalls.length === 0 && turnText.trim()) {
        completion = {
          completed: false,
          reason: 'max_tokens',
          canContinue: true,
        };
      } else if (toolCalls.length === 0) {
        completion = undefined;
      }
      liveContents.push({
        role: 'model',
        parts: modelContent.parts || [],
      });
      ({ rollingSummary, liveContents } = maybeCompactGeminiContents({ rollingSummary, liveContents }));

      if (toolCalls.length === 0) {
        break;
      }

      if (turnText.trim()) {
        request.onStatus?.(turnText.trim());
      }

      const toolResponses: GeminiPart[] = [];

      for (let index = 0; index < toolCalls.length; index++) {
        const toolCall = toolCalls[index];
        const v2ToolName = fromGeminiToolName(toolCall.name);
        if (!hasActiveTool(toolScope, v2ToolName as typeof currentTools[number]['name'])) {
          const message = `Tool is not available in this runtime scope: ${v2ToolName}`;
          toolResponses.push({
            functionResponse: {
              name: toolCall.name,
              response: { error: message },
            },
          });
          request.onStatus?.(`tool-done:${v2ToolName} -> error: ${message.slice(0, 80)}`);
          continue;
        }

        const execution = await executeProviderToolCallWithEvents({
          providerId: GEMINI_PROVIDER_ID,
          request: runtimeRequest,
          toolName: v2ToolName as typeof currentTools[number]['name'],
          toolInput: toolCall.args,
          itemId: `gemini-tool-${turn + 1}-${index + 1}-${Date.now()}`,
        });
        completedItems.set(execution.completedItem.id, execution.completedItem);

        if (execution.ok) {
          toolResponses.push({
            functionResponse: {
              name: toolCall.name,
              response: { result: execution.toolContent },
            },
          });
          continue;
        }

        toolResponses.push({
          functionResponse: {
            name: toolCall.name,
            response: { error: execution.errorMessage },
          },
        });
      }

      liveContents.push({
        role: 'user',
        parts: [
          ...toolResponses,
          { text: buildTurnGuidance(turn, toolCalls.length) },
        ],
      });
      ({ rollingSummary, liveContents } = maybeCompactGeminiContents({ rollingSummary, liveContents }));

      reachedToolTurnLimit = turn === maxToolTurns - 1;
    }

    if (reachedToolTurnLimit) {
      const synthesis = await this.client.generateContent({
        modelId: modelRoute.modelId,
        systemPrompt: request.systemPrompt,
        contents: [
          ...buildEffectiveGeminiContents(rollingSummary, liveContents),
          {
            role: 'user',
            parts: [{
              text: [
                'The tool-call turn limit has been reached.',
                'Stop using tools and provide the best final answer from the evidence already gathered.',
                'If the evidence is insufficient, say exactly what could not be verified.',
              ].join('\n'),
            }],
          },
        ],
        allowFunctionCalls: false,
        maxOutputTokens: DEFAULT_GEMINI_CONFIG.maxOutputTokens,
        thinkingBudget: modelRoute.thinkingBudget,
        cachedContent: cachedContentName || undefined,
      });
      inputTokens += synthesis.usageMetadata?.promptTokenCount || 0;
      cachedInputTokens += synthesis.usageMetadata?.cachedContentTokenCount || 0;
      outputTokens += (synthesis.usageMetadata?.candidatesTokenCount || 0)
        + (synthesis.usageMetadata?.thoughtsTokenCount || 0);
      snapshotPartial();
      assertUsableCandidate(synthesis.candidates?.[0], extractGeminiText(synthesis), []);
      finalOutput = extractGeminiText(synthesis) || finalOutput;
      completion = synthesis.candidates?.[0]?.finishReason === 'MAX_TOKENS'
        ? { completed: false, reason: 'max_tokens', canContinue: true }
        : undefined;
    }

    // Gemini's REST API has no delta streaming, so emit the final text as a
    // single `onToken` call. The renderer's typewriter reveals it chunk by
    // chunk, giving the user the same progressive-reveal experience as
    // Haiku/Codex and keeping the "streaming → final" transition seamless
    // (no sudden full-text pop on completion).
    request.onToken?.(normalizeProviderFinalOutput(finalOutput));

    const finalItem = publishProviderFinalOutput({
      request,
      itemId: `gemini-final-${Date.now()}`,
      text: finalOutput,
      emitToken: false,
    });

    return {
      output: finalItem.text,
      codexItems: [...completedItems.values(), finalItem],
      completion,
      usage: {
        inputTokens,
        cachedInputTokens,
        outputTokens,
        durationMs: Date.now() - startedAt,
      },
    };
  }
}
