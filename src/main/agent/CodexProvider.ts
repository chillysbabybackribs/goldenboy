import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';
import {
  PRIMARY_PROVIDER_ID,
  type CodexEvent,
  type CodexItem,
  type CodexReasoningEffort,
  type ProviderId,
} from '../../shared/types/model';
import { AgentProvider, AgentProviderRequest, AgentProviderResult, AgentToolName } from './AgentTypes';
import {
  applyAutoExpandedToolPack,
  applyRuntimeToolExpansion,
  DEFAULT_PROVIDER_MAX_TOOL_TURNS,
  describeProviderToolCall,
  encodeToolInput,
  formatAutoExpandedToolPackLines,
  formatQueuedExpansionLines,
  executeProviderToolCallWithEvents,
  normalizeProviderMaxToolTurns,
  normalizeProviderFinalOutput,
  publishProviderFinalOutput,
} from './providerToolRuntime';
import { createRequestToolBindingStore } from './toolBindingScope';
import { isTokenEfficientContextMode } from './invocationContextPolicy';
import { runtimeLedgerStore } from '../models/runtimeLedgerStore';
import { estimateTokenCountFromText } from './tokenUsageObservability';

const CODEX_INACTIVITY_TIMEOUT_MS = 180_000;
const CODEX_WEB_SEARCH_DISABLED_CONFIG = 'web_search="disabled"';

const MAX_TOOL_DESCRIPTION_CHARS = 100;
const MAX_TOOL_SCHEMA_CHARS = 320;
const MAX_PROMPT_HISTORY_ENTRIES = 10;
const MAX_PROMPT_HISTORY_CHARS = 4_000;
const MAX_TOOL_REGISTRY_CHARS = 5_000;
const MAX_TOOL_REGISTRY_NAME_LINES = 80;
const MAX_TRANSCRIPT_ENTRY_CHARS = 800;

const CODEX_TOKEN_EFFICIENT_TOOL_REGISTRY_CHARS = 2_800;
const CODEX_TOKEN_EFFICIENT_MAX_TOOL_DESCRIPTION_CHARS = 60;
const CODEX_TOKEN_EFFICIENT_MAX_TOOL_SCHEMA_CHARS = 96;

type CodexProviderOptions = {
  providerId?: ProviderId;
  modelId?: string;
  reasoningEffort?: CodexReasoningEffort;
};

type CodexToolTurnResponse = {
  kind: 'tool_calls' | 'final';
  tool_calls: Array<{
    name: AgentToolName;
    arguments_json: string;
  }>;
  message: string;
};

type CodexTurnResult = {
  response: CodexToolTurnResponse;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
};

type TranscriptEntry = {
  type: 'assistant' | 'tool';
  content: string;
};

