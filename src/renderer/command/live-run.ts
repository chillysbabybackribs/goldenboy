import type { CodexItem } from '../../shared/types/model.js';

export interface LiveRunRenderCallbacks {
  renderMarkdown: (text: string) => string;
  updateLastAgentResponseText: (text: string) => void;
  scheduleChatScrollToBottom: (force?: boolean, frames?: number) => void;
  disableChatAutoPin: () => void;
  attachResponseCopyButton: (msgRoot: HTMLElement, getText: () => string) => void;
  enhanceCodeBlocks: (root: HTMLElement) => void;
}

/**
 * ChatGPT-style live-run card. The response area is composed of an ordered
 * sequence of segments:
 *
 *   - TextSegment  — a markdown block fed by the provider's token stream.
 *                    Has its own buffer and `displayed` cursor that the
 *                    smoother advances each rAF tick, so large deltas from
 *                    the provider are revealed at a steady rate instead
 *                    of flashing in one paint.
 *
 *   - ToolSegment  — a compact chip (pulsing dot + description) that
 *                    represents one MCP tool call. Sits between the
 *                    descriptive thought that precedes a tool call and
 *                    the next thought that follows it, replacing the
 *                    bare paragraph break that used to live there.
 *
 * A single shimmering status phrase below the response ("Planning next
 * moves" / "Drafting response" / "Exploring ideas") reflects the current
 * phase of the run. It is removed from the DOM when the turn completes.
 *
 * Non-MCP tool status strings (`tool-progress:*`, ad-hoc `Calling X…`
 * activity, `appendToolActivity`, legacy `appendCodexItemProgress`) are
 * deliberately ignored: the authoritative tool-call signal is the
 * `tool-start:` / `tool-done:` status pair emitted by the provider for
 * each `mcpToolCall` item, and that's what renders here.
 */

type Phase = 'planning' | 'drafting' | 'exploring' | 'done';

const PHRASES: Record<Exclude<Phase, 'done'>, string> = {
  planning: 'Planning next moves',
  drafting: 'Drafting response',
  exploring: 'Exploring ideas',
};

// Smoother tuning — see comment in `tick()`.
const MIN_REVEAL_PER_FRAME = 32;
const CATCHUP_FRAMES = 12;

type TextSegment = {
  kind: 'text';
  buffer: string;
  displayed: number;
  el: HTMLElement;
  closed: boolean;
};

type ToolSegment = {
  kind: 'tool';
  el: HTMLElement;
  description: string;
  done: boolean;
  failed: boolean;
};

type Segment = TextSegment | ToolSegment;

export type LiveRunCard = {
  root: HTMLElement;
  responseEl: HTMLElement;
  statusEl: HTMLElement | null;
  segments: Segment[];
  currentText: TextSegment | null;
  phase: Phase;
  renderScheduled: boolean;
  cancelling: boolean;
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

  const chatInner = container.closest('.cc-chat-inner') ?? container;
  chatInner.querySelectorAll<HTMLElement>('.chat-msg-model.chat-msg-done').forEach(el => {
    el.classList.add('chat-msg-archived');
  });

  const root = document.createElement('div');
  root.className = 'chat-msg chat-msg-model chat-msg-live';
  root.dataset.taskId = taskId;

  const responseEl = document.createElement('div');
  responseEl.className = 'chat-live-response chat-msg-text';

  const statusEl = document.createElement('div');
  statusEl.className = 'chat-live-phase';
  statusEl.textContent = PHRASES.planning;

  root.appendChild(responseEl);
  root.appendChild(statusEl);
  container.appendChild(root);

  const card: LiveRunCard = {
    root,
    responseEl,
    statusEl,
    segments: [],
    currentText: null,
    phase: 'planning',
    renderScheduled: false,
    cancelling: false,
    pendingFinalResult: null,
    pendingErrorText: null,
    callbacks,
  };
  liveRunCards.set(taskId, card);
  return card;
}

// ─── Phase / status phrase ──────────────────────────────────────────────────

