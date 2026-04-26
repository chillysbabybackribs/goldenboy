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
} from './AgentTypes';
import {
  DEFAULT_PROVIDER_MAX_TOOL_TURNS,
  describeProviderToolCall,
  normalizeProviderMaxToolTurns,
  publishProviderFinalOutput,
  summarizeProviderToolCompletion,
} from './providerToolRuntime';
import type { AppServerProcess } from './AppServerProcess';
import { createToolScopeState, listActiveTools } from './toolScopeState';

// ─── Constants ───────────────────────────────────────────────────────────

const THREAD_FILE = 'codex-threads.json';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
// Hard wall-clock limit for a single turn, armed once at turn/start and
// NEVER reset by incoming notifications. Protects against stalled turns
// that would otherwise sit forever if Codex keeps the socket warm with
// tokenUsage keepalives while failing to emit turn/completed.
const TURN_TIMEOUT_MS = 3 * 60 * 1000;
// Idle deadline for a single turn. Reset on every inbound message.
// Fires when the stream genuinely stalls (no deltas, no tool lifecycle
// events, no tokenUsage updates, no turn/completed). Shorter than the
// wall-clock so real stalls convert to a RecoverableTurnError and go
// through the reconnect+resume path instead of hanging the UI.
const TURN_IDLE_TIMEOUT_MS = 30 * 1000;
const DEFAULT_CONTEXT_PATH = path.join(os.tmpdir(), 'v2-tool-context.json');
const MAX_THREAD_REUSE_MS = 24 * 60 * 60 * 1000;
const MAX_THREAD_RESUME_COUNT = 3;
const MAX_TURN_RECOVERY_ATTEMPTS = 2;
// Minimal, non-directive continuation token sent as the user input for
// post-tool turns. The previous multi-sentence paragraph ("Continue the
// task using the tool results…, If the next tool call is obvious, call
// it immediately…") was measurably biasing the model toward re-issuing
// the same tool call — duplicate `browser.open_tab` chips at the start
// of every deterministic smoke test. One neutral word lets the thread
// history and tool results drive the next turn without adding steering
// noise to the conversation.
const POST_TOOL_CONTINUATION_INPUT = 'continue';
const ANSWER_SUBMIT_TOOL_NAME = 'answer.submit';

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