function firstNonEmptyLine(value: string): string | null {
  for (const line of value.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function compactPromptText(text: string, maxChars: number, suffix: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const limit = Math.max(0, maxChars - suffix.length);
  return `${trimmed.slice(0, limit)}${suffix}`;
}

function resolveToolRegistryMaxChars(): number {
  return isTokenEfficientContextMode() ? CODEX_TOKEN_EFFICIENT_TOOL_REGISTRY_CHARS : MAX_TOOL_REGISTRY_CHARS;
}

function resolveToolDescriptionLimit(): number {
  return isTokenEfficientContextMode()
    ? CODEX_TOKEN_EFFICIENT_MAX_TOOL_DESCRIPTION_CHARS
    : MAX_TOOL_DESCRIPTION_CHARS;
}

function resolveToolSchemaLimit(): number {
  return isTokenEfficientContextMode()
    ? CODEX_TOKEN_EFFICIENT_MAX_TOOL_SCHEMA_CHARS
    : MAX_TOOL_SCHEMA_CHARS;
}

function compactSchema(schema: unknown): string {
  const raw = isTokenEfficientContextMode() ? compactSchemaProjection(schema) : JSON.stringify(schema);
  return compactPromptText(raw, resolveToolSchemaLimit(), '...[schema truncated]');
}

function compactSchemaProjection(schema: unknown): string {
  if (schema === null || typeof schema !== 'object') return JSON.stringify(schema ?? {});
  const inputSchema = schema as {
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
  const properties = inputSchema.properties;
  if (!properties || typeof properties !== 'object') {
    return JSON.stringify(schema);
  }

  const propertyKeys = Object.keys(properties).slice(0, 12);
  if (propertyKeys.length === 0) return JSON.stringify(inputSchema);

  const required = Array.isArray(inputSchema.required) ? inputSchema.required.slice(0, 6) : [];
  return JSON.stringify({
    ...(inputSchema.type ? { type: inputSchema.type } : {}),
    required: required.length > 0 ? required : undefined,
    properties: propertyKeys.reduce<Record<string, unknown>>((acc, key) => {
      const candidate = (properties as Record<string, { description?: string; type?: string }>)[key];
      if (candidate && typeof candidate === 'object') {
        acc[key] = {
          ...(candidate.type ? { type: candidate.type } : {}),
          ...(candidate.description ? { description: candidate.description } : {}),
        };
      }
      return acc;
    }, {}),
  });
}

function buildToolRegistryText(tools: AgentProviderRequest['promptTools']): string {
  if (tools.length === 0) return 'No tools are available in this runtime.';
  const selected: string[] = [];
  let usedChars = 0;

  for (const tool of tools) {
    const entry = [
      `- ${tool.name}`,
      `  Description: ${compactPromptText(tool.description, resolveToolDescriptionLimit(), '...')}`,
      `  Input schema: ${compactSchema(tool.inputSchema)}`,
    ].join('\n');

    const entryWithSeparator = selected.length === 0 ? entry : `\n\n${entry}`;
    if (usedChars + entryWithSeparator.length > resolveToolRegistryMaxChars()) {
      const omitted = tools.length - selected.length;
      if (selected.length === 0) {
        const visibleNames = tools.slice(0, MAX_TOOL_REGISTRY_NAME_LINES).map((tool) => `- ${tool.name}`);
        const additional = tools.length > visibleNames.length ? `\n...and ${tools.length - visibleNames.length} more.` : '';
        return [
          `Available tools: ${tools.length}.`,
          `Tool definitions were too large for full prompt inclusion.`,
          'Showing names only:',
          ...visibleNames,
          additional,
        ].join('\n');
      }
      selected.push(`...tool registry truncated to ${usedChars} chars (${omitted} additional tool definitions omitted).`);
    }
    if (selected.length > 0 && usedChars + entryWithSeparator.length > resolveToolRegistryMaxChars()) break;

    selected.push(entry);
    usedChars += entryWithSeparator.length;
  }

  const omitted = tools.length - selected.length;
  return [
    `Available tools: ${tools.length} total, showing ${selected.length} with full details.` + (omitted > 0 ? ` ${omitted} omitted.` : ''),
    ...selected,
  ].join('\n');
}

function buildTranscriptHistory(transcript: TranscriptEntry[]): string {
  if (transcript.length === 0) return 'No prior tool calls yet.';

  const recent = transcript.slice(-MAX_PROMPT_HISTORY_ENTRIES);
  const selected: TranscriptEntry[] = [];
  let usedChars = 0;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const entry = recent[index];
    const compactEntry = compactPromptText(entry.content, MAX_TRANSCRIPT_ENTRY_CHARS, '\n...[step truncated]');
    const nextSize = compactEntry.length + (selected.length > 0 ? 2 : 0);
    if (selected.length > 0 && usedChars + nextSize > MAX_PROMPT_HISTORY_CHARS) break;
    selected.unshift({ ...entry, content: compactEntry });
    usedChars += nextSize;
  }

  const omittedCount = transcript.length - selected.length;
  const sections: string[] = [];
  if (omittedCount > 0) {
    sections.push(`Earlier history omitted to control prompt size (${omittedCount} older steps skipped).`);
  }
  sections.push(selected.map((entry, index) => [
    `### Step ${omittedCount + index + 1} (${entry.type})`,
    entry.content,
  ].join('\n')).join('\n\n'));
  return sections.join('\n\n');
}

function buildToolPlanningPromptFrame(
  request: Pick<AgentProviderRequest, 'systemPrompt' | 'contextPrompt' | 'task'>,
  tools: AgentProviderRequest['promptTools'],
  forceFinal: boolean,
): string {

  const sections = [
    request.systemPrompt.trim(),
    '# Turn Contract',
    [
      'The shared system prompt already defines the runtime contract.',
      'This turn-specific frame only defines the structured JSON response format for codex exec.',
      forceFinal
        ? 'The host will not execute any more tools in this turn. Produce the best final answer from the evidence already gathered.'
        : 'When you need tools, respond with kind="tool_calls" and provide only the minimal next calls needed.',
    ].join('\n'),
  ];

  if (request.contextPrompt?.trim()) {
    sections.push('# Runtime Context', request.contextPrompt.trim());
  }

  sections.push(
    '# Available Tools',
    buildToolRegistryText(tools),
    '# Current User Request',
    request.task.trim(),
    '# Response Rules',
    [
      'Return JSON matching the provided response schema.',
      forceFinal
        ? 'Set kind="final", tool_calls=[], and place the user-facing answer in message.'
        : 'Either set kind="tool_calls" with tool_calls populated and keep message empty unless you need a short blocker, clarification request, or material state-change note, or set kind="final" with tool_calls=[].',
      'Each tool call arguments_json must be valid JSON encoding of the tool input object.',
      'Do not wrap JSON in markdown fences.',
    ].join('\n'),
  );

  return sections.join('\n\n');
}

function buildToolPlanningPrompt(
  request: Pick<AgentProviderRequest, 'systemPrompt' | 'contextPrompt' | 'task'>,
  tools: AgentProviderRequest['promptTools'],
  transcript: TranscriptEntry[],
  forceFinal: boolean,
): string {
  return [
    buildToolPlanningPromptFrame(request, tools, forceFinal),
    '# Prior Turn History',
    buildTranscriptHistory(transcript),
  ].join('\n\n');
}

function buildToolLoopOutputSchema(toolNames: AgentToolName[]): Record<string, unknown> {
  void toolNames;
  return {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'tool_calls', 'message'],
    properties: {
      kind: {
        type: 'string',
        enum: ['tool_calls', 'final'],
      },
      tool_calls: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'arguments_json'],
          properties: {
            name: {
              type: 'string',
            },
            arguments_json: {
              type: 'string',
            },
          },
        },
      },
      message: {
        type: 'string',
      },
    },
  };
}

function buildFinalOnlyOutputSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'tool_calls', 'message'],
    properties: {
      kind: {
        type: 'string',
        enum: ['final'],
      },
      tool_calls: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'arguments_json'],
          properties: {
            name: {
              type: 'string',
              enum: ['__no_tools__'],
            },
            arguments_json: {
              type: 'string',
            },
          },
        },
        maxItems: 0,
      },
      message: {
        type: 'string',
      },
    },
  };
}

function parseStructuredResponse(text: string): CodexToolTurnResponse {
  const parsed = JSON.parse(text) as Partial<CodexToolTurnResponse>;
  if ((parsed.kind !== 'tool_calls' && parsed.kind !== 'final')
    || !Array.isArray(parsed.tool_calls)
    || typeof parsed.message !== 'string') {
    throw new Error('Codex returned a response that does not match the runtime schema.');
  }

  return {
    kind: parsed.kind,
    tool_calls: parsed.tool_calls.map((call) => {
      if (!call || typeof call !== 'object') {
        throw new Error('Codex returned an invalid tool call entry.');
      }
      const name = (call as { name?: unknown }).name;
      const argumentsJson = (call as { arguments_json?: unknown }).arguments_json;
      if (typeof name !== 'string' || typeof argumentsJson !== 'string') {
        throw new Error('Codex returned an invalid tool call payload.');
      }
      return {
        name: name as AgentToolName,
        arguments_json: argumentsJson,
      };
    }),
    message: parsed.message,
  };
}

