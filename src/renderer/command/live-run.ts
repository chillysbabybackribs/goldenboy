import { escapeHtml } from '../shared/utils.js';
import type { CodexItem } from '../../shared/types/model.js';

export interface LiveRunRenderCallbacks {
  renderMarkdown: (text: string) => string;
  updateLastAgentResponseText: (text: string) => void;
  scheduleChatScrollToBottom: (force?: boolean, frames?: number) => void;
  disableChatAutoPin: () => void;
  attachResponseCopyButton: (msgRoot: HTMLElement, getText: () => string) => void;
}

/**
 * Live-run cards are rendered as a vertical timeline of segments so that the
 * agent's descriptive text and its tool calls appear interleaved in the order
 * the provider emits them (text → tool → text → tool → final text). This
 * mirrors how the WebSocket / SDK stream arrives and matches the chronological
 * reasoning of the underlying model, giving users an at-a-glance trace of
 * what the agent is doing.
 */

interface TextSegment {
  kind: 'text';
  el: HTMLElement;
  buffer: string;
  visibleLength: number;
  chunkSize: number;
  typingTimer: number | null;
}

interface ToolSegment {
  kind: 'tool';
  el: HTMLElement;
  text: string;
  active: boolean;
}

type Segment = TextSegment | ToolSegment;

export type LiveRunCard = {
  root: HTMLElement;
  /** "Thinking..." indicator — shown only before any segment starts. */
  status: HTMLElement;
  /** The flat timeline of interleaved text + tool segments. */
  timeline: HTMLElement;
  cancelling: boolean;
  segments: Segment[];
  /** Currently-streaming text segment, if any. Cleared when a tool starts. */
  activeTextSegment: TextSegment | null;
  /** Currently-running tool segment, if any. */
  activeToolSegment: ToolSegment | null;
  pendingFinalResult: { result: any; provider?: string } | null;
  pendingErrorText: string | null;
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
    `<div class="chat-live-timeline"></div>`;

  container.appendChild(root);

  const status = root.querySelector('.chat-live-status') as HTMLElement;
  const timeline = root.querySelector('.chat-live-timeline') as HTMLElement;

  const card: LiveRunCard = {
    root,
    status,
    timeline,
    cancelling: false,
    segments: [],
    activeTextSegment: null,
    activeToolSegment: null,
    pendingFinalResult: null,
    pendingErrorText: null,
    callbacks,
  };
  liveRunCards.set(taskId, card);
  return card;
}

// ─── Segment helpers ────────────────────────────────────────────────────────

function hideStatus(card: LiveRunCard): void {
  card.status.classList.add('chat-live-status-hidden');
}

function createTextSegment(card: LiveRunCard): TextSegment {
  const el = document.createElement('div');
  el.className = 'chat-live-segment chat-live-segment-text chat-msg-text chat-markdown chat-msg-streaming';
  card.timeline.appendChild(el);
  const seg: TextSegment = {
    kind: 'text',
    el,
    buffer: '',
    visibleLength: 0,
    chunkSize: 8,
    typingTimer: null,
  };
  card.segments.push(seg);
  card.activeTextSegment = seg;
  return seg;
}

function finalizeTextSegment(card: LiveRunCard, seg: TextSegment): void {
  if (seg.typingTimer !== null) {
    window.cancelAnimationFrame(seg.typingTimer);
    seg.typingTimer = null;
  }
  seg.visibleLength = seg.buffer.length;
  seg.el.innerHTML = card.callbacks.renderMarkdown(seg.buffer);
  seg.el.classList.remove('chat-msg-streaming');
  if (card.activeTextSegment === seg) {
    card.activeTextSegment = null;
  }
}

function closeActiveTextSegment(card: LiveRunCard): void {
  if (card.activeTextSegment) {
    finalizeTextSegment(card, card.activeTextSegment);
  }
}

/**
 * Remove the active text segment entirely — used on turn boundaries so that
 * each turn's "descriptive status line" is a fresh ephemeral element rather
 * than an ever-growing paragraph that concatenates every turn's output.
 *
 * Prior tool segments are left in place so the user still sees the sequence
 * of actions the agent took.
 */
