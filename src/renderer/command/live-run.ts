import { escapeHtml } from '../shared/utils.js';
import type { CodexItem } from '../../shared/types/model.js';

export interface LiveRunRenderCallbacks {
  renderMarkdown: (text: string) => string;
  updateLastAgentResponseText: (text: string) => void;
  scheduleChatScrollToBottom: (force?: boolean, frames?: number) => void;
}

export type LiveRunCard = {
  root: HTMLElement;
  meta: HTMLElement;
  panel: HTMLElement;
  stream: HTMLElement;
  output: HTMLElement;
  /** Active tool line element (shimmer state) */
  activeToolEl: HTMLElement | null;
  /** Last completed thought element (gets waiting shimmer) */
  lastThoughtEl: HTMLElement | null;
  /** Queue of thought chunks waiting to be typed out */
  typingQueue: string[];
  typingTimer: number | null;
  activeThoughtEl: HTMLElement | null;
  /** Tool events that arrived while a thought was typing */
  deferredToolEvents: Array<{ kind: 'start' | 'done'; text: string }>;
  /** Full received token text */
  tokenBuffer: string;
  /** How many chars of tokenBuffer have been rendered to screen */
  tokenVisibleLength: number;
  /** rAF handle for the typewriter tick */
  tokenTypingTimer: number | null;
  /** Chars rendered per rAF tick — adapts to keep up with fast models */
  tokenChunkSize: number;
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
  prompt?: string,
): LiveRunCard {
  container.querySelector('.cc-chat-empty')?.remove();

  // Hide all existing cards — new task takes over the full space
  container.querySelectorAll<HTMLElement>('.chat-msg').forEach(el => {
    el.classList.add('chat-msg-archived');
  });

  const root = document.createElement('div');
  root.className = 'chat-msg chat-msg-model chat-msg-live';
  root.dataset.taskId = taskId;

  const promptHtml = prompt
    ? `<div class="chat-live-prompt">${escapeHtml(prompt.trim())}</div>`
    : '';

  root.innerHTML =
    promptHtml +
    `<div class="chat-live-panel">` +
      `<div class="chat-stream"></div>` +
      `<div class="chat-msg-text chat-markdown"></div>` +
    `</div>`;
  container.appendChild(root);
  callbacks.scheduleChatScrollToBottom(true, 5);

  const card: LiveRunCard = {
    root,
    meta: root.querySelector('.chat-msg-meta') as HTMLElement,
    panel: root.querySelector('.chat-live-panel') as HTMLElement,
    stream: root.querySelector('.chat-stream') as HTMLElement,
    output: root.querySelector('.chat-msg-text') as HTMLElement,
    activeToolEl: null,
    lastThoughtEl: null,
    typingQueue: [],
    typingTimer: null,
    activeThoughtEl: null,
    deferredToolEvents: [],
    tokenBuffer: '',
    tokenVisibleLength: 0,
    tokenTypingTimer: null,
    tokenChunkSize: 8,
    pendingFinalResult: null,
    pendingErrorText: null,
    callbacks,
  };
  liveRunCards.set(taskId, card);
  syncLivePanelScroll(card);
  callbacks.scheduleChatScrollToBottom(true, 5);
  return card;
}

// ─── Token Streaming (typewriter) ───────────────────────────────────────────

export function appendToken(taskId: string, text: string): void {
  const card = liveRunCards.get(taskId);
  if (!card) return;
  if (!text) return;

  card.tokenBuffer += text;
  card.output.className = 'chat-msg-text chat-markdown chat-msg-streaming';
  card.root.classList.toggle('chat-msg-live-has-output', card.tokenBuffer.trim().length > 0);

  // Kick off the typewriter loop if not already running
  if (card.tokenTypingTimer === null) {
    scheduleTypewriterTick(taskId, card);
  }
}

