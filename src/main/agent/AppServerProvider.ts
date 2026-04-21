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
  mergeLoadedTools,
  normalizeProviderMaxToolTurns,
  publishProviderFinalOutput,
  resolveLoadedToolExpansion,
} from './providerToolRuntime';
import type { AppServerProcess } from './AppServerProcess';

// ─── Constants ───────────────────────────────────────────────────────────

const THREAD_FILE = 'codex-threads.json';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const TURN_TIMEOUT_MS = 3 * 60 * 1000;
const DEFAULT_CONTEXT_PATH = path.join(os.tmpdir(), 'v2-tool-context.json');
const MAX_THREAD_REUSE_MS = 24 * 60 * 60 * 1000;
const MAX_THREAD_RESUME_COUNT = 3;
const MAX_TURN_RECOVERY_ATTEMPTS = 2;

// Use the Node 24 built-in WebSocket global via type cast.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const NativeWebSocket = (globalThis as any).WebSocket as typeof WebSocket;

// ─── Thread Registry Types ───────────────────────────────────────────────

type ThreadEntry = { threadId: string; savedAt: number; resumeCount?: number };
type ThreadRegistry = Record<string, ThreadEntry>;

type NormalizedThreadEntry = {
  threadId: string;
  savedAt: number;
  resumeCount: number;
};

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
  for (const [taskId, rawEntry] of Object.entries(entries)) {
    const entry = normalizeThreadEntry(rawEntry);
    if (!entry) continue;
    if (now - entry.savedAt <= SEVEN_DAYS_MS) {
      result[taskId] = entry;
    }
  }
  return result;
}