function setPhase(card: LiveRunCard, phase: Phase): void {
  if (card.phase === phase) return;
  card.phase = phase;
  if (phase === 'done') {
    if (card.statusEl) {
      card.statusEl.remove();
      card.statusEl = null;
    }
    return;
  }
  if (card.statusEl) {
    card.statusEl.textContent = PHRASES[phase];
  }
}

// ─── Segment management ─────────────────────────────────────────────────────

function ensureTextSegment(card: LiveRunCard): TextSegment {
  if (card.currentText && !card.currentText.closed) return card.currentText;
  const el = document.createElement('div');
  el.className = 'chat-live-segment chat-live-segment-text chat-markdown';
  card.responseEl.appendChild(el);
  const seg: TextSegment = {
    kind: 'text',
    buffer: '',
    displayed: 0,
    el,
    closed: false,
  };
  card.segments.push(seg);
  card.currentText = seg;
  return seg;
}

/**
 * Snap the active text segment to a complete render and close it off.
 * Used when a boundary/tool event arrives: the paragraph's tokens have
 * already been received by us, so there's no reason to let the smoother
 * dribble the last few chars in after the next segment has already
 * appeared.
 */
function closeTextSegment(card: LiveRunCard): void {
  const seg = card.currentText;
  if (!seg || seg.closed) return;
  if (seg.buffer.length === 0) {
    // Empty open segment — discard rather than commit an empty node.
    seg.el.remove();
    card.segments = card.segments.filter(s => s !== seg);
  } else {
    seg.displayed = seg.buffer.length;
    seg.el.innerHTML = card.callbacks.renderMarkdown(seg.buffer);
    card.callbacks.enhanceCodeBlocks(seg.el);
    seg.closed = true;
  }
  card.currentText = null;
}

function appendToolChip(card: LiveRunCard, description: string): ToolSegment {
  closeTextSegment(card);

  const el = document.createElement('div');
  el.className = 'chat-live-segment chat-live-segment-tool chat-live-tool-active';

  const indicator = document.createElement('span');
  indicator.className = 'chat-live-tool-indicator';
  el.appendChild(indicator);

  const textEl = document.createElement('span');
  textEl.className = 'chat-live-tool-text';
  textEl.textContent = description || 'tool call';
  el.appendChild(textEl);

  card.responseEl.appendChild(el);

  const seg: ToolSegment = {
    kind: 'tool',
    el,
    description,
    done: false,
    failed: false,
  };
  card.segments.push(seg);
  card.callbacks.scheduleChatScrollToBottom(false, 1);
  return seg;
}

function finishToolChip(card: LiveRunCard, resultSummary: string): void {
  for (let i = card.segments.length - 1; i >= 0; i--) {
    const seg = card.segments[i];
    if (seg.kind === 'tool' && !seg.done) {
      seg.done = true;
      const failed = resultSummary.trimStart().startsWith('error:');
      seg.failed = failed;
      seg.el.classList.remove('chat-live-tool-active');
      seg.el.classList.add(failed ? 'chat-live-tool-failed' : 'chat-live-tool-done');
      return;
    }
  }
}

// ─── Smoother render loop ───────────────────────────────────────────────────

function scheduleRender(card: LiveRunCard): void {
  if (card.renderScheduled) return;
  card.renderScheduled = true;
  window.requestAnimationFrame(() => tick(card));
}

