import { escapeHtml } from '../shared/utils.js';
import type { CodexItem } from '../../shared/types/model.js';

export interface LiveRunRenderCallbacks {
  renderMarkdown: (text: string) => string;
  updateLastAgentResponseText: (text: string) => void;
  scheduleChatScrollToBottom: (force?: boolean, frames?: number) => void;
  disableChatAutoPin: () => void;
}

type ToolStackState = {
  root: HTMLElement;
  body: HTMLElement;
};

export type LiveRunCard = {
  root: HTMLElement;
  stream: HTMLElement;
  status: HTMLElement | null;
  finalResponse: HTMLElement | null;
  cancelling: boolean;
  activeToolEl: HTMLElement | null;
  currentToolStack: ToolStackState | null;
  pendingThoughtText: string;
  tokenBuffer: string;
  tokenVisibleLength: number;
  tokenTypingTimer: number | null;
  pendingFinalResult: { result: any; provider?: string } | null;
  pendingErrorText: string | null;
  callbacks: LiveRunRenderCallbacks;
};

const liveRunCards = new Map<string, LiveRunCard>();
const INITIAL_LIVE_STATUS_TEXT = 'Thinking...';

export function getLiveRunCard(taskId: string): LiveRunCard | null {
  return liveRunCards.get(taskId) ?? null;
}

export function hasLiveRunCard(taskId: string): boolean {
  return liveRunCards.has(taskId);
}

function createStatusLine(): HTMLDivElement {
  const status = document.createElement('div');
  status.className = 'chat-live-status-text';
  status.textContent = INITIAL_LIVE_STATUS_TEXT;
  return status;
}

function ensureStatusCleared(card: LiveRunCard): void {
  if (card.status?.isConnected) {
    card.status.remove();
  }
  card.status = null;
}

function ensureFinalResponse(card: LiveRunCard): HTMLElement {
  if (card.finalResponse?.isConnected) return card.finalResponse;

  const finalResponse = document.createElement('div');
  finalResponse.className = 'chat-msg-text chat-markdown chat-final-response chat-msg-streaming';
  finalResponse.dataset.liveRole = 'final-response';
  card.stream.appendChild(finalResponse);
  card.finalResponse = finalResponse;
  return finalResponse;
}

function createToolStack(): ToolStackState {
  const root = document.createElement('div');
  root.className = 'chat-tool-stack';

  const body = document.createElement('div');
  body.className = 'chat-tool-stack-body';
  root.appendChild(body);

  return { root, body };
}

function syncToolStackScroll(stack: ToolStackState): void {
  stack.body.scrollTop = stack.body.scrollHeight;
}

function ensureToolStack(card: LiveRunCard): ToolStackState {
  if (card.currentToolStack?.root.isConnected) return card.currentToolStack;
  const stack = createToolStack();
  card.stream.appendChild(stack.root);
  card.currentToolStack = stack;
  return stack;
}

function createToolRow(text: string, active: boolean): HTMLElement {
  const row = document.createElement('div');
  row.className = `chat-tool-row ${active ? 'chat-tool-row-active' : 'chat-tool-row-done'}`;
  row.textContent = text;
  return row;
}

function setToolRowState(row: HTMLElement, text: string, active: boolean): void {
  row.className = `chat-tool-row ${active ? 'chat-tool-row-active' : 'chat-tool-row-done'}`;
  row.textContent = text;
}

