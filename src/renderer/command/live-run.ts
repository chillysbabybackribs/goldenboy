import { escapeHtml } from '../shared/utils.js';
import type { CodexItem } from '../../shared/types/model.js';

export interface LiveRunRenderCallbacks {
  renderMarkdown: (text: string) => string;
  updateLastAgentResponseText: (text: string) => void;
  scheduleChatScrollToBottom: (force?: boolean, frames?: number) => void;
  disableChatAutoPin: () => void;
}

interface ToolEntry {
  kind: 'start' | 'done';
  text: string;
}

export type LiveRunCard = {
  root: HTMLElement;
  /** "Thinking..." indicator above everything — shown only before first tool/token */
  status: HTMLElement;
  /** Fixed-height panel listing tool calls in sequence with internal autoscroll */
  toolPanel: HTMLElement;
  /** List inside toolPanel holding one row per tool call */
  toolList: HTMLElement;
  /** The streaming markdown output — grows in place, single DOM node */
  output: HTMLElement;
  /** Whether the user has requested cancellation */
  cancelling: boolean;
  /** Accumulated raw tokens */
  tokenBuffer: string;
  /** Visible token length (typewriter target) */
  tokenVisibleLength: number;
  tokenTypingTimer: number | null;
  tokenChunkSize: number;
  /** All tool entries in order (for the post-completion disclosure) */
  tools: ToolEntry[];
  /** Currently-active tool row element (the one with the spinner) */
  activeToolRow: HTMLElement | null;
  pendingFinalResult: { result: any; provider?: string } | null;
  pendingErrorText: string | null;
  // Unused fields kept for shape compatibility with existing external refs
  meta: HTMLElement | null;
  panel: HTMLElement;
  stream: HTMLElement;
  toolHistory: HTMLElement;
  layoutLocked: boolean;
  activeToolEl: HTMLElement | null;
  lastThoughtEl: HTMLElement | null;
  typingQueue: string[];
  typingTimer: number | null;
  activeThoughtEl: HTMLElement | null;
  deferredToolEvents: Array<{ kind: 'start' | 'done'; text: string }>;
  callbacks: LiveRunRenderCallbacks;
};

const liveRunCards = new Map<string, LiveRunCard>();

export function getLiveRunCard(taskId: string): LiveRunCard | null {
  return liveRunCards.get(taskId) ?? null;
}

export function hasLiveRunCard(taskId: string): boolean {
  return liveRunCards.has(taskId);
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

  // Dim previous assistant turns (hide was already handled by the turn wrapper).
  const chatInner = container.closest('.cc-chat-inner') ?? container;
  chatInner.querySelectorAll<HTMLElement>('.chat-msg-model.chat-msg-done').forEach(el => {
    el.classList.add('chat-msg-archived');
  });

  const root = document.createElement('div');
  root.className = 'chat-msg chat-msg-model chat-msg-live';
  root.dataset.taskId = taskId;

  root.innerHTML =
    `<div class="chat-live-status chat-live-status-thinking">` +
      `<span class="chat-live-status-dot"></span>` +
      `<span class="chat-live-status-dot"></span>` +
      `<span class="chat-live-status-dot"></span>` +
      `<span class="chat-live-status-text">Thinking</span>` +
    `</div>` +
    `<div class="chat-live-tools" hidden>` +
      `<div class="chat-live-tools-header">` +
        `<span class="chat-live-tools-spinner"></span>` +
        `<span class="chat-live-tools-title">Running tools</span>` +
        `<span class="chat-live-tools-count">0</span>` +
      `</div>` +
      `<div class="chat-live-tools-list"></div>` +
    `</div>` +
    `<div class="chat-msg-text chat-markdown"></div>`;

  container.appendChild(root);

  const status = root.querySelector('.chat-live-status') as HTMLElement;
  const toolPanel = root.querySelector('.chat-live-tools') as HTMLElement;
  const toolList = root.querySelector('.chat-live-tools-list') as HTMLElement;
  const output = root.querySelector('.chat-msg-text') as HTMLElement;

  const card: LiveRunCard = {
    root,
    status,
    toolPanel,
    toolList,
    output,
    cancelling: false,
    tokenBuffer: '',
    tokenVisibleLength: 0,
    tokenTypingTimer: null,
    tokenChunkSize: 8,
    tools: [],
    activeToolRow: null,
    pendingFinalResult: null,
    pendingErrorText: null,
    // Legacy / unused
    meta: null,
    panel: root,
    stream: toolList,
    toolHistory: toolList,
    layoutLocked: false,
    activeToolEl: null,
    lastThoughtEl: null,
    typingQueue: [],
    typingTimer: null,
    activeThoughtEl: null,
    deferredToolEvents: [],
    callbacks,
  };
  liveRunCards.set(taskId, card);
  return card;
}

// ─── Status + tool panel ────────────────────────────────────────────────────

function hideStatus(card: LiveRunCard): void {
  card.status.classList.add('chat-live-status-hidden');
}

function showToolPanel(card: LiveRunCard): void {
  if (card.toolPanel.hidden) {
    card.toolPanel.hidden = false;
  }
}