function recordCodexTurnTokenUsage(input: {
  request: AgentProviderRequest;
  providerId: ProviderId;
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
    providerId: input.providerId,
    runId: input.request.runId,
    summary: `Model turn token accounting: ${input.stage} #${input.turnIndex}`,
    metadata: {
      category: 'model-turn',
      providerId: input.providerId,
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

export class CodexProvider implements AgentProvider {
  readonly providerId: ProviderId;
  readonly modelId: string;
  readonly reasoningEffort?: CodexReasoningEffort;
  readonly supportsAppToolExecutor = true;

  private aborted = false;
  private activeProcess: ReturnType<typeof spawn> | null = null;

  constructor(options: CodexProviderOptions = {}) {
    this.providerId = options.providerId ?? PRIMARY_PROVIDER_ID;
    this.modelId = options.modelId ?? this.providerId;
    this.reasoningEffort = options.reasoningEffort;
  }

  static isAvailable(): { available: boolean; error?: string } {
    const probe = spawnSync('codex', ['--version'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    if (probe.error) {
      return { available: false, error: probe.error.message };
    }
    if (probe.status !== 0) {
      const stderr = firstNonEmptyLine(probe.stderr || '');
      return { available: false, error: stderr || `codex --version exited with status ${probe.status}` };
    }
    return { available: true };
  }

  abort(): void {
    this.aborted = true;
    this.activeProcess?.kill();
  }

  async invoke(request: AgentProviderRequest): Promise<AgentProviderResult> {
    this.aborted = false;
    const startedAt = Date.now();
    let inputTokens = 0;
    let outputTokens = 0;
    const completedItems = new Map<string, CodexItem>();
    const transcript: TranscriptEntry[] = [];
    const toolCatalog = request.toolCatalog;
    const toolBindingStore = createRequestToolBindingStore(request);
    const promptFrameCache = new Map<string, string>();

    const maxToolTurns = normalizeProviderMaxToolTurns(request.maxToolTurns ?? DEFAULT_PROVIDER_MAX_TOOL_TURNS);

    const buildPrompt = (tools: AgentProviderRequest['promptTools'], forceFinal: boolean): string => {
      const cacheKey = `${forceFinal ? 'final' : 'loop'}:${tools.map((tool) => tool.name).join('|')}`;
      let frame = promptFrameCache.get(cacheKey);
      if (!frame) {
        frame = buildToolPlanningPromptFrame(request, tools, forceFinal);
        promptFrameCache.set(cacheKey, frame);
      }
      return [frame, '# Prior Turn History', buildTranscriptHistory(transcript)].join('\n\n');
    };

    if (toolBindingStore.getCallableTools().length === 0) {
      const promptText = buildPrompt([], true);
      const finalResult = await this.invokeCodexTurn(
        promptText,
        buildFinalOnlyOutputSchema(),
      );
      recordCodexTurnTokenUsage({
        request,
        providerId: this.providerId,
        modelId: this.modelId,
        stage: 'final',
        turnIndex: 1,
        inputTokens: finalResult.usage.inputTokens,
        outputTokens: finalResult.usage.outputTokens,
        promptText,
        responseText: finalResult.response.message,
        toolCalls: 0,
      });
      inputTokens += finalResult.usage.inputTokens;
      outputTokens += finalResult.usage.outputTokens;
      const finalText = normalizeProviderFinalOutput(finalResult.response.message);
      request.onToken?.(finalText);

      const finalItem = publishProviderFinalOutput({
        request,
        itemId: `${this.itemPrefix('final')}-${Date.now()}`,
        text: finalText,
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

    for (let turn = 0; turn < maxToolTurns; turn++) {
      if (this.aborted) throw new Error('Task cancelled by user.');
      const callableTools = toolBindingStore.beginTurn();
      const promptText = buildPrompt(callableTools, false);

      const turnResult = await this.invokeCodexTurn(
        promptText,
        buildToolLoopOutputSchema(callableTools.map(tool => tool.name as AgentToolName)),
      );
      inputTokens += turnResult.usage.inputTokens;
      outputTokens += turnResult.usage.outputTokens;
      recordCodexTurnTokenUsage({
        request,
        providerId: this.providerId,
        modelId: this.modelId,
        stage: turnResult.response.kind === 'final' ? 'final' : 'tool-planning',
        turnIndex: turn + 1,
        inputTokens: turnResult.usage.inputTokens,
        outputTokens: turnResult.usage.outputTokens,
        promptText,
        responseText: turnResult.response.message,
        toolCalls: turnResult.response.tool_calls.length,
      });

      const response = turnResult.response;
      if (response.kind === 'final') {
        const autoExpansion = applyAutoExpandedToolPack({
          message: response.message,
          toolCatalog,
          toolBindingStore,
        });
        if (autoExpansion) {
          if (response.message.trim()) {
            transcript.push({
              type: 'assistant',
              content: response.message.trim(),
            });
          }
          request.onStatus?.(`tool-auto-expand:${autoExpansion.pack}`);
          transcript.push({
            type: 'tool',
            content: formatAutoExpandedToolPackLines(autoExpansion).join('\n'),
          });
          continue;
        }

        const finalText = normalizeProviderFinalOutput(response.message);
        request.onToken?.(finalText);
        const finalItem = publishProviderFinalOutput({
          request,
          itemId: `${this.itemPrefix('final')}-${Date.now()}`,
          text: finalText,
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

      if (response.message.trim()) {
        transcript.push({
          type: 'assistant',
          content: response.message.trim(),
        });
      }

      if (response.tool_calls.length === 0) {
        throw new Error('Codex requested a tool turn without any tool calls.');
      }

      for (let index = 0; index < response.tool_calls.length; index++) {
        const toolCall = response.tool_calls[index];
        const allowedToolNames = new Set(callableTools.map(tool => tool.name));
        if (!allowedToolNames.has(toolCall.name)) {
          const message = `Tool is not available in this runtime scope: ${toolCall.name}`;
          transcript.push({
            type: 'tool',
            content: [
              `Tool: ${toolCall.name}`,
              `Error: ${message}`,
            ].join('\n'),
          });
          request.onStatus?.(`tool-done:${toolCall.name} ... error: ${message.slice(0, 80)}`);
          continue;
        }

        let toolInput: unknown;
        try {
          toolInput = JSON.parse(toolCall.arguments_json);
        } catch (err) {
          const message = `Invalid JSON for tool ${toolCall.name}: ${err instanceof Error ? err.message : String(err)}`;
          transcript.push({
            type: 'tool',
            content: [
              `Tool: ${toolCall.name}`,
              `Input parse error: ${message}`,
            ].join('\n'),
          });
          request.onStatus?.(`tool-done:${toolCall.name} ... error: ${message.slice(0, 80)}`);
          continue;
        }

        const itemId = `${this.itemPrefix('tool')}-${turn + 1}-${index + 1}-${Date.now()}`;
        const execution = await executeProviderToolCallWithEvents({
          providerId: this.providerId,
          request,
          toolName: toolCall.name,
          toolInput,
          itemId,
          currentTools: callableTools,
        });
        completedItems.set(itemId, execution.completedItem);

        if (execution.ok) {
          const expansion = applyRuntimeToolExpansion({
            request,
            toolBindingStore,
            toolName: toolCall.name,
            result: execution.result,
          });
          if (expansion) {
            transcript.push({
              type: 'tool',
              content: [
                `Tool: ${toolCall.name}`,
                `Input: ${encodeToolInput(toolInput)}`,
                ...formatQueuedExpansionLines(expansion, { style: 'codex' }),
              ].join('\n'),
            });
            continue;
          }

          transcript.push({
            type: 'tool',
            content: [
              `Tool: ${toolCall.name}`,
              `Input: ${encodeToolInput(toolInput)}`,
              'Result:',
              execution.toolContent,
            ].join('\n'),
          });
          continue;
        }

        const message = execution.errorMessage;
        transcript.push({
          type: 'tool',
          content: [
            `Tool: ${toolCall.name}`,
            `Input: ${encodeToolInput(toolInput)}`,
            `Error: ${message}`,
          ].join('\n'),
        });
      }
    }

    const finalPrompt = buildPrompt(toolBindingStore.beginTurn(), true);
    const finalResult = await this.invokeCodexTurn(finalPrompt, buildFinalOnlyOutputSchema());
    recordCodexTurnTokenUsage({
      request,
      providerId: this.providerId,
      modelId: this.modelId,
      stage: 'final',
      turnIndex: maxToolTurns + 1,
      inputTokens: finalResult.usage.inputTokens,
      outputTokens: finalResult.usage.outputTokens,
      promptText: finalPrompt,
      responseText: finalResult.response.message,
      toolCalls: 0,
    });
    inputTokens += finalResult.usage.inputTokens;
    outputTokens += finalResult.usage.outputTokens;
    const finalText = normalizeProviderFinalOutput(finalResult.response.message);
    request.onToken?.(finalText);

    const finalItem = publishProviderFinalOutput({
      request,
      itemId: `${this.itemPrefix('final')}-${Date.now()}`,
      text: finalText,
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

  private async invokeCodexTurn(
    prompt: string,
    outputSchema: Record<string, unknown>,
  ): Promise<CodexTurnResult> {
    const schemaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-provider-'));
    const schemaPath = path.join(schemaDir, 'output-schema.json');
    fs.writeFileSync(schemaPath, JSON.stringify(outputSchema));

    return new Promise((resolve, reject) => {
      let codexProcess: ReturnType<typeof spawn>;
      try {
        codexProcess = spawn(
          'codex',
          [
            'exec',
            '--json',
            '--model',
            this.modelId,
            ...(this.reasoningEffort
              ? ['-c', `model_reasoning_effort=${JSON.stringify(this.reasoningEffort)}`]
              : []),
            '-c',
            CODEX_WEB_SEARCH_DISABLED_CONFIG,
            '--dangerously-bypass-approvals-and-sandbox',
            '--output-schema',
            schemaPath,
            '-',
          ],
          {
            cwd: process.cwd(),
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        );
      } catch (err) {
        try {
          fs.rmSync(schemaDir, { recursive: true, force: true });
        } catch {
          // Best-effort temp cleanup.
        }
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      this.activeProcess = codexProcess;

      let stderr = '';
      let stdoutRemainder = '';
      let inputTokens = 0;
      let outputTokens = 0;
      let finalFailureMessage: string | null = null;
      let finalMessageText = '';

      let settled = false;
      let inactivityTimer: NodeJS.Timeout | null = null;

      const cleanup = (): void => {
        if (inactivityTimer) {
          clearTimeout(inactivityTimer);
          inactivityTimer = null;
        }
        this.activeProcess = null;
        try {
          fs.rmSync(schemaDir, { recursive: true, force: true });
        } catch {
          // Best-effort temp cleanup.
        }
      };

      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        cleanup();
        fn();
      };

      const resetInactivityTimer = (): void => {
        if (settled) return;
        if (inactivityTimer) clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => {
          codexProcess.kill();
          finish(() => reject(new Error(`Codex exec was inactive for ${CODEX_INACTIVITY_TIMEOUT_MS / 1000}s`)));
        }, CODEX_INACTIVITY_TIMEOUT_MS);
      };

      const handleEvent = (event: CodexEvent | { type: 'error'; message: string }): void => {
        switch (event.type) {
          case 'turn.completed':
            inputTokens = event.usage.input_tokens || 0;
            outputTokens = event.usage.output_tokens || 0;
            return;
          case 'turn.failed':
            finalFailureMessage = event.error?.message || 'Codex turn failed.';
            return;
          case 'item.completed':
            if (event.item.type === 'agent_message') {
              finalMessageText = event.item.text;
            }
            return;
          case 'error':
            finalFailureMessage = event.message;
            return;
          default:
            return;
        }
      };

      const flushStdout = (): void => {
        const lines = stdoutRemainder.split('\n');
        stdoutRemainder = lines.pop() ?? '';
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;
          try {
            handleEvent(JSON.parse(line) as CodexEvent | { type: 'error'; message: string });
          } catch (err) {
            finalFailureMessage = `Failed to parse Codex response: ${err instanceof Error ? err.message : String(err)}`;
          }
        }
      };

      resetInactivityTimer();

      codexProcess.stdin?.on('error', () => {
        // Ignore broken-pipe style errors; close/error handling below is authoritative.
      });
      codexProcess.stdin?.end(prompt);

      codexProcess.stdout?.on('data', (data: Buffer) => {
        resetInactivityTimer();
        stdoutRemainder += data.toString();
        flushStdout();
      });

      codexProcess.stderr?.on('data', (data: Buffer) => {
        resetInactivityTimer();
        stderr += data.toString();
      });

      codexProcess.on('error', (err: Error) => {
        finish(() => reject(err));
      });

      codexProcess.on('close', (code: number | null) => {
        finish(() => {
          if (stdoutRemainder.trim()) {
            try {
              handleEvent(JSON.parse(stdoutRemainder.trim()) as CodexEvent | { type: 'error'; message: string });
            } catch (err) {
              finalFailureMessage = `Failed to parse Codex response: ${err instanceof Error ? err.message : String(err)}`;
            }
          }

          if (this.aborted) {
            reject(new Error('Task cancelled by user.'));
            return;
          }

          if (code !== 0) {
            const stderrLine = firstNonEmptyLine(stderr);
            reject(new Error(stderrLine || finalFailureMessage || `Codex exec failed with exit code ${code}`));
            return;
          }

          if (finalFailureMessage) {
            reject(new Error(finalFailureMessage));
            return;
          }

          if (!finalMessageText.trim()) {
            reject(new Error('Codex did not produce a structured response.'));
            return;
          }

          let response: CodexToolTurnResponse;
          try {
            response = parseStructuredResponse(finalMessageText);
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
            return;
          }

          resolve({
            response,
            usage: {
              inputTokens,
              outputTokens,
            },
          });
        });
      });
    });
  }

  private itemPrefix(kind: 'tool' | 'final'): string {
    return `${this.providerId.replace(/[^a-zA-Z0-9]+/g, '-')}-${kind}`;
  }
}