function normalizeAgentMessageText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function deriveCanonicalAgentTurnMessage(completedMessages: string[], streamedMessage: string): string {
  const finalizedMessages = completedMessages.map((text) => text.trim()).filter(Boolean);
  if (finalizedMessages.length === 0) return streamedMessage.replace(/\s+$/, '');
  if (finalizedMessages.length === 1) return finalizedMessages[0];

  let cumulativeSnapshots = true;
  for (let i = 1; i < finalizedMessages.length; i++) {
    const prev = normalizeAgentMessageText(finalizedMessages[i - 1]);
    const next = normalizeAgentMessageText(finalizedMessages[i]);
    if (!prev || !next || next.length < prev.length || !next.includes(prev)) {
      cumulativeSnapshots = false;
      break;
    }
  }

  return cumulativeSnapshots
    ? finalizedMessages[finalizedMessages.length - 1]
    : streamedMessage.replace(/\s+$/, '');
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
  | { type: 'localImage'; path: string }
  | { type: 'image'; url: string };

function mergeRecoveredMessage(prefix: string, text: string): string {
  if (!prefix) return text;
  if (!text) return prefix;
  return text.startsWith(prefix) ? text : `${prefix}${text}`;
}

function shouldSuppressPreToolText(task: string): boolean {
  return /\b(navigate|go to|open|visit|click|type|fill|submit|login|log in|sign in|upload|download|search|research|inspect|extract|summarize|snapshot|close|activate|switch|fix|edit|patch|build|test|run)\b/i
    .test(task);
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
  private partialUsage: AgentProviderResult['usage'] | null = null;

  constructor(private readonly options: AppServerProviderOptions) {
    this.providerId = options.providerId ?? PRIMARY_PROVIDER_ID;
    this.modelId = options.modelId ?? this.providerId;
    this.contextPath = options.contextPath ?? DEFAULT_CONTEXT_PATH;
  }

  abort(): void {
    this.aborted = true;
    this.abortCurrentTurn?.();
  }

  getPartialUsage(): AgentProviderResult['usage'] | null {
    return this.partialUsage;
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
    const toolScope = request.toolScope ?? createToolScopeState(request.tools);
    const runtimeRequest = request.toolScope ? request : { ...request, toolScope };
    this.aborted = false;
    this.partialUsage = null;
    const startedAt = Date.now();
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedInputTokens = 0;
    const snapshotPartial = (): void => {
      this.partialUsage = {
        inputTokens,
        outputTokens,
        cachedInputTokens,
        durationMs: Date.now() - startedAt,
      };
    };
    const codexItems: CodexItem[] = [];
    let currentTools = listActiveTools(toolScope);
    const maxToolTurns = normalizeProviderMaxToolTurns(
      request.maxToolTurns ?? DEFAULT_PROVIDER_MAX_TOOL_TURNS,
    );

    const ws = this.ws;
    if (!ws) throw new Error('AppServerProvider: not connected');

    this.writeContextFile(runtimeRequest, currentTools);

    // Acquire or resume a thread
    const taskId = request.taskId ?? request.runId;
    const threadId = await this.acquireThread(ws, taskId, request.systemPrompt, request.forceFreshThread === true);
    if (this.aborted) throw new Error('Task cancelled by user.');

    let accumulatedMessage = '';
    let nextTurnInput: string | null = null;

    // Build the first turn's input text — prepend contextPrompt if present.
    const firstTurnInput = request.contextPrompt?.trim()
      ? `${request.contextPrompt.trim()}\n\n## Current User Request\n\n${request.task}`
      : request.task;

    // Turn loop
    for (let turn = 0; turn < maxToolTurns; turn++) {
      if (this.aborted) throw new Error('Task cancelled by user.');

      const originalTurnInput = nextTurnInput ?? (turn === 0 ? firstTurnInput : POST_TOOL_CONTINUATION_INPUT);
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
            request: runtimeRequest,
            currentTools,
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
      cachedInputTokens += turnResult.cachedInputTokens;
      snapshotPartial();
      accumulatedMessage = mergeRecoveredMessage(recoveredTextPrefix, turnResult.message);

      for (const item of turnResult.codexItems) {
        codexItems.push(item);
      }

      if (turnResult.kind === 'final') {
        // Emit the final output. Tokens already streamed live through the
        // delta handler, so we skip re-emitting them to avoid doubling the
        // response text in the chat UI's typewriter buffer.
        const finalItem = publishProviderFinalOutput({
          request,
          itemId: `${this.itemPrefix('final')}-${Date.now()}`,
          text: accumulatedMessage,
          emitToken: false,
        });
        codexItems.push(finalItem);

        return {
          output: finalItem.text,
          codexItems,
          usage: {
            inputTokens,
            outputTokens,
            cachedInputTokens,
            durationMs: Date.now() - startedAt,
          },
        };
      }

      // kind === 'tool_calls' -> next turn.
      // Signal to the live-run UI that the descriptive text for this turn is
      // finished so it can clear the current "status line" before the next
      // turn's deltas start streaming. Without this, every turn's text piles
      // up into a single concatenated paragraph and the user loses the sense
      // that each turn is a distinct thinking step.
      request.onStatus?.('turn-boundary');
    }

    // Exhausted tool turns; synthesize final. Any streamed deltas from the
    // last turn already flowed through onToken, so only emit tokens when we
    // fall back to the canned "Max tool turns" message (which was never part
    // of the delta stream and needs to reach the UI through some channel).
    const fallbackMessage = 'Max tool turns reached without a final answer.';
    const fallbackNeeded = !accumulatedMessage.trim();
    const finalItem = publishProviderFinalOutput({
      request,
      itemId: `${this.itemPrefix('final')}-${Date.now()}`,
      text: fallbackNeeded ? fallbackMessage : accumulatedMessage,
      emitToken: fallbackNeeded,
    });
    codexItems.push(finalItem);

    return {
      output: finalItem.text,
      codexItems,
      usage: {
        inputTokens,
        outputTokens,
        cachedInputTokens,
        durationMs: Date.now() - startedAt,
      },
    };
  }

  // ─── Private: Thread Management ──────────────────────────────────────────

  private async acquireThread(
    ws: WebSocket,
    taskId: string,
    systemPrompt: string,
    forceFreshThread = false,
  ): Promise<string> {
    if (forceFreshThread) {
      return this.startThread(ws, taskId, systemPrompt);
    }
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
    },
  ): Promise<{
    kind: 'final' | 'tool_calls';
    message: string;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    codexItems: CodexItem[];
  }> {
    const { threadId, task, request, currentTools } = params;
    const turnReqId = this.nextId++;

    return new Promise((resolve, reject) => {
      let message = '';
      const completedAgentMessages: string[] = [];
      let pendingPreToolDelta = '';
      const suppressPreToolText = shouldSuppressPreToolText(request.task);
      let lastInputTokens = 0;
      let lastOutputTokens = 0;
      let lastCachedInputTokens = 0;
      let toolsCalled = false;
      // Set when a successful `answer.submit` MCP tool call completes in
      // this turn. Treated as the terminal signal regardless of whether
      // other tools fired in the same turn — the prompt tells the model
      // to end every run with `answer.submit`, so the provider must
      // classify its presence as 'final' or the outer loop will queue
      // another empty turn and leave the UI stuck on "Exploring ideas".
      let finalAnswerSubmitted = false;
      const turnCodexItems: CodexItem[] = [];

      // Split timers — see constant comments above.
      //   wallClockTimer : armed once, never reset; guards against any
      //                    form of stall including keepalive flooding.
      //   idleTimer      : reset on every inbound message; converts a
      //                    silent socket into a RecoverableTurnError
      //                    quickly enough for the reconnect path to
      //                    salvage the turn before the wall clock fires.
      let wallClockTimer: ReturnType<typeof setTimeout> | null = null;
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      let settled = false;
      const armWallClockTimer = (): void => {
        wallClockTimer = setTimeout(() => {
          cleanup();
          settled = true;
          reject(new RecoverableTurnError('AppServerProvider: turn wall-clock timeout', {
            partialMessage: message,
            toolsCalled,
          }));
        }, TURN_TIMEOUT_MS);
      };
      const resetIdleTimer = (): void => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          cleanup();
          settled = true;
          reject(new RecoverableTurnError('AppServerProvider: turn idle timeout', {
            partialMessage: message,
            toolsCalled,
          }));
        }, TURN_IDLE_TIMEOUT_MS);
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
          // Only the idle timer resets per-message — the wall clock is
          // armed once at turn/start and never extended. This lets
          // Codex's per-second tokenUsage keepalives keep the idle
          // timer quiet without sliding the hard deadline forward.
          resetIdleTimer();
          const raw = JSON.parse(
            typeof event.data === 'string' ? event.data : event.data.toString(),
          ) as WsMsg;

          if (raw.id === turnReqId) {
            const response = raw as WsResponse;
            if (response.error) {
              cleanup();
              settled = true;
              reject(new Error(`AppServerProvider: turn start failed: ${response.error.message}`));
            }
            return;
          }

          // Codex pushes notifications as { method, params } (no id field)
          const method = typeof raw.method === 'string' ? raw.method : null;
          if (!method) return; // skip responses (they have id, not method)
          const params = (raw.params && typeof raw.params === 'object')
            ? raw.params as Record<string, unknown>
            : {};

          switch (method) {
            case 'item/agentMessage/delta': {
              const delta = typeof params.delta === 'string' ? params.delta : '';
              if (delta) {
                message += delta;
                if (suppressPreToolText && !toolsCalled) {
                  pendingPreToolDelta += delta;
                } else {
                  request.onToken?.(delta);
                }
              }
              break;
            }

            case 'item/started': {
              const item = (params.item && typeof params.item === 'object')
                ? params.item as WsMsg
                : null;
              if (item?.type === 'mcpToolCall') {
                toolsCalled = true;
                pendingPreToolDelta = '';
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
              if (item?.type === 'agentMessage') {
                const completedText = typeof item.text === 'string' ? item.text.trim() : '';
                if (completedText) completedAgentMessages.push(completedText);
                // Each agentMessage item is a complete "thought" the model
                // emits, and a single turn can contain several back-to-back.
                // The accumulated buffer keeps a '\n\n' separator so the
                // final published message preserves paragraph structure
                // (trimmed in turn/completed). The live UI receives a
                // distinct `thought-boundary` status instead of a sentinel
                // token so the renderer can commit the finished paragraph
                // to its thoughts[] log without pattern-matching the stream.
                message += '\n\n';
                request.onStatus?.('thought-boundary');
                break;
              }
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
                  : summarizeProviderToolCompletion(result, false);
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

                // Terminal-turn detection. The system prompt instructs
                // every run to end with `answer.submit`, and a failing
                // submission (e.g. grounding gate rejection) rethrows
                // as `error` here — in that case we want the outer
                // loop to ask the model to revise. A successful
                // submission is the last thing the model will ever
                // emit for this task, so forcing kind='final' below
                // prevents an empty follow-up turn from hanging the
                // live-run card on "Exploring ideas".
                if (toolName === ANSWER_SUBMIT_TOOL_NAME && !error) {
                  finalAnswerSubmitted = true;
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
                ? tokenUsage.last as {
                    inputTokens?: number;
                    outputTokens?: number;
                    cachedInputTokens?: number;
                    reasoningOutputTokens?: number;
                  }
                : null;
              if (last) {
                lastInputTokens = last.inputTokens ?? 0;
                // Codex app-server reports reasoning tokens separately from
                // output; they are billed as output so include them here.
                lastOutputTokens = (last.outputTokens ?? 0) + (last.reasoningOutputTokens ?? 0);
                lastCachedInputTokens = last.cachedInputTokens ?? 0;
              }
              break;
            }

            case 'turn/completed': {
              if (suppressPreToolText && !toolsCalled && pendingPreToolDelta) {
                request.onToken?.(pendingPreToolDelta);
                pendingPreToolDelta = '';
              }
              cleanup();
              settled = true;
              // `finalAnswerSubmitted` wins over `toolsCalled` — a
              // successful answer.submit is terminal even when other
              // tools ran earlier in the same turn.
              const kind: 'final' | 'tool_calls' = finalAnswerSubmitted
                ? 'final'
                : toolsCalled
                  ? 'tool_calls'
                  : 'final';
              resolve({
                kind,
                message: deriveCanonicalAgentTurnMessage(completedAgentMessages, message),
                inputTokens: lastInputTokens,
                outputTokens: lastOutputTokens,
                cachedInputTokens: lastCachedInputTokens,
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
        if (wallClockTimer) clearTimeout(wallClockTimer);
        if (idleTimer) clearTimeout(idleTimer);
        this.abortCurrentTurn = null;
        this.steerCurrentTurn = null;
        ws.removeEventListener('message', handler);
        ws.removeEventListener('close', closeHandler);
        ws.removeEventListener('error', errorHandler);
      };

      const input = this.buildTurnStartInput(task, request.attachments);
      ws.addEventListener('message', handler);
      ws.addEventListener('close', closeHandler);
      ws.addEventListener('error', errorHandler);
      armWallClockTimer();
      resetIdleTimer();
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
          toolScope: {
            activeTools: currentTools ?? request.toolScope.activeTools,
          },
          toolNames,
          runtimeAllowedTools: request.runtimeAllowedTools ?? 'all',
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
        input.push({ type: 'localImage', path: filePath });
        continue;
      }
      input.push({
        type: 'image',
        url: `data:${attachment.mediaType};base64,${attachment.data}`,
      });
    }

    if (input.length === 0) {
      input.push({ type: 'text', text: task });
    }
    return input;
  }
}