function updateToolCount(card: LiveRunCard): void {
  const starts = card.tools.filter(t => t.kind === 'start').length;
  const countEl = card.toolPanel.querySelector('.chat-live-tools-count');
  if (countEl) countEl.textContent = String(starts);
}

function createToolRow(text: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'chat-live-tool-row chat-live-tool-row-active';
  row.innerHTML =
    `<span class="chat-live-tool-dot"></span>` +
    `<span class="chat-live-tool-text">${escapeHtml(text)}</span>`;
  return row;
}

function markToolRowDone(row: HTMLElement, text: string): void {
  row.className = 'chat-live-tool-row chat-live-tool-row-done';
  const textEl = row.querySelector('.chat-live-tool-text');
  if (textEl) textEl.textContent = text;
}

function autoscrollToolList(card: LiveRunCard): void {
  requestAnimationFrame(() => {
    card.toolList.scrollTop = card.toolList.scrollHeight;
  });
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
  card.output.classList.remove('chat-msg-streaming');

  // Stop any active tool spinner
  if (card.activeToolRow) {
    card.activeToolRow.classList.remove('chat-live-tool-row-active');
    card.activeToolRow.classList.add('chat-live-tool-row-done');
    card.activeToolRow = null;
  }

  // Swap thinking indicator for a "Stopped" message
  card.status.className = 'chat-live-status chat-live-status-stopped';
  card.status.innerHTML = `<span class="chat-live-status-text">Stopped</span>`;
  card.status.classList.remove('chat-live-status-hidden');

  card.root.classList.add('chat-msg-cancelling');
}

// ─── Token Streaming (typewriter) ───────────────────────────────────────────

export function appendToken(taskId: string, text: string): void {
  const card = liveRunCards.get(taskId);
  if (!card || card.cancelling) return;
  if (!text) return;
  if (card.tokenBuffer.length === 0) {
    hideStatus(card);
  }
  card.tokenBuffer += text;
  card.output.className = 'chat-msg-text chat-markdown chat-msg-streaming';

  if (card.tokenTypingTimer === null) {
    scheduleTypewriterTick(taskId, card);
  }
}

function scheduleTypewriterTick(taskId: string, card: LiveRunCard): void {
  card.tokenTypingTimer = window.requestAnimationFrame(() => {
    card.tokenTypingTimer = null;

    const lag = card.tokenBuffer.length - card.tokenVisibleLength;
    if (lag <= 0) {
      flushPendingIfReady(taskId, card);
      return;
    }

    if (lag > 200) {
      card.tokenChunkSize = Math.min(card.tokenChunkSize + 4, 60);
    } else if (lag < 30) {
      card.tokenChunkSize = Math.max(card.tokenChunkSize - 2, 6);
    }

    card.tokenVisibleLength = Math.min(
      card.tokenVisibleLength + card.tokenChunkSize,
      card.tokenBuffer.length,
    );
    const visible = card.tokenBuffer.slice(0, card.tokenVisibleLength);
    card.output.innerHTML = card.callbacks.renderMarkdown(visible);
    card.callbacks.updateLastAgentResponseText(visible);

    if (card.tokenVisibleLength < card.tokenBuffer.length) {
      scheduleTypewriterTick(taskId, card);
    } else {
      flushPendingIfReady(taskId, card);
    }
  });
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

// ─── Thoughts (no-op in the UI — thoughts are noise during streaming) ──────

export function appendThought(_taskId: string, _text: string): void {
  // Intentionally empty: we don't render reasoning thoughts in the live card.
  // The final markdown output is the source of truth.
}

// ─── Tool Activity ──────────────────────────────────────────────────────────

function renderToolStart(card: LiveRunCard, text: string): void {
  hideStatus(card);
  showToolPanel(card);
  const row = createToolRow(text);
  card.toolList.appendChild(row);
  card.activeToolRow = row;
  card.tools.push({ kind: 'start', text });
  updateToolCount(card);
  autoscrollToolList(card);
}

function renderToolDone(card: LiveRunCard, text: string): void {
  if (card.activeToolRow) {
    markToolRowDone(card.activeToolRow, text);
    card.activeToolRow = null;
  } else {
    // No active row — append a completed row directly
    showToolPanel(card);
    const row = createToolRow(text);
    markToolRowDone(row, text);
    card.toolList.appendChild(row);
  }
  card.tools.push({ kind: 'done', text });
  autoscrollToolList(card);
}

function renderToolProgress(card: LiveRunCard, text: string): void {
  if (card.activeToolRow) {
    const textEl = card.activeToolRow.querySelector('.chat-live-tool-text');
    if (textEl) textEl.textContent = text;
    autoscrollToolList(card);
  } else {
    renderToolStart(card, text);
  }
}

export function appendToolActivity(taskId: string, kind: 'call' | 'result', text: string): void {
  const card = liveRunCards.get(taskId);
  if (!card || card.cancelling) return;
  if (kind === 'call') renderToolStart(card, text);
  else renderToolDone(card, text);
}

export function appendToolStatus(taskId: string, status: string): void {
  const card = liveRunCards.get(taskId);
  if (!card || card.cancelling) return;

  if (status.startsWith('tool-start:')) {
    renderToolStart(card, status.slice('tool-start:'.length));
    return;
  }
  if (status.startsWith('tool-done:')) {
    renderToolDone(card, status.slice('tool-done:'.length));
    return;
  }
  if (status.startsWith('tool-progress:')) {
    renderToolProgress(card, status.slice('tool-progress:'.length));
    return;
  }
}

// ─── Codex Item Progress ────────────────────────────────────────────────────

export function appendCodexItemProgress(taskId: string, progressData: string, item?: CodexItem): void {
  if (!item) return;
  if (item.type === 'agent_message') return;
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
    appendToolStatus(taskId, `tool-done:File change ... error`);
  }
}