function scheduleTypewriterTick(taskId: string, card: LiveRunCard): void {
  card.tokenTypingTimer = window.requestAnimationFrame(() => {
    card.tokenTypingTimer = null;

    const lag = card.tokenBuffer.length - card.tokenVisibleLength;
    if (lag <= 0) {
      // Caught up — check for pending flush
      flushPendingIfReady(taskId, card);
      return;
    }

    // Adapt chunk size: larger when lagging behind to catch up, smaller when close
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
    syncLivePanelScroll(card);
    card.callbacks.scheduleChatScrollToBottom(false, 1);

    // Keep ticking if there's more to show
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

// ─── Thought Lines (model reasoning, typed out) ─────────────────────────────

function splitIntoSentences(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const lines = normalized.split('\n').map(l => l.trim()).filter(Boolean);
  const chunks: string[] = [];

  for (const line of lines) {
    const sentences = line.match(/[^.!?;]+[.!?;]?\s*/g);
    if (!sentences || sentences.length <= 1) {
      if (line.length > 160) {
        const words = line.split(/\s+/);
        let current = '';
        for (const word of words) {
          const candidate = current ? `${current} ${word}` : word;
          if (candidate.length > 160 && current) {
            chunks.push(current);
            current = word;
          } else {
            current = candidate;
          }
        }
        if (current) chunks.push(current);
      } else {
        chunks.push(line);
      }
      continue;
    }
    for (const s of sentences) {
      const trimmed = s.trim();
      if (trimmed) chunks.push(trimmed);
    }
  }

  return chunks;
}

function clearWaitingShimmer(card: LiveRunCard): void {
  if (card.lastThoughtEl) {
    card.lastThoughtEl.classList.remove('chat-thought-waiting');
  }
}

function syncLivePanelScroll(card: LiveRunCard): void {
  if (!card.panel.isConnected) return;
  card.panel.scrollTop = card.panel.scrollHeight;
}

export function appendThought(taskId: string, text: string): void {
  const card = liveRunCards.get(taskId);
  if (!card) return;
  const trimmed = text.trim();
  if (!trimmed) return;
  // Skip raw tool transcripts
  if (/^\+?\s*tool\b/i.test(trimmed) || /^tool (result|call):/i.test(trimmed)) return;
  // Skip internal sections
  if (/^##\s*(Critique Summary|Observation|Inference)\b/.test(trimmed)) return;

  const chunks = splitIntoSentences(trimmed);
  if (chunks.length === 0) return;

  card.typingQueue.push(...chunks);
  if (card.typingTimer !== null) return;

  typeNextChunk(card, taskId);
}

function typeNextChunk(card: LiveRunCard, taskId: string): void {
  clearWaitingShimmer(card);

  while (card.typingQueue.length > 0) {
    const next = card.typingQueue.shift();
    if (!next) continue;

    const el = document.createElement('div');
    el.className = 'chat-thought-line';
    el.innerHTML = escapeHtml(next)
      .replace(/\*\*([^*]+)\*\*/g, '<span class="key">$1</span>')
      .replace(/`([^`]+)`/g, '<span class="key">$1</span>');
    card.stream.appendChild(el);
    card.lastThoughtEl = el;
  }

  card.typingTimer = null;
  card.activeThoughtEl = null;
  if (card.lastThoughtEl && card.deferredToolEvents.length === 0) {
    card.lastThoughtEl.classList.add('chat-thought-waiting');
  }
  while (card.deferredToolEvents.length > 0) {
    const event = card.deferredToolEvents.shift()!;
    renderToolLine(card, taskId, event.kind, event.text);
  }
  syncLivePanelScroll(card);
  card.callbacks.scheduleChatScrollToBottom(false, 1);
}

// ─── Tool Lines (indented, shimmer when active, solid when done) ────────────

function renderToolLine(card: LiveRunCard, taskId: string, kind: 'start' | 'done', text: string): void {
  clearWaitingShimmer(card);

  if (kind === 'start') {
    // Create a new active tool line with shimmer
    const el = document.createElement('div');
    el.className = 'chat-tool-line chat-tool-active';
    el.innerHTML =
      `<span class="tool-dot"></span>` +
      `<span class="tool-text tool-text-shimmer">${escapeHtml(text)}</span>`;
    card.stream.appendChild(el);
    card.activeToolEl = el;
    syncLivePanelScroll(card);
    card.callbacks.scheduleChatScrollToBottom(false, 1);
    return;
  }

  // kind === 'done' — update existing active line or create completed line
  if (card.activeToolEl) {
    card.activeToolEl.className = 'chat-tool-line chat-tool-done';
    const textEl = card.activeToolEl.querySelector('.tool-text');
    if (textEl) {
      textEl.className = 'tool-text';
      textEl.textContent = text;
    }
    card.activeToolEl = null;
  } else {
    // No active line to update — create a completed line directly
    const el = document.createElement('div');
    el.className = 'chat-tool-line chat-tool-done';
    el.innerHTML =
      `<span class="tool-dot"></span>` +
      `<span class="tool-text">${escapeHtml(text)}</span>`;
    card.stream.appendChild(el);
  }
  syncLivePanelScroll(card);
  card.callbacks.scheduleChatScrollToBottom(false, 1);
}

export function appendToolActivity(taskId: string, kind: 'call' | 'result', text: string): void {
  const card = liveRunCards.get(taskId);
  if (!card) return;

  // Map old call/result to new start/done
  const newKind = kind === 'call' ? 'start' : 'done';

  // Defer if a thought is currently typing
  if (card.typingTimer !== null || card.activeThoughtEl) {
    card.deferredToolEvents.push({ kind: newKind, text });
    return;
  }

  renderToolLine(card, taskId, newKind, text);
}

export function appendToolStatus(taskId: string, status: string): void {
  const card = liveRunCards.get(taskId);
  if (!card) return;

  if (status.startsWith('tool-start:')) {
    const text = status.slice('tool-start:'.length);
    const kind = 'start' as const;
    if (card.typingTimer !== null || card.activeThoughtEl) {
      card.deferredToolEvents.push({ kind, text });
      return;
    }
    renderToolLine(card, taskId, kind, text);
    return;
  }

  if (status.startsWith('tool-done:')) {
    const text = status.slice('tool-done:'.length);
    const kind = 'done' as const;
    if (card.typingTimer !== null || card.activeThoughtEl) {
      card.deferredToolEvents.push({ kind, text });
      return;
    }
    renderToolLine(card, taskId, kind, text);
    return;
  }

  // Any other status text → treat as a thought
  appendThought(taskId, status);
}

// ─── Codex Item Progress (compatibility) ────────────────────────────────────

function summarizeUnknownForUi(value: unknown, max = 100): string {
  if (value == null) return 'done';
  if (typeof value === 'string') {
    const t = value.trim();
    return t.length > max ? `${t.slice(0, max - 3)}...` : t;
  }
  try {
    const s = JSON.stringify(value);
    return s.length > max ? `${s.slice(0, max - 3)}...` : s;
  } catch {
    return String(value).slice(0, max);
  }
}

export function appendCodexItemProgress(taskId: string, progressData: string, item?: CodexItem): void {
  if (!item) return;
  if (item.type === 'agent_message') return;
  const progress = item.status;
  const started = progress === 'in_progress' || /\bstarted$/.test(progressData);
  const completed = progress === 'completed' || /\bcompleted$/.test(progressData);
  const failed = progress === 'failed' || /\bfailed$/.test(progressData);

  if (item.type === 'mcp_tool_call') {
    // Tool lifecycle is already rendered from the status stream. Re-rendering the
    // structured mcp_tool_call items here produces duplicate lines and noisy raw
    // JSON summaries in the chat transcript.
    return;
  }

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

function collapseStreamIntoDisclosure(card: LiveRunCard): void {
  const streamEl = card.stream;
  if (!streamEl.parentNode) return;
  const children = Array.from(streamEl.children);
  if (children.length === 0) {
    streamEl.remove();
    return;
  }

  // Count tool lines for the summary label
  const toolCount = children.filter(el => el.classList.contains('chat-tool-line')).length;
  const label = toolCount > 0 ? `${toolCount} tool${toolCount === 1 ? '' : 's'} used` : 'Show process';

  const details = document.createElement('details');
  details.className = 'chat-process-details';
  const summary = document.createElement('summary');
  summary.className = 'chat-process-summary';
  summary.textContent = label;
  details.appendChild(summary);

  // Move all stream children into the details
  const inner = document.createElement('div');
  inner.className = 'chat-process-inner';
  while (streamEl.firstChild) {
    inner.appendChild(streamEl.firstChild);
  }
  details.appendChild(inner);

  streamEl.parentNode.insertBefore(details, streamEl);
  streamEl.remove();
}

function releaseLivePanel(card: LiveRunCard): void {
  const panel = card.panel;
  const parent = panel.parentNode;
  if (!parent) return;

  while (panel.firstChild) {
    parent.insertBefore(panel.firstChild, panel);
  }
  panel.remove();
}

function flushFinalResult(taskId: string, result: any, _provider?: string): void {
  const card = liveRunCards.get(taskId);
  if (!card) return;

  clearWaitingShimmer(card);

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

  // Remove the prompt line and collapse stream into disclosure
  card.root.querySelector('.chat-live-prompt')?.remove();
  collapseStreamIntoDisclosure(card);
  releaseLivePanel(card);
  card.meta.closest('.chat-msg-header')?.remove();
  card.root.classList.remove('chat-msg-live');
  card.root.classList.remove('chat-msg-live-has-output');
  card.root.classList.add('chat-msg-done');

  // Restore previous archived cards so the user can scroll back through history
  card.root.parentElement?.querySelectorAll<HTMLElement>('.chat-msg-archived').forEach(el => {
    el.classList.remove('chat-msg-archived');
  });

  card.callbacks.scheduleChatScrollToBottom(false, 6);
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

  card.meta.classList.remove('chat-msg-meta-working');
  card.meta.textContent = 'failed';
  card.output.className = 'chat-msg-error';
  card.output.textContent = error;
  card.callbacks.updateLastAgentResponseText(String(error));
  releaseLivePanel(card);
  card.root.classList.remove('chat-msg-live');
  card.root.classList.remove('chat-msg-live-has-output');
  card.root.classList.add('chat-msg-done');
  card.callbacks.scheduleChatScrollToBottom(false, 6);
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