function discardActiveTextSegment(card: LiveRunCard): void {
  const seg = card.activeTextSegment;
  if (!seg) return;
  if (seg.typingTimer !== null) {
    window.cancelAnimationFrame(seg.typingTimer);
    seg.typingTimer = null;
  }
  seg.el.remove();
  const idx = card.segments.indexOf(seg);
  if (idx !== -1) card.segments.splice(idx, 1);
  card.activeTextSegment = null;
}

function getOrCreateActiveTextSegment(card: LiveRunCard): TextSegment {
  if (card.activeTextSegment) return card.activeTextSegment;
  return createTextSegment(card);
}

function combinedCopyText(card: LiveRunCard): string {
  return card.segments
    .filter((seg): seg is TextSegment => seg.kind === 'text')
    .map(seg => seg.buffer)
    .join('\n\n')
    .trim();
}

// ─── Cancel / Stopping ──────────────────────────────────────────────────────

export function markCancelling(taskId: string): void {
  const card = liveRunCards.get(taskId);
  if (!card || card.cancelling) return;
  card.cancelling = true;

  for (const seg of card.segments) {
    if (seg.kind === 'text' && seg.typingTimer !== null) {
      window.cancelAnimationFrame(seg.typingTimer);
      seg.typingTimer = null;
      seg.visibleLength = seg.buffer.length;
      seg.el.innerHTML = card.callbacks.renderMarkdown(seg.buffer);
      seg.el.classList.remove('chat-msg-streaming');
    }
  }
  card.activeTextSegment = null;

  if (card.activeToolSegment) {
    card.activeToolSegment.el.classList.remove('chat-live-tool-row-active');
    card.activeToolSegment.el.classList.add('chat-live-tool-row-done');
    card.activeToolSegment.active = false;
    card.activeToolSegment = null;
  }

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

  if (card.segments.length === 0) {
    hideStatus(card);
  }

  const seg = getOrCreateActiveTextSegment(card);
  seg.buffer += text;

  if (seg.typingTimer === null) {
    scheduleTypewriterTick(taskId, card, seg);
  }
}

function scheduleTypewriterTick(taskId: string, card: LiveRunCard, seg: TextSegment): void {
  seg.typingTimer = window.requestAnimationFrame(() => {
    seg.typingTimer = null;
    if (card.cancelling) return;

    const lag = seg.buffer.length - seg.visibleLength;
    if (lag <= 0) {
      flushPendingIfReady(taskId, card);
      return;
    }

    if (lag > 200) {
      seg.chunkSize = Math.min(seg.chunkSize + 4, 60);
    } else if (lag < 30) {
      seg.chunkSize = Math.max(seg.chunkSize - 2, 6);
    }

    seg.visibleLength = Math.min(seg.visibleLength + seg.chunkSize, seg.buffer.length);
    const visible = seg.buffer.slice(0, seg.visibleLength);
    seg.el.innerHTML = card.callbacks.renderMarkdown(visible);
    card.callbacks.updateLastAgentResponseText(combinedCopyText(card));

    if (seg.visibleLength < seg.buffer.length) {
      scheduleTypewriterTick(taskId, card, seg);
    } else {
      flushPendingIfReady(taskId, card);
    }
  });
}

function hasActiveTypewriter(card: LiveRunCard): boolean {
  return card.segments.some(
    seg => seg.kind === 'text' && (seg.typingTimer !== null || seg.visibleLength < seg.buffer.length),
  );
}