function appendThoughtLine(card: LiveRunCard, text: string): void {
  const line = document.createElement('div');
  line.className = 'chat-thought-line';
  line.innerHTML = escapeHtml(text)
    .replace(/\n/g, '<br>')
    .replace(/\*\*([^*]+)\*\*/g, '<span class="key">$1</span>')
    .replace(/`([^`]+)`/g, '<span class="key">$1</span>');
  card.stream.appendChild(line);
}

function normalizeThoughtTextForBuffer(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

function shouldFlushThoughtBuffer(text: string): boolean {
  return /[.!?]["')\]]?\s*$|\n\s*$/.test(text) || text.length >= 220;
}

function flushPendingThoughtText(card: LiveRunCard): void {
  const text = card.pendingThoughtText.trim();
  if (!text) {
    card.pendingThoughtText = '';
    return;
  }

  for (const chunk of normalizeThoughtChunks(text)) {
    appendThoughtLine(card, chunk);
  }
  card.pendingThoughtText = '';
}

function appendSystemLine(card: LiveRunCard, text: string): void {
  const line = document.createElement('div');
  line.className = 'chat-live-note';
  line.textContent = text;
  card.stream.appendChild(line);
}

// ─── Card Creation ──────────────────────────────────────────────────────────

export function createLiveRunCard(
  taskId: string,
  _provider: string,
  container: HTMLElement,
  callbacks: LiveRunRenderCallbacks,
  _prompt?: string,
): LiveRunCard {
  container.querySelector('.cc-chat-empty')?.remove();

  const root = document.createElement('div');
  root.className = 'chat-msg chat-msg-model chat-msg-live';
  root.dataset.taskId = taskId;

  const stream = document.createElement('div');
  stream.className = 'chat-stream';
  root.appendChild(stream);

  const status = createStatusLine();
  stream.appendChild(status);

  container.appendChild(root);

  const card: LiveRunCard = {
    root,
    stream,
    status,
    finalResponse: null,
    cancelling: false,
    activeToolEl: null,
    currentToolStack: null,
    pendingThoughtText: '',
    tokenBuffer: '',
    tokenVisibleLength: 0,
    tokenTypingTimer: null,
    pendingFinalResult: null,
    pendingErrorText: null,
    callbacks,
  };
  liveRunCards.set(taskId, card);
  return card;
}

// ─── Cancel / Stopping ──────────────────────────────────────────────────────

export function markCancelling(taskId: string): void {
  const card = liveRunCards.get(taskId);
  if (!card || card.cancelling) return;
  card.cancelling = true;

  if (card.tokenTypingTimer !== null) {
    window.cancelAnimationFrame(card.tokenTypingTimer);
    card.tokenTypingTimer = null;
  }

  flushPendingThoughtText(card);
  card.finalResponse?.classList.add('chat-response-complete');
  if (card.activeToolEl) {
    setToolRowState(card.activeToolEl, card.activeToolEl.textContent || 'Stopped tool', false);
    card.activeToolEl = null;
  }

  ensureStatusCleared(card);
  appendSystemLine(card, 'Stopped');
  card.root.classList.add('chat-msg-cancelling');
}

// ─── Token Streaming ────────────────────────────────────────────────────────

export function appendToken(taskId: string, text: string): void {
  const card = liveRunCards.get(taskId);
  if (!card || card.cancelling || !text) return;

  ensureStatusCleared(card);
  flushPendingThoughtText(card);
  card.tokenBuffer += text;
  card.tokenVisibleLength = card.tokenBuffer.length;

  const finalResponse = ensureFinalResponse(card);
  finalResponse.className = 'chat-msg-text chat-markdown chat-final-response chat-msg-streaming';
  finalResponse.innerHTML = card.callbacks.renderMarkdown(card.tokenBuffer);
  card.callbacks.updateLastAgentResponseText(card.tokenBuffer);
  card.currentToolStack = null;
  card.callbacks.scheduleChatScrollToBottom(false, 2);
  flushPendingIfReady(taskId, card);
}

function flushPendingIfReady(taskId: string, card: LiveRunCard): void {
  if (card.pendingErrorText !== null) {
    flushError(taskId, card.pendingErrorText);
    return;
  }
  if (card.pendingFinalResult) {
    const pending = card.pendingFinalResult;
    card.pendingFinalResult = null;
    flushFinalResult(taskId, pending.result, pending.provider);
  }
}

// ─── Thought Lines ──────────────────────────────────────────────────────────

function normalizeThoughtChunks(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

export function appendThought(taskId: string, text: string): void {
  const card = liveRunCards.get(taskId);
  if (!card || card.cancelling || card.tokenBuffer.length > 0) return;

  const normalized = normalizeThoughtTextForBuffer(text);
  const trimmed = normalized.trim();
  if (!trimmed) return;
  if (/^\+?\s*tool\b/i.test(trimmed) || /^tool (result|call):/i.test(trimmed)) return;
  if (/^##\s*(Critique Summary|Observation|Inference)\b/.test(trimmed)) return;

  ensureStatusCleared(card);
  card.pendingThoughtText += normalized;
  if (shouldFlushThoughtBuffer(card.pendingThoughtText)) {
    flushPendingThoughtText(card);
  }
  card.currentToolStack = null;
  card.callbacks.scheduleChatScrollToBottom(false, 1);
}

export function migrateBufferedOutputToThoughts(taskId: string): void {
  const card = liveRunCards.get(taskId);
  if (!card || card.cancelling) return;

  const text = card.tokenBuffer.trim();
  if (!text) return;

  card.tokenBuffer = '';
  card.tokenVisibleLength = 0;
  card.finalResponse?.remove();
  card.finalResponse = null;
  card.callbacks.updateLastAgentResponseText('');
  appendThought(taskId, text);
  flushPendingThoughtText(card);
}

// ─── Tool Cards ─────────────────────────────────────────────────────────────

function renderToolLine(card: LiveRunCard, kind: 'start' | 'done', text: string): void {
  ensureStatusCleared(card);
  flushPendingThoughtText(card);
  const stack = ensureToolStack(card);

  if (kind === 'start') {
    const row = createToolRow(text, true);
    stack.body.appendChild(row);
    card.activeToolEl = row;
    syncToolStackScroll(stack);
    card.callbacks.scheduleChatScrollToBottom(false, 1);
    return;
  }

  if (card.activeToolEl) {
    setToolRowState(card.activeToolEl, text, false);
    card.activeToolEl = null;
  } else {
    const row = createToolRow(text, false);
    stack.body.appendChild(row);
  }
  syncToolStackScroll(stack);
  card.callbacks.scheduleChatScrollToBottom(false, 1);
}

export function appendToolActivity(taskId: string, kind: 'call' | 'result', text: string): void {
  const card = liveRunCards.get(taskId);
  if (!card || card.cancelling) return;
  renderToolLine(card, kind === 'call' ? 'start' : 'done', text);
}

export function appendToolStatus(taskId: string, status: string): void {
  const card = liveRunCards.get(taskId);
  if (!card || card.cancelling) return;

  if (status.startsWith('tool-start:')) {
    renderToolLine(card, 'start', status.slice('tool-start:'.length));
    return;
  }

  if (status.startsWith('tool-done:')) {
    renderToolLine(card, 'done', status.slice('tool-done:'.length));
    return;
  }

  if (status.startsWith('tool-progress:')) {
    const text = status.slice('tool-progress:'.length);
    if (card.activeToolEl) {
      setToolRowState(card.activeToolEl, text, true);
      const stack = card.currentToolStack;
      if (stack) syncToolStackScroll(stack);
      card.callbacks.scheduleChatScrollToBottom(false, 1);
      return;
    }
    renderToolLine(card, 'start', text);
    return;
  }

  appendThought(taskId, status);
}

// ─── Codex Item Progress ────────────────────────────────────────────────────

export function appendCodexItemProgress(taskId: string, progressData: string, item?: CodexItem): void {
  if (!item || item.type === 'agent_message') return;
  const progress = item.status;
  const started = progress === 'in_progress' || /\bstarted$/.test(progressData);
  const completed = progress === 'completed' || /\bcompleted$/.test(progressData);
  const failed = progress === 'failed' || /\bfailed$/.test(progressData);

  if (item.type === 'mcp_tool_call') return;

  if (item.type === 'command_execution') {
    if (started) {
      appendToolStatus(taskId, `tool-start:Run ${item.command}`);
    } else if (completed) {
      const detail = item.exit_code == null ? 'done' : (item.exit_code === 0 ? 'done' : `exit ${item.exit_code}`);
      appendToolStatus(taskId, `tool-done:Run ${item.command} ... ${detail}`);
    } else if (failed) {
      appendToolStatus(taskId, `tool-done:Run ${item.command} ... failed`);
    }
    return;
  }

  if (item.type === 'file_change' && completed) {
    const detail = item.changes.map((change) => `${change.kind} ${change.path}`).join(', ') || 'updated files';
    appendToolStatus(taskId, `tool-done:File change ... ${detail}`);
  } else if (item.type === 'file_change' && failed) {
    appendToolStatus(taskId, 'tool-done:File change ... error');
  }
}

// ─── Final Result / Error ───────────────────────────────────────────────────

function flushFinalResult(taskId: string, result: any, _provider?: string): void {
  const card = liveRunCards.get(taskId);
  if (!card) return;

  ensureStatusCleared(card);
  flushPendingThoughtText(card);

  if (result.success) {
    const finalOutput = String(result.output || '');
    const finalResponse = ensureFinalResponse(card);
    finalResponse.className = 'chat-msg-text chat-markdown chat-final-response chat-msg-streaming chat-response-complete';
    if (finalOutput && finalOutput !== card.tokenBuffer) {
      finalResponse.innerHTML = card.callbacks.renderMarkdown(finalOutput);
    } else if (!finalOutput && card.tokenBuffer !== finalOutput) {
      finalResponse.innerHTML = '';
    }
    if (finalOutput) {
      card.callbacks.updateLastAgentResponseText(finalOutput);
    }
  } else {
    flushError(taskId, result.error || 'Unknown error');
    return;
  }

  card.root.classList.remove('chat-msg-live');
  card.root.classList.add('chat-msg-done');
  card.callbacks.scheduleChatScrollToBottom(false, 4);
}

export function replaceWithResult(taskId: string, result: any, provider?: string): void {
  const card = liveRunCards.get(taskId);
  if (!card) return;

  if (card.tokenVisibleLength < card.tokenBuffer.length) {
    card.pendingFinalResult = { result, provider };
    return;
  }

  flushFinalResult(taskId, result, provider);
}

function flushError(taskId: string, error: string): void {
  const card = liveRunCards.get(taskId);
  if (!card) return;

  ensureStatusCleared(card);
  flushPendingThoughtText(card);

  if (card.finalResponse?.isConnected) {
    card.finalResponse.className = 'chat-msg-error chat-final-response';
    card.finalResponse.textContent = error;
  } else {
    const errorEl = document.createElement('div');
    errorEl.className = 'chat-msg-error chat-final-response';
    errorEl.textContent = error;
    card.stream.appendChild(errorEl);
    card.finalResponse = errorEl;
  }

  card.callbacks.updateLastAgentResponseText(String(error));
  card.root.classList.remove('chat-msg-live');
  card.root.classList.add('chat-msg-done');
  card.callbacks.scheduleChatScrollToBottom(false, 4);
}

export function replaceWithError(taskId: string, error: string): void {
  const card = liveRunCards.get(taskId);
  if (!card) return;

  if (card.tokenVisibleLength < card.tokenBuffer.length) {
    card.pendingErrorText = error;
    return;
  }

  flushError(taskId, error);
}