// ─── Final Result / Error ───────────────────────────────────────────────────

/**
 * Collapse the live tool panel into a compact "N tools used" disclosure,
 * in place. The panel element is reused — its list is moved into a
 * <details> body and the header becomes a clickable summary. This keeps
 * the element's position in the DOM stable so the response text doesn't
 * shift around when the turn completes.
 */
function retractToolPanelInPlace(card: LiveRunCard): void {
  const panel = card.toolPanel;
  if (!panel.isConnected) return;

  const starts = card.tools.filter(t => t.kind === 'start').length;
  if (starts === 0) {
    // No tools ran — hide the panel entirely (nothing useful to retract to).
    panel.hidden = true;
    return;
  }

  // Stop the running-spinner animation and mark all tool rows as done.
  panel.classList.add('chat-live-tools-retracted');
  card.toolList.querySelectorAll<HTMLElement>('.chat-live-tool-row-active').forEach(row => {
    row.classList.remove('chat-live-tool-row-active');
    row.classList.add('chat-live-tool-row-done');
  });

  // Build the collapsed <details> in place: the existing header becomes the
  // summary label, the existing list becomes the disclosure body.
  const details = document.createElement('details');
  details.className = 'chat-live-tools-collapsed';

  const summary = document.createElement('summary');
  summary.className = 'chat-live-tools-summary';
  summary.innerHTML =
    `<span class="chat-live-tools-summary-chevron">▸</span>` +
    `<span class="chat-live-tools-summary-text">${starts} tool${starts === 1 ? '' : 's'} used</span>`;
  details.appendChild(summary);

  // Move the existing list element into the details (no re-creation).
  details.appendChild(card.toolList);

  // Swap the live panel's contents for the collapsed details — reusing the
  // same container element so layout position is preserved.
  panel.innerHTML = '';
  panel.appendChild(details);
  panel.classList.remove('chat-live-tools');
  panel.classList.add('chat-live-tools-done');
}

function flushFinalResult(taskId: string, result: any, _provider?: string): void {
  const card = liveRunCards.get(taskId);
  if (!card) return;

  if (result.success) {
    const finalOutput = String(result.output || '');
    if (finalOutput && finalOutput !== card.tokenBuffer) {
      card.output.className = 'chat-msg-text chat-markdown';
      card.output.innerHTML = card.callbacks.renderMarkdown(finalOutput);
    } else {
      card.output.className = 'chat-msg-text chat-markdown';
    }
    if (finalOutput) {
      card.callbacks.updateLastAgentResponseText(finalOutput);
    }
  } else {
    card.output.className = 'chat-msg-error';
    const errorText = result.error || 'Unknown error';
    card.output.textContent = errorText;
    card.callbacks.updateLastAgentResponseText(String(errorText));
  }

  // Collapse the live tool panel in place (stays above the response text).
  hideStatus(card);
  retractToolPanelInPlace(card);

  card.root.classList.remove('chat-msg-live');
  card.root.classList.add('chat-msg-done');

  // Restore archived previous responses
  const chatInner = card.root.closest('.cc-chat-inner');
  chatInner?.querySelectorAll<HTMLElement>('.chat-msg-archived').forEach(el => {
    el.classList.remove('chat-msg-archived');
  });

  // Clear the active-turn marker (hides-prior-turns stays in effect)
  card.root.closest('.chat-turn')?.classList.remove('chat-turn-active');
}

function flushError(taskId: string, error: string): void {
  const card = liveRunCards.get(taskId);
  if (!card) return;

  hideStatus(card);
  card.output.className = 'chat-msg-error';
  card.output.textContent = error;
  card.callbacks.updateLastAgentResponseText(String(error));

  retractToolPanelInPlace(card);
  card.root.classList.remove('chat-msg-live');
  card.root.classList.add('chat-msg-done');

  const chatInner = card.root.closest('.cc-chat-inner');
  chatInner?.querySelectorAll<HTMLElement>('.chat-msg-archived').forEach(el => {
    el.classList.remove('chat-msg-archived');
  });

  card.root.closest('.chat-turn')?.classList.remove('chat-turn-active');
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

export function replaceWithError(taskId: string, error: string): void {
  const card = liveRunCards.get(taskId);
  if (!card) return;

  if (card.tokenVisibleLength < card.tokenBuffer.length) {
    card.pendingErrorText = error;
    return;
  }

  flushError(taskId, error);
}