function normalizeThreadEntry(entry: unknown): NormalizedThreadEntry | null {
  if (!entry || typeof entry !== 'object') return null;
  const threadId = typeof (entry as { threadId?: unknown }).threadId === 'string'
    ? (entry as { threadId: string }).threadId.trim()
    : '';
  const savedAt = typeof (entry as { savedAt?: unknown }).savedAt === 'number'
    ? (entry as { savedAt: number }).savedAt
    : 0;
  const resumeCount = typeof (entry as { resumeCount?: unknown }).resumeCount === 'number'
    ? Math.max(0, Math.floor((entry as { resumeCount: number }).resumeCount))
    : 0;

  if (!threadId || !Number.isFinite(savedAt) || savedAt <= 0) return null;
  return { threadId, savedAt, resumeCount };
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

// Codex app-server uses JSON-RPC 2.0 over WebSocket.
// Responses: { id, result } or { id, error }
// Push notifications: { method, params }
type WsNotification = { method: string; params: Record<string, unknown> };
type WsResponse = { id: number; result?: Record<string, unknown>; error?: { code: number; message: string } };

// ─── Provider Options ────────────────────────────────────────────────────

type AppServerProviderOptions = {
  providerId?: ProviderId;
  modelId?: string;
  process: AppServerProcess;
  contextPath?: string;
};

type TurnStartInputItem =
  | { type: 'text'; text: string }
  | { type: 'local_image'; path: string }
  | { type: 'input_image'; image_url: string };

function mergeRecoveredMessage(prefix: string, text: string): string {
  if (!prefix) return text;
  if (!text) return prefix;
  return text.startsWith(prefix) ? text : `${prefix}${text}`;
}

class RecoverableTurnError extends Error {
  readonly partialMessage: string;
  readonly toolsCalled: boolean;

  constructor(message: string, options?: { partialMessage?: string; toolsCalled?: boolean }) {
    super(message);
    this.name = 'RecoverableTurnError';
    this.partialMessage = options?.partialMessage ?? '';
    this.toolsCalled = Boolean(options?.toolsCalled);
  }
}

// ─── Provider Implementation ─────────────────────────────────────────────

export class AppServerProvider implements AgentProvider {
  readonly providerId: ProviderId;
  readonly modelId: string;
  readonly supportsAppToolExecutor = true;

  private aborted = false;
  private abortCurrentTurn: (() => void) | null = null;
  private steerCurrentTurn: ((input: string, attachments?: AgentProviderRequest['attachments']) => void) | null = null;
  private ws: WebSocket | null = null;
  private threadRegistry: ThreadRegistry = loadThreadRegistry();
  private nextId = 1;
  private readonly contextPath: string;
  private wsPort: number | null = null;

  constructor(private readonly options: AppServerProviderOptions) {
    this.providerId = options.providerId ?? PRIMARY_PROVIDER_ID;
    this.modelId = options.modelId ?? this.providerId;
    this.contextPath = options.contextPath ?? DEFAULT_CONTEXT_PATH;
  }

  abort(): void {
    this.aborted = true;
    this.abortCurrentTurn?.();
  }

  steer(input: string, attachments?: AgentProviderRequest['attachments']): void {
    const text = input.trim();
    if (!text) return;
    this.steerCurrentTurn?.(text, attachments);
  }

  async connect(wsPort: number): Promise<void> {
    this.wsPort = wsPort;
    return new Promise<void>((resolve, reject) => {
      this.ws?.close();
      const ws = new NativeWebSocket(`ws://127.0.0.1:${wsPort}`);
      const initId = this.nextId++;

      const timer = setTimeout(() => {
        ws.removeEventListener('message', messageHandler);
        ws.close();
        reject(new Error('AppServerProvider: initialize handshake timed out'));
      }, 30_000);

      const messageHandler = (event: MessageEvent): void => {
        try {
          const msg = JSON.parse(
            typeof event.data === 'string' ? event.data : event.data.toString(),
          ) as WsResponse;
          if (msg.id === initId) {
            clearTimeout(timer);
            ws.removeEventListener('message', messageHandler);
            if (msg.error) {
              ws.close();
              reject(new Error(`AppServerProvider: initialize failed: ${msg.error.message}`));
            } else {
              ws.send(JSON.stringify({
                jsonrpc: '2.0',
                method: 'notifications/initialized',
                params: {},
              }));
              this.ws = ws;
              resolve();
            }
          }
        } catch {
          // ignore parse errors during handshake
        }
      };

      ws.addEventListener('message', messageHandler);

      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: initId,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: { experimentalApi: true },
            clientInfo: { name: 'v2', version: '1.0' },
          },
        }));
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
    const loadableTools = request.loadableTools;
    const maxToolTurns = normalizeProviderMaxToolTurns(
      request.maxToolTurns ?? DEFAULT_PROVIDER_MAX_TOOL_TURNS,
    );

    const ws = this.ws;
    if (!ws) throw new Error('AppServerProvider: not connected');

    this.writeContextFile(request);

    // Acquire or resume a thread
    const taskId = request.taskId ?? request.runId;
    const threadId = await this.acquireThread(ws, taskId, request.systemPrompt);
    if (this.aborted) throw new Error('Task cancelled by user.');

    let accumulatedMessage = '';
    let nextTurnInput: string | null = null;

    // Build the first turn's input text — prepend contextPrompt if present (same pattern as HaikuProvider)
    const firstTurnInput = request.contextPrompt?.trim()
      ? `${request.contextPrompt.trim()}\n\n## Current User Request\n\n${request.task}`
      : request.task;

    // Turn loop
    for (let turn = 0; turn < maxToolTurns; turn++) {
      if (this.aborted) throw new Error('Task cancelled by user.');

      const originalTurnInput = nextTurnInput ?? (turn === 0 ? firstTurnInput : accumulatedMessage);
      nextTurnInput = null;
      let turnInput = originalTurnInput;
      let turnResult: Awaited<ReturnType<AppServerProvider['runOneTurn']>>;
      let activeWs = this.ws;
      let recoveryAttempts = 0;
      let recoveredTextPrefix = '';

      while (true) {
        if (!activeWs) throw new Error('AppServerProvider: not connected');
        try {
          turnResult = await this.runOneTurn(activeWs, {
            threadId,
            task: turnInput,
            request,
            currentTools,
            loadableTools,
          });
          break;
        } catch (error) {
          if (!(error instanceof RecoverableTurnError) || recoveryAttempts >= MAX_TURN_RECOVERY_ATTEMPTS) {
            throw error;
          }
          if (this.aborted) throw new Error('Task cancelled by user.');

          recoveryAttempts += 1;
          request.onStatus?.(`stream-recover:${recoveryAttempts} reconnecting interrupted Codex turn`);
          if (!error.toolsCalled && error.partialMessage.trim()) {
            recoveredTextPrefix = mergeRecoveredMessage(recoveredTextPrefix, error.partialMessage);
          }
          activeWs = await this.reconnectAndResumeThread(taskId, threadId, request.systemPrompt);
          turnInput = this.buildRecoveryTurnInput(originalTurnInput, error);
        }
      }
      if (this.aborted) throw new Error('Task cancelled by user.');

      inputTokens += turnResult.inputTokens;
      outputTokens += turnResult.outputTokens;
      accumulatedMessage = mergeRecoveredMessage(recoveredTextPrefix, turnResult.message);

      for (const item of turnResult.codexItems) {
        codexItems.push(item);
      }

      // Apply explicit tool loading (from runtime.load_tools)
      if (turnResult.toolsLoaded && turnResult.expandedTools && turnResult.expansion) {
        currentTools = mergeLoadedTools(currentTools, loadableTools, turnResult.expansion);
        // Update context file so MCP shim exposes the loaded tool set on the next turn
        this.writeContextFile(request, currentTools);
      }

      if (turnResult.kind === 'final') {
        // Emit the final output
        const finalItem = publishProviderFinalOutput({
          request,
          itemId: `${this.itemPrefix('final')}-${Date.now()}`,
          text: accumulatedMessage,
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
    const normalizedExisting = normalizeThreadEntry(existing);
    if (normalizedExisting && this.shouldReuseThread(normalizedExisting)) {
      try {
        return await this.resumeThread(ws, taskId, normalizedExisting.threadId, systemPrompt);
      } catch {
        // resume failed; fall through to fork/start paths below
      }
    }
    if (normalizedExisting) {
      try {
        return await this.forkThread(ws, taskId, normalizedExisting.threadId, systemPrompt);
      } catch {
        // fork failed; delete stale entry and fall through to start
        delete this.threadRegistry[taskId];
        saveThreadRegistry(this.threadRegistry);
      }
    } else if (existing) {
      delete this.threadRegistry[taskId];
      saveThreadRegistry(this.threadRegistry);
    }
    return this.startThread(ws, taskId, systemPrompt);
  }

  private startThread(
    ws: WebSocket,
    taskId: string,
    developerInstructions: string,
  ): Promise<string> {
    const reqId = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('AppServerProvider: thread/start timed out'));
      }, TURN_TIMEOUT_MS);

      const handler = (event: MessageEvent): void => {
        try {
          const msg = JSON.parse(
            typeof event.data === 'string' ? event.data : event.data.toString(),
          ) as WsResponse;
          if (msg.id !== reqId) return;
          cleanup();
          if (msg.error) {
            reject(new Error(`AppServerProvider: thread/start failed: ${msg.error.message}`));
            return;
          }
          const thread = msg.result?.thread as { id?: string } | undefined;
          const threadId = thread?.id;
          if (!threadId) {
            reject(new Error('AppServerProvider: thread/start response missing thread.id'));
            return;
          }
          this.threadRegistry[taskId] = { threadId, savedAt: Date.now(), resumeCount: 0 };
          saveThreadRegistry(this.threadRegistry);
          resolve(threadId);
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
        jsonrpc: '2.0',
        id: reqId,
        method: 'thread/start',
        params: {
          developerInstructions,
          approvalPolicy: 'never',
          sandboxPolicy: { type: 'dangerFullAccess' },
          persistFullHistory: true,
          config: { web_search: 'disabled' },
        },
      }));
    });
  }

  private resumeThread(
    ws: WebSocket,
    taskId: string,
    threadId: string,
    developerInstructions: string,
  ): Promise<string> {
    const reqId = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('AppServerProvider: thread/resume timed out'));
      }, TURN_TIMEOUT_MS);

      const handler = (event: MessageEvent): void => {
        try {
          const msg = JSON.parse(
            typeof event.data === 'string' ? event.data : event.data.toString(),
          ) as WsResponse;
          if (msg.id !== reqId) return;
          cleanup();
          // If resume fails, reject so acquireThread falls back to start
          if (msg.error) {
            reject(new Error(`thread/resume failed: ${msg.error.message}`));
            return;
          }
          const existing = normalizeThreadEntry(this.threadRegistry[taskId]);
          this.threadRegistry[taskId] = {
            threadId,
            savedAt: Date.now(),
            resumeCount: (existing?.resumeCount ?? 0) + 1,
          };
          saveThreadRegistry(this.threadRegistry);
          resolve(threadId);
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
        jsonrpc: '2.0',
        id: reqId,
        method: 'thread/resume',
        params: {
          threadId,
          developerInstructions,
          approvalPolicy: 'never',
          sandboxPolicy: { type: 'dangerFullAccess' },
          persistFullHistory: true,
          config: { web_search: 'disabled' },
        },
      }));
    });
  }

  private forkThread(
    ws: WebSocket,
    taskId: string,
    threadId: string,
    developerInstructions: string,
  ): Promise<string> {
    const reqId = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('AppServerProvider: thread/fork timed out'));
      }, TURN_TIMEOUT_MS);

      const handler = (event: MessageEvent): void => {
        try {
          const msg = JSON.parse(
            typeof event.data === 'string' ? event.data : event.data.toString(),
          ) as WsResponse;
          if (msg.id !== reqId) return;
          cleanup();
          if (msg.error) {
            reject(new Error(`thread/fork failed: ${msg.error.message}`));
            return;
          }
          const thread = msg.result?.thread as { id?: string } | undefined;
          const forkedThreadId = thread?.id;
          if (!forkedThreadId) {
            reject(new Error('AppServerProvider: thread/fork response missing thread.id'));
            return;
          }
          this.threadRegistry[taskId] = { threadId: forkedThreadId, savedAt: Date.now(), resumeCount: 0 };
          saveThreadRegistry(this.threadRegistry);
          resolve(forkedThreadId);
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
        jsonrpc: '2.0',
        id: reqId,
        method: 'thread/fork',
        params: {
          threadId,
          developerInstructions,
          approvalPolicy: 'never',
          sandboxPolicy: { type: 'dangerFullAccess' },
          persistFullHistory: true,
          config: { web_search: 'disabled' },
        },
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
      loadableTools: AgentProviderRequest['loadableTools'];
    },
  ): Promise<{
    kind: 'final' | 'tool_calls';
    message: string;
    inputTokens: number;
    outputTokens: number;
    toolsLoaded: boolean;
    expansion?: { tools: AgentToolName[] };
    expandedTools?: AgentProviderRequest['tools'];
    codexItems: CodexItem[];
  }> {
    const { threadId, task, request, currentTools, loadableTools } = params;

    return new Promise((resolve, reject) => {
      let message = '';
      let lastInputTokens = 0;
      let lastOutputTokens = 0;
      let toolsCalled = false;
      let toolsLoaded = false;
      let expansion: { tools: AgentToolName[] } | undefined;
      let expandedTools: AgentProviderRequest['tools'] | undefined;
      const turnCodexItems: CodexItem[] = [];

      let timer: ReturnType<typeof setTimeout> | null = null;
      let settled = false;
      const resetTimer = (): void => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          cleanup();
          settled = true;
          reject(new RecoverableTurnError('AppServerProvider: turn timed out', {
            partialMessage: message,
            toolsCalled,
          }));
        }, TURN_TIMEOUT_MS);
      };

      // Wire abort — JSON-RPC notification (no id)
      this.abortCurrentTurn = (): void => {
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          method: 'turn/interrupt',
          params: { threadId },
        }));
      };
      this.steerCurrentTurn = (inputText, attachments) => {
        this.sendTurnSteer(ws, threadId, inputText, attachments);
      };

      const handler = (event: MessageEvent): void => {
        try {
          if (settled) return;
          resetTimer();
          const raw = JSON.parse(
            typeof event.data === 'string' ? event.data : event.data.toString(),
          ) as WsMsg;

          // Codex pushes notifications as { method, params } (no id field)
          const method = typeof raw.method === 'string' ? raw.method : null;
          if (!method) return; // skip responses (they have id, not method)
          const params = (raw.params && typeof raw.params === 'object')
            ? raw.params as Record<string, unknown>
            : {};

          switch (method) {
            case 'item/agentMessage/delta': {
              const delta = typeof params.delta === 'string' ? params.delta : '';
              message += delta;
              break;
            }

            case 'item/started': {
              const item = (params.item && typeof params.item === 'object')
                ? params.item as WsMsg
                : null;
              if (item?.type === 'mcpToolCall') {
                toolsCalled = true;
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
              const item = (params.item && typeof params.item === 'object')
                ? params.item as WsMsg
                : null;
              if (item?.type === 'mcpToolCall') {
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

                // Check for tool loading from runtime.load_tools
                if (toolName === 'runtime.load_tools' && !error && result) {
                  const toolResult = {
                    summary: '',
                    data: (typeof result === 'object' && result !== null)
                      ? result as Record<string, unknown>
                      : {},
                  };
                  const exp = resolveLoadedToolExpansion(
                    { loadableTools },
                    toolName as AgentToolName,
                    toolResult,
                  );
                  if (exp) {
                    toolsLoaded = true;
                    expansion = exp;
                    expandedTools = mergeLoadedTools(currentTools, loadableTools, exp);
                  }
                }
              }
              break;
            }

            case 'thread/tokenUsage/updated': {
              // Each event is a snapshot for the current turn (not a delta).
              const tokenUsage = (params.tokenUsage && typeof params.tokenUsage === 'object')
                ? params.tokenUsage as Record<string, unknown>
                : null;
              const last = (tokenUsage?.last && typeof tokenUsage.last === 'object')
                ? tokenUsage.last as { inputTokens?: number; outputTokens?: number }
                : null;
              if (last) {
                lastInputTokens = last.inputTokens ?? 0;
                lastOutputTokens = last.outputTokens ?? 0;
              }
              break;
            }

            case 'turn/completed': {
              cleanup();
              settled = true;
              resolve({
                kind: toolsCalled ? 'tool_calls' : 'final',
                message,
                inputTokens: lastInputTokens,
                outputTokens: lastOutputTokens,
                toolsLoaded,
                expansion,
                expandedTools,
                codexItems: turnCodexItems,
              });
              break;
            }

            case 'turn/failed': {
              cleanup();
              settled = true;
              const turnData = (params.turn && typeof params.turn === 'object')
                ? params.turn as { error?: { message?: string } }
                : null;
              const errMsg = turnData?.error?.message || 'Turn failed';
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

      const closeHandler = (): void => {
        if (settled) return;
        cleanup();
        settled = true;
        reject(new RecoverableTurnError('AppServerProvider: WebSocket closed during turn', {
          partialMessage: message,
          toolsCalled,
        }));
      };

      const errorHandler = (): void => {
        if (settled) return;
        cleanup();
        settled = true;
        reject(new RecoverableTurnError('AppServerProvider: WebSocket error during turn', {
          partialMessage: message,
          toolsCalled,
        }));
      };

      const cleanup = (): void => {
        if (timer) clearTimeout(timer);
        this.abortCurrentTurn = null;
        this.steerCurrentTurn = null;
        ws.removeEventListener('message', handler);
        ws.removeEventListener('close', closeHandler);
        ws.removeEventListener('error', errorHandler);
      };

      const turnReqId = this.nextId++;
      const input = this.buildTurnStartInput(task, request.attachments);
      ws.addEventListener('message', handler);
      ws.addEventListener('close', closeHandler);
      ws.addEventListener('error', errorHandler);
      resetTimer();
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id: turnReqId,
        method: 'turn/start',
        params: {
          threadId,
          input,
          approvalPolicy: 'never',
          sandboxPolicy: { type: 'dangerFullAccess' },
        },
      }));
    });
  }

  // ─── Private: Helpers ────────────────────────────────────────────────────

  private writeContextFile(
    request: AgentProviderRequest,
    currentTools?: Array<{ name: string }>,
  ): void {
    try {
      const toolNames = (currentTools ?? request.tools).map((t) => t.name);
      fs.writeFileSync(
        this.contextPath,
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

  private sendTurnSteer(
    ws: WebSocket,
    threadId: string,
    inputText: string,
    attachments?: AgentProviderRequest['attachments'],
  ): void {
    const input = this.buildTurnStartInput(inputText, attachments);
    ws.send(JSON.stringify({
      jsonrpc: '2.0',
      method: 'turn/steer',
      params: {
        threadId,
        input,
      },
    }));
  }

  private shouldReuseThread(entry: NormalizedThreadEntry): boolean {
    if (Date.now() - entry.savedAt > MAX_THREAD_REUSE_MS) return false;
    if (entry.resumeCount >= MAX_THREAD_RESUME_COUNT) return false;
    return true;
  }

  private buildRecoveryTurnInput(originalTurnInput: string, error: RecoverableTurnError): string {
    const partial = error.partialMessage.trim();
    if (!error.toolsCalled && partial) {
      return [
        'Your previous response was interrupted before it completed.',
        `It ended with:\n${partial}`,
        'Continue from where you left off without repeating the text already provided.',
      ].join('\n\n');
    }
    return originalTurnInput;
  }

  private async reconnectAndResumeThread(
    taskId: string,
    threadId: string,
    systemPrompt: string,
  ): Promise<WebSocket> {
    const port = this.wsPort ?? (await this.options.process.waitUntilReady()).wsPort;
    await this.connect(port);
    const ws = this.ws;
    if (!ws) {
      throw new Error('AppServerProvider: reconnect failed to establish a WebSocket');
    }
    await this.resumeThread(ws, taskId, threadId, systemPrompt);
    return ws;
  }

  private buildTurnStartInput(
    task: string,
    attachments?: AgentProviderRequest['attachments'],
  ): TurnStartInputItem[] {
    const input: TurnStartInputItem[] = [];
    const text = task.trim();
    if (text) {
      input.push({ type: 'text', text });
    }

    for (const attachment of attachments || []) {
      if (attachment.type !== 'image') continue;
      const filePath = attachment.path?.trim();
      if (filePath) {
        input.push({ type: 'local_image', path: filePath });
        continue;
      }
      input.push({
        type: 'input_image',
        image_url: `data:${attachment.mediaType};base64,${attachment.data}`,
      });
    }

    if (input.length === 0) {
      input.push({ type: 'text', text: task });
    }
    return input;
  }
}
