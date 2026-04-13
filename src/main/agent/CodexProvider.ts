import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';
import {
  PRIMARY_PROVIDER_ID,
  type CodexEvent,
  type CodexItem,
  type ProviderId,
} from '../../shared/types/model';
import { AgentProvider, AgentProviderRequest, AgentProviderResult, AgentToolName } from './AgentTypes';
import {
  DEFAULT_PROVIDER_MAX_TOOL_TURNS,
  describeProviderToolCall,
  encodeToolInput,
  executeProviderToolCallWithEvents,
  normalizeProviderMaxToolTurns,
  publishProviderFinalOutput,
  resolveToolPackExpansion,
} from './providerToolRuntime';
import { mergeExpandedTools } from './toolPacks';

const CODEX_INACTIVITY_TIMEOUT_MS = 180_000;

type CodexProviderOptions = {
  providerId?: ProviderId;
  modelId?: string;
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

function buildToolPlanningPrompt(
  request: Pick<AgentProviderRequest, 'systemPrompt' | 'contextPrompt' | 'task'>,
  tools: AgentProviderRequest['tools'],
  transcript: TranscriptEntry[],
  forceFinal: boolean,
): string {
  const toolLines = tools.length === 0
    ? ['No tools are available in this runtime.']
    : tools.map((tool) => {
      const schema = JSON.stringify(tool.inputSchema, null, 2);
      return [
        `- ${tool.name}`,
        `  Description: ${tool.description}`,
        `  Input schema: ${schema}`,
      ].join('\n');
    });

  const historyText = transcript.length === 0
    ? 'No prior tool calls yet.'
    : transcript.map((entry, index) => [
      `### Step ${index + 1} (${entry.type})`,
      entry.content,
    ].join('\n')).join('\n\n');

  const sections = [
    '# System Instructions',
    request.systemPrompt.trim(),
    '# Codex Runtime Contract',
    [
      'You are running inside the V2 runtime as a model transport only.',
      'Do not execute shell commands, do not edit files directly, and do not use Codex built-in MCP or browser capabilities.',
      'If you need external state, request one or more V2 tools and wait for the host to return results.',
      'Respect runtime validation blocks exactly as written. Do not override INVALID or INCOMPLETE verdicts.',
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
    toolLines.join('\n\n'),
    '# Current User Request',
    request.task.trim(),
    '# Prior Turn History',
    historyText,
    '# Response Rules',
    [
      'Return JSON matching the provided response schema.',
      forceFinal
        ? 'Set kind="final", tool_calls=[], and place the user-facing answer in message.'
        : 'Either set kind="tool_calls" with tool_calls populated and message as a short progress note, or set kind="final" with tool_calls=[].',
      'Each tool call arguments_json must be valid JSON encoding of the tool input object.',
      'Do not wrap JSON in markdown fences.',
    ].join('\n'),
  );

  return sections.join('\n\n');
}

function buildToolLoopOutputSchema(toolNames: AgentToolName[]): Record<string, unknown> {
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
              enum: toolNames,
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

export class CodexProvider implements AgentProvider {
  readonly providerId: ProviderId;
  readonly modelId: string;
  readonly supportsAppToolExecutor = true;

  private aborted = false;
  private activeProcess: ReturnType<typeof spawn> | null = null;

  constructor(options: CodexProviderOptions = {}) {
    this.providerId = options.providerId ?? PRIMARY_PROVIDER_ID;
    this.modelId = options.modelId ?? this.providerId;
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
    let currentTools = [...request.tools];
    const toolCatalog = request.toolCatalog?.length ? request.toolCatalog : request.tools;

    const maxToolTurns = normalizeProviderMaxToolTurns(request.maxToolTurns ?? DEFAULT_PROVIDER_MAX_TOOL_TURNS);

    if (currentTools.length === 0) {
      const finalResult = await this.invokeCodexTurn(
        buildToolPlanningPrompt(request, currentTools, transcript, true),
        buildFinalOnlyOutputSchema(),
      );
      inputTokens += finalResult.usage.inputTokens;
      outputTokens += finalResult.usage.outputTokens;

        const finalItem = publishProviderFinalOutput({
          request,
          itemId: `${this.itemPrefix('final')}-${Date.now()}`,
          text: finalResult.response.message,
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

      const turnResult = await this.invokeCodexTurn(
        buildToolPlanningPrompt(request, currentTools, transcript, false),
        buildToolLoopOutputSchema(currentTools.map(tool => tool.name as AgentToolName)),
      );
      inputTokens += turnResult.usage.inputTokens;
      outputTokens += turnResult.usage.outputTokens;

      const response = turnResult.response;
      if (response.kind === 'final') {
        const finalItem = publishProviderFinalOutput({
          request,
          itemId: `${this.itemPrefix('final')}-${Date.now()}`,
          text: response.message,
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
        request.onStatus?.(response.message.trim());
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
        const allowedToolNames = new Set(currentTools.map(tool => tool.name));
        if (!allowedToolNames.has(toolCall.name)) {
          throw new Error(`Tool is not available in this runtime scope: ${toolCall.name}`);
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
        });
        completedItems.set(itemId, execution.completedItem);

        if (execution.ok) {
          const expansion = resolveToolPackExpansion(request, toolCall.name, execution.result);
          if (expansion) {
            currentTools = mergeExpandedTools(currentTools, toolCatalog, expansion);
            const expandedToolNames = expansion.scope === 'all'
              ? ['all eligible tools']
              : expansion.tools;
            transcript.push({
              type: 'tool',
              content: [
                `Tool: ${toolCall.name}`,
                `Input: ${encodeToolInput(toolInput)}`,
                `Result: loaded tool pack "${expansion.pack}"`,
                `Description: ${expansion.description}`,
                `Expanded tools: ${expandedToolNames.join(', ')}`,
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

    const finalResult = await this.invokeCodexTurn(
      buildToolPlanningPrompt(request, currentTools, transcript, true),
      buildFinalOnlyOutputSchema(),
    );
    inputTokens += finalResult.usage.inputTokens;
    outputTokens += finalResult.usage.outputTokens;

    const finalItem = publishProviderFinalOutput({
      request,
      itemId: `${this.itemPrefix('final')}-${Date.now()}`,
      text: finalResult.response.message,
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