function tick(card: LiveRunCard): void {
  card.renderScheduled = false;
  if (card.cancelling) return;

  // Smoother only touches the currently-open text segment. Past segments
  // are frozen (closed) and tool chips have no animated content.
  //
  // Draining rate is the larger of:
  //   - MIN_REVEAL_PER_FRAME  — floor, so even tiny backlogs still feel live
  //   - backlog / CATCHUP_FRAMES — accelerator, so a huge dump still drains
  //     in roughly CATCHUP_FRAMES animation frames (~200ms at 60fps).
  // This gives confident streaming prose (~2k chars/sec at rest, much
  // faster when there's a backlog) without slipping into typewriter
  // territory.
  const seg = card.currentText;
  if (seg && seg.displayed < seg.buffer.length) {
    const backlog = seg.buffer.length - seg.displayed;
    const step = Math.max(MIN_REVEAL_PER_FRAME, Math.ceil(backlog / CATCHUP_FRAMES));
    seg.displayed = Math.min(seg.buffer.length, seg.displayed + step);
    const slice = seg.buffer.slice(0, seg.displayed);
    // `renderMarkdown` tolerates partial markdown (open fences, half-
    // written tables) by closing unfinished blocks so the live view
    // stays readable.
    seg.el.innerHTML = card.callbacks.renderMarkdown(slice);
    card.callbacks.enhanceCodeBlocks(seg.el);
    card.callbacks.scheduleChatScrollToBottom(false, 1);
  }

  if (seg && seg.displayed < seg.buffer.length) {
    scheduleRender(card);
    return;
  }
  if (card.pendingFinalResult) {
    const pending = card.pendingFinalResult;
    card.pendingFinalResult = null;
    applyFinalResult(card, pending.result);
  }
}

// ─── Token Streaming ───────────────────────────────────────────────────────

export function appendToken(taskId: string, text: string): void {
  const card = liveRunCards.get(taskId);
  if (!card || card.cancelling) return;
  if (!text) return;

  const seg = ensureTextSegment(card);
  seg.buffer += text;
  if (card.phase !== 'drafting') setPhase(card, 'drafting');
  scheduleRender(card);
}

// ─── Tool / boundary status events ─────────────────────────────────────────

export function appendToolStatus(taskId: string, status: string): void {
  const card = liveRunCards.get(taskId);
  if (!card || card.cancelling) return;

  if (status === 'thought-boundary') {
    // One agentMessage item just finished. Close the active text
    // segment so the next token opens a fresh segment below any tool
    // chip that's about to appear. If the next event is also text
    // (two consecutive thoughts with no tool between them) the new
    // segment simply renders as a second paragraph-like block.
    closeTextSegment(card);
    return;
  }

  if (status === 'turn-boundary') {
    // A tool-calls turn just finished; we're waiting for the final
    // turn. No text will stream for a short window, so surface the
    // gap visually with a phase change. The next appendToken flips
    // us back to `drafting` automatically.
    setPhase(card, 'exploring');
    return;
  }

  if (status.startsWith('tool-start:')) {
    const description = status.slice('tool-start:'.length).trim();
    appendToolChip(card, description);
    return;
  }

  if (status.startsWith('tool-done:')) {
    // Provider format: `tool-done:<description> -> <summary>`. Summary
    // may carry `error:`, `INVALID:`, or `INCOMPLETE:` prefixes for
    // visual state.
    const rest = status.slice('tool-done:'.length);
    const arrowIdx = rest.lastIndexOf(' -> ');
    const summary = arrowIdx >= 0 ? rest.slice(arrowIdx + 4) : 'done';
    finishToolChip(
      card,
      /^(error:|INVALID:|INCOMPLETE:)/.test(summary) ? `error: ${summary}` : summary,
    );
    return;
  }

  // tool-progress:* is intentionally not rendered — it would need
  // structured progress data (percentages, counts) to look like anything
  // other than noise. Revisit once there's a concrete signal.
}

// ─── Legacy no-ops ──────────────────────────────────────────────────────────

export function appendToolActivity(_taskId: string, _kind: 'call' | 'result', _text: string): void {
  // Legacy path from ad-hoc `Calling X…` / `Tool result: …` status
  // strings. The MCP tool pipeline surfaces tools via `tool-start:` /
  // `tool-done:` instead, so this is a no-op.
}

export function appendCodexItemProgress(_taskId: string, _progressData: string, _item?: CodexItem): void {
  // CodexItem events duplicate the status-string signal we already
  // render. Left as a no-op to avoid drawing each tool twice.
}

// ─── Cancel / Stopping ──────────────────────────────────────────────────────