function flushPendingIfReady(taskId: string, card: LiveRunCard): void {
  if (hasActiveTypewriter(card)) return;
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

function createToolRow(text: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'chat-live-segment chat-live-segment-tool chat-live-tool-row chat-live-tool-row-active';
  row.innerHTML =
    `<span class="chat-live-tool-dot"></span>` +
    `<span class="chat-live-tool-text">${escapeHtml(text)}</span>`;
  return row;
}

function renderToolStart(card: LiveRunCard, text: string): void {
  hideStatus(card);
  // Close any in-flight text segment so this tool row inserts *below* the
  // already-rendered descriptive text, not inside it.
  closeActiveTextSegment(card);
  const row = createToolRow(text);
  card.timeline.appendChild(row);
  const seg: ToolSegment = { kind: 'tool', el: row, text, active: true };
  card.segments.push(seg);
  card.activeToolSegment = seg;
}

function renderToolDone(card: LiveRunCard, text: string): void {
  const seg = card.activeToolSegment;
  if (seg) {
    seg.active = false;
    seg.text = text;
    seg.el.className = 'chat-live-segment chat-live-segment-tool chat-live-tool-row chat-live-tool-row-done';
    const textEl = seg.el.querySelector('.chat-live-tool-text');
    if (textEl) textEl.textContent = text;
    card.activeToolSegment = null;
  } else {
    // No matching start — append a completed tool row in place.
    closeActiveTextSegment(card);
    const row = createToolRow(text);
    row.className = 'chat-live-segment chat-live-segment-tool chat-live-tool-row chat-live-tool-row-done';
    card.timeline.appendChild(row);
    card.segments.push({ kind: 'tool', el: row, text, active: false });
  }
}

function renderToolProgress(card: LiveRunCard, text: string): void {
  const seg = card.activeToolSegment;
  if (seg) {
    seg.text = text;
    const textEl = seg.el.querySelector('.chat-live-tool-text');
    if (textEl) textEl.textContent = text;
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
  if (status === 'turn-boundary') {
    // Wipe the ephemeral status line so the next turn's descriptive text
    // starts fresh instead of concatenating onto the prior turn's paragraph.
    discardActiveTextSegment(card);
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

function markTimelineDone(card: LiveRunCard): void {
  // Flush any in-flight streaming segment to fully visible.
  for (const seg of card.segments) {
    if (seg.kind === 'text') {
      finalizeTextSegment(card, seg);
    } else if (seg.active) {
      seg.active = false;
      seg.el.classList.remove('chat-live-tool-row-active');
      seg.el.classList.add('chat-live-tool-row-done');
    }
  }
  card.activeTextSegment = null;
  card.activeToolSegment = null;
}

/**
 * On turn completion, collapse the "process" (prior descriptive snippets +
 * tool rows that ran during the run) into a compact disclosure pinned above
 * the final response. The final answer stays visible and prominent; the path
 * the agent took to get there is tucked away but available on click.
 */
function retractTimelineHistory(card: LiveRunCard, finalSeg: TextSegment | null): void {
  const historySegments = card.segments.filter(seg => seg !== finalSeg);
  if (historySegments.length === 0) return;

  const toolCount = historySegments.filter(seg => seg.kind === 'tool').length;

  const details = document.createElement('details');
  details.className = 'chat-live-history';

  const summary = document.createElement('summary');
  summary.className = 'chat-live-history-summary';
  const labelBits: string[] = [];
  if (toolCount > 0) labelBits.push(`${toolCount} tool${toolCount === 1 ? '' : 's'}`);
  const textCount = historySegments.length - toolCount;
  if (textCount > 0) labelBits.push(`${textCount} thinking step${textCount === 1 ? '' : 's'}`);
  const label = labelBits.join(' · ') || 'steps';
  summary.innerHTML =
    `<span class="chat-live-history-chevron">▸</span>` +
    `<span class="chat-live-history-text">${label}</span>`;
  details.appendChild(summary);

  const body = document.createElement('div');
  body.className = 'chat-live-history-body';
  // Move each history segment's DOM node into the disclosure body, preserving
  // order. This keeps existing styling (tool pills still look like tool pills)
  // without re-creating elements.
  for (const seg of historySegments) {
    body.appendChild(seg.el);
  }
  details.appendChild(body);

  // Insert the disclosure at the position of the FIRST history segment so it
  // renders above the final answer in the card.
  card.timeline.insertBefore(details, finalSeg ? finalSeg.el : null);
}

function findLastTextSegment(card: LiveRunCard): TextSegment | null {
  for (let i = card.segments.length - 1; i >= 0; i--) {
    const seg = card.segments[i];
    if (seg.kind === 'text') return seg;
  }
  return null;
}

function flushFinalResult(taskId: string, result: any, _provider?: string): void {
  const card = liveRunCards.get(taskId);
  if (!card) return;

  markTimelineDone(card);
  hideStatus(card);

  let copyText = '';

  if (result.status === 'cancelled') {
    const cancelText = String(result.error || 'Task cancelled by user.');
    const fallback = document.createElement('div');
    fallback.className = 'chat-live-segment chat-live-segment-text chat-msg-text';
    fallback.textContent = cancelText;
    card.timeline.appendChild(fallback);
    card.callbacks.updateLastAgentResponseText(cancelText);
    copyText = cancelText;
  } else if (result.success) {
    const finalOutput = String(result.output || '');
    let finalSeg = findLastTextSegment(card);

    // If nothing was streamed (or the stream is empty), drop the canonical
    // final output into a trailing text segment so the user sees an answer.
    if ((!finalSeg || !finalSeg.buffer.trim()) && finalOutput) {
      if (finalSeg) {
        finalSeg.buffer = finalOutput;
        finalSeg.visibleLength = finalOutput.length;
        finalSeg.el.innerHTML = card.callbacks.renderMarkdown(finalOutput);
        finalSeg.el.classList.remove('chat-msg-streaming');
      } else {
        finalSeg = createTextSegment(card);
        finalSeg.buffer = finalOutput;
        finalSeg.visibleLength = finalOutput.length;
        finalSeg.el.innerHTML = card.callbacks.renderMarkdown(finalOutput);
        finalSeg.el.classList.remove('chat-msg-streaming');
        card.activeTextSegment = null;
      }
    }

    // Collapse the process (prior text snippets + tool rows) into a
    // disclosure above the final response so the chat reads cleanly: a
    // compact "what it did" row, then the answer.
    retractTimelineHistory(card, finalSeg);

    if (finalSeg) {
      finalSeg.el.classList.add('chat-live-final-response');
    }

    const finalText = finalSeg ? finalSeg.buffer : finalOutput;
    if (finalText) {
      card.callbacks.updateLastAgentResponseText(finalText);
    }
    copyText = finalText;
  } else {
    const errorText = String(result.error || 'Unknown error');
    const errorEl = document.createElement('div');
    errorEl.className = 'chat-msg-error';
    errorEl.textContent = errorText;
    card.timeline.appendChild(errorEl);
    card.callbacks.updateLastAgentResponseText(errorText);
    copyText = errorText;
  }

  card.root.classList.remove('chat-msg-live');
  card.root.classList.add('chat-msg-done');

  card.callbacks.attachResponseCopyButton(card.root, () => copyText);

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

  markTimelineDone(card);
  hideStatus(card);

  const errorEl = document.createElement('div');
  errorEl.className = 'chat-msg-error';
  errorEl.textContent = error;
  card.timeline.appendChild(errorEl);
  card.callbacks.updateLastAgentResponseText(String(error));

  card.root.classList.remove('chat-msg-live');
  card.root.classList.add('chat-msg-done');

  card.callbacks.attachResponseCopyButton(card.root, () => error);

  const chatInner = card.root.closest('.cc-chat-inner');
  chatInner?.querySelectorAll<HTMLElement>('.chat-msg-archived').forEach(el => {
    el.classList.remove('chat-msg-archived');
  });

  card.root.closest('.chat-turn')?.classList.remove('chat-turn-active');
}

export function replaceWithResult(taskId: string, result: any, provider?: string): void {
  const card = liveRunCards.get(taskId);
  if (!card) return;

  if (hasActiveTypewriter(card)) {
    card.pendingFinalResult = { result, provider };
    return;
  }

  flushFinalResult(taskId, result, provider);
}

export function replaceWithError(taskId: string, error: string): void {
  const card = liveRunCards.get(taskId);
  if (!card) return;

  if (hasActiveTypewriter(card)) {
    card.pendingErrorText = error;
    return;
  }

  flushError(taskId, error);
}