export function markCancelling(taskId: string): void {
  const card = liveRunCards.get(taskId);
  if (!card || card.cancelling) return;
  card.cancelling = true;
  card.pendingFinalResult = null;

  // Freeze whatever the smoother has revealed so far on the active
  // text segment — do NOT dump the rest of the buffer just because the
  // user stopped the run.
  const seg = card.currentText;
  if (seg && !seg.closed) {
    seg.el.innerHTML = seg.displayed > 0
      ? card.callbacks.renderMarkdown(seg.buffer.slice(0, seg.displayed))
      : '';
    if (seg.displayed > 0) card.callbacks.enhanceCodeBlocks(seg.el);
  }

  // Flip any active tool chips to a neutral done state — the tool
  // invocation is abandoned but leaving the chip in its pulsing state
  // would be misleading.
  for (const s of card.segments) {
    if (s.kind === 'tool' && !s.done) {
      s.done = true;
      s.el.classList.remove('chat-live-tool-active');
      s.el.classList.add('chat-live-tool-done');
    }
  }

  if (card.statusEl) {
    card.statusEl.classList.add('chat-live-phase-stopped');
    card.statusEl.textContent = 'Stopped';
  }

  card.root.classList.add('chat-msg-cancelling');
}

// ─── Final Result / Error ───────────────────────────────────────────────────

function finalizeCard(card: LiveRunCard, copyText: string): void {
  setPhase(card, 'done');
  card.root.classList.remove('chat-msg-live');
  card.root.classList.add('chat-msg-done');
  card.callbacks.attachResponseCopyButton(card.root, () => copyText);

  const chatInner = card.root.closest('.cc-chat-inner');
  chatInner?.querySelectorAll<HTMLElement>('.chat-msg-archived').forEach(el => {
    el.classList.remove('chat-msg-archived');
  });

  card.root.closest('.chat-turn')?.classList.remove('chat-turn-active');
}

function applyFinalResult(card: LiveRunCard, result: any): void {
  let copyText = '';

  if (result.status === 'cancelled') {
    const cancelText = String(result.error || 'Task cancelled by user.');
    // On cancel, replace all segments with a plain cancel notice so the
    // user isn't left looking at a half-streamed draft.
    card.responseEl.innerHTML = '';
    card.segments = [];
    card.currentText = null;
    const notice = document.createElement('div');
    notice.className = 'chat-live-segment chat-live-segment-text';
    notice.textContent = cancelText;
    card.responseEl.appendChild(notice);
    card.callbacks.updateLastAgentResponseText(cancelText);
    copyText = cancelText;
  } else if (result.success) {
    const finalOutput = String(result.output || '').trim();
    card.responseEl.innerHTML = '';
    card.segments = [];
    card.currentText = null;
    const finalEl = document.createElement('div');
    finalEl.className = 'chat-live-segment chat-live-segment-text chat-markdown';
    finalEl.innerHTML = card.callbacks.renderMarkdown(finalOutput);
    card.callbacks.enhanceCodeBlocks(finalEl);
    card.responseEl.appendChild(finalEl);
    card.callbacks.updateLastAgentResponseText(finalOutput);
    copyText = finalOutput;
  } else {
    const errorText = String(result.error || 'Unknown error');
    card.responseEl.innerHTML = '';
    card.segments = [];
    card.currentText = null;
    const errorEl = document.createElement('div');
    errorEl.className = 'chat-msg-error';
    errorEl.textContent = errorText;
    card.responseEl.appendChild(errorEl);
    card.callbacks.updateLastAgentResponseText(errorText);
    copyText = errorText;
  }

  finalizeCard(card, copyText);
}

export function replaceWithResult(taskId: string, result: any, provider?: string): void {
  const card = liveRunCards.get(taskId);
  if (!card) return;
  card.pendingFinalResult = null;
  applyFinalResult(card, result);
}

export function replaceWithError(taskId: string, error: string): void {
  const card = liveRunCards.get(taskId);
  if (!card) return;

  card.responseEl.innerHTML = '';
  card.segments = [];
  card.currentText = null;
  const errorEl = document.createElement('div');
  errorEl.className = 'chat-msg-error';
  errorEl.textContent = error;
  card.responseEl.appendChild(errorEl);
  card.callbacks.updateLastAgentResponseText(String(error));

  finalizeCard(card, error);
}
