import { formatTime, escapeHtml } from '../shared/utils.js';
import type { CodexItem } from '../../shared/types/model.js';

// ─── DOM ────────────────────────────────────────────────────────────────────

const taskSummary = document.getElementById('taskSummary')!;
const splitLabel = document.getElementById('splitLabel')!;
const modelLabel = document.getElementById('modelLabel')!;
const sessionLabel = document.getElementById('sessionLabel')!;
const taskCount = document.getElementById('taskCount')!;
const logStream = document.getElementById('logStream')!;
const logsCopyBtn = document.getElementById('logsCopyBtn')!;
const logsClearBtn = document.getElementById('logsClearBtn')!;

// Codex metric boxes
const metricContextValue = document.getElementById('metricContextValue')!;
const metricContextSub = document.getElementById('metricContextSub')!;
const metricContextBar = document.getElementById('metricContextBar')!;
const metric5hValue = document.getElementById('metric5hValue')!;
const metric5hSub = document.getElementById('metric5hSub')!;
const metric5hBar = document.getElementById('metric5hBar')!;
const metricWeeklyValue = document.getElementById('metricWeeklyValue')!;
const metricWeeklySub = document.getElementById('metricWeeklySub')!;
const metricWeeklyBar = document.getElementById('metricWeeklyBar')!;
const metricCreditsValue = document.getElementById('metricCreditsValue')!;

// Haiku metric boxes
const haikuTokensValue = document.getElementById('haikuTokensValue')!;
const haikuTokensSub = document.getElementById('haikuTokensSub')!;
const haikuTokensBar = document.getElementById('haikuTokensBar')!;
const haikuCostValue = document.getElementById('haikuCostValue')!;
const haikuCostSub = document.getElementById('haikuCostSub')!;
const haikuCostBar = document.getElementById('haikuCostBar')!;
const haikuTurnsValue = document.getElementById('haikuTurnsValue')!;
const haikuTurnsSub = document.getElementById('haikuTurnsSub')!;
const sessionTotalValue = document.getElementById('sessionTotalValue')!;
const sessionTotalSub = document.getElementById('sessionTotalSub')!;

// Controls (in 4th metric box)
const modelSelector = document.getElementById('modelSelector')!;
const splitSelector = document.getElementById('splitSelector')!;

// Chat
const chatThread = document.getElementById('chatThread')!;
const chatEmptyState = document.getElementById('chatEmptyState')!;
const chatInput = document.getElementById('chatInput') as HTMLInputElement;
const chatSubmitBtn = document.getElementById('chatSubmitBtn')!;
const modelApi = (workspaceAPI as any).model;

// ─── State ──────────────────────────────────────────────────────────────────

let selectedOwner: 'auto' | 'codex' | 'haiku' = 'auto';
let chatCounter = 0;
let renderedTaskMemoryKey: string | null = null;
let currentRenderedTaskId: string | null = null;
let chatAutoPinned = true;
let chatScrollRaf: number | null = null;
let chatScrollFramesRemaining = 0;
let suppressChatScrollEvent = false;

type LiveRunCard = {
  root: HTMLElement;
  meta: HTMLElement;
  activity: HTMLElement;
  output: HTMLElement;
  seenThoughts: Set<string>;
  pendingToolBlock: HTMLDetailsElement | null;
  typingQueue: string[];
  typingTimer: number | null;
  activeThoughtEl: HTMLElement | null;
  deferredToolEvents: Array<{ kind: 'call' | 'result'; text: string }>;
};

const liveRunCards = new Map<string, LiveRunCard>();

// ─── Model Owner Selector ──────────────────────────────────────────────────

function setModelOwner(owner: 'auto' | 'codex' | 'haiku'): void {
  selectedOwner = owner;
  modelSelector.querySelectorAll('.cc-toggle').forEach((btn) => {
    (btn as HTMLElement).classList.toggle('active', (btn as HTMLElement).dataset.owner === owner);
  });
}

modelSelector.addEventListener('click', (e: Event) => {
  const btn = (e.target as HTMLElement).closest('[data-owner]') as HTMLElement | null;
  if (btn?.dataset.owner) setModelOwner(btn.dataset.owner as 'auto' | 'codex' | 'haiku');
});

// ─── Split Selector ────────────────────────────────────────────────────────

splitSelector.addEventListener('click', (e: Event) => {
  const btn = (e.target as HTMLElement).closest('[data-preset]') as HTMLElement | null;
  if (btn?.dataset.preset) {
    workspaceAPI.applyExecutionPreset(btn.dataset.preset as import('../../shared/types/appState').ExecutionLayoutPreset);
  }
});

// ─── Metric Box Rendering ──────────────────────────────────────────────────

interface CodexStatusMetrics {
  contextWindow?: { percentLeft: number; used: string; total: string };
  limit5h?: { percentLeft: number; resetsAt: string };
  limitWeekly?: { percentLeft: number; resetsAt: string };
  credits?: number;
}

// Session-level token tracking (per provider)
let haikuInputTokens = 0;
let haikuOutputTokens = 0;
let haikuTurnCount = 0;
let codexSessionTokens = 0;
let codexSessionTurns = 0;

// Haiku 4.5 pricing: $0.80/MTok input, $4.00/MTok output
const HAIKU_INPUT_COST_PER_TOKEN = 0.80 / 1_000_000;
const HAIKU_OUTPUT_COST_PER_TOKEN = 4.00 / 1_000_000;

function formatTokenCount(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(dollars: number): string {
  if (dollars < 0.01) return `$${dollars.toFixed(4)}`;
  if (dollars < 1) return `$${dollars.toFixed(3)}`;
  return `$${dollars.toFixed(2)}`;
}

function renderCodexMetrics(metrics: CodexStatusMetrics): void {
  if (metrics.contextWindow) {
    const cw = metrics.contextWindow;
    metricContextValue.textContent = cw.used;
    metricContextSub.textContent = cw.total;
    metricContextBar.style.width = `${100 - cw.percentLeft}%`;
  }

  if (metrics.limit5h) {
    const lim = metrics.limit5h;
    metric5hValue.textContent = lim.resetsAt.split('/')[0]?.trim() || '0';
    metric5hSub.textContent = lim.resetsAt.split('/')[1]?.trim() || '';
    metric5hBar.style.width = `${100 - lim.percentLeft}%`;
  }

  if (metrics.limitWeekly) {
    const lim = metrics.limitWeekly;
    metricWeeklyValue.textContent = lim.resetsAt.split('/')[0]?.trim() || '0';
    metricWeeklySub.textContent = lim.resetsAt.split('/')[1]?.trim() || '';
    metricWeeklyBar.style.width = `${100 - lim.percentLeft}%`;
  }

  if (metrics.credits !== undefined) {
    metricCreditsValue.textContent = String(metrics.credits);
  }
}

function renderHaikuMetrics(): void {
  const totalTokens = haikuInputTokens + haikuOutputTokens;
  const cost = (haikuInputTokens * HAIKU_INPUT_COST_PER_TOKEN) + (haikuOutputTokens * HAIKU_OUTPUT_COST_PER_TOKEN);

  haikuTokensValue.textContent = formatTokenCount(totalTokens);
  haikuTokensSub.textContent = `in: ${formatTokenCount(haikuInputTokens)} / out: ${formatTokenCount(haikuOutputTokens)}`;
  // Fill bar based on a $1 budget threshold
  haikuTokensBar.style.width = `${Math.min(100, Math.round((totalTokens / 1_000_000) * 10))}%`;

  haikuCostValue.textContent = formatCost(cost);
  haikuCostSub.textContent = `$${(haikuInputTokens * HAIKU_INPUT_COST_PER_TOKEN).toFixed(4)} in / $${(haikuOutputTokens * HAIKU_OUTPUT_COST_PER_TOKEN).toFixed(4)} out`;
  haikuCostBar.style.width = `${Math.min(100, Math.round(cost * 100))}%`;

  haikuTurnsValue.textContent = String(haikuTurnCount);
  haikuTurnsSub.textContent = `avg ${haikuTurnCount > 0 ? formatTokenCount(Math.round(totalTokens / haikuTurnCount)) : '0'}/turn`;

  sessionTotalValue.textContent = formatCost(cost);
  sessionTotalSub.textContent = `${haikuTurnCount + codexSessionTurns} turns total`;
}

function trackTokenUsage(result: any, provider: string): void {
  if (!result?.usage) return;
  const inputTok = result.usage.inputTokens || 0;
  const outputTok = result.usage.outputTokens || 0;

  if (provider === 'haiku') {
    haikuInputTokens += inputTok;
    haikuOutputTokens += outputTok;
    haikuTurnCount++;
    renderHaikuMetrics();
  } else {
    codexSessionTokens += inputTok + outputTok;
    codexSessionTurns++;
    renderHaikuMetrics(); // Update session total
  }
}

// ─── Log Rendering ─────────────────────────────────────────────────────────

let lastLogCount = 0;
let logsCopyFeedbackTimer: number | null = null;

function renderLogs(logs: any[]): void {
  const newLogs = logs.slice(lastLogCount);
  for (const log of newLogs) {
    const el = document.createElement('div');
    el.className = `log-entry ${log.level}`;
    el.innerHTML = `<span class="log-time">${formatTime(log.timestamp)}</span><span class="log-source" data-source="${escapeHtml(log.source)}">[${escapeHtml(log.source)}]</span><span class="log-message">${escapeHtml(log.message)}</span>`;
    logStream.appendChild(el);
  }
  lastLogCount = logs.length;
  logStream.scrollTop = logStream.scrollHeight;
}

async function copyVisibleLogs(): Promise<void> {
  const text = logStream.innerText.trim();
  if (!text) return;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }

    logsCopyBtn.classList.add('copied');
    logsCopyBtn.setAttribute('title', 'Copied');
    logsCopyBtn.setAttribute('aria-label', 'Logs copied');
    if (logsCopyFeedbackTimer !== null) window.clearTimeout(logsCopyFeedbackTimer);
    logsCopyFeedbackTimer = window.setTimeout(() => {
      logsCopyBtn.classList.remove('copied');
      logsCopyBtn.setAttribute('title', 'Copy visible logs');
      logsCopyBtn.setAttribute('aria-label', 'Copy visible logs');
      logsCopyFeedbackTimer = null;
    }, 1200);
  } catch (err) {
    workspaceAPI.addLog('error', 'system', `Failed to copy logs: ${err instanceof Error ? err.message : String(err)}`);
  }
}

logsCopyBtn.addEventListener('click', () => {
  void copyVisibleLogs();
});

logsClearBtn.addEventListener('click', () => {
  logStream.innerHTML = '';
  lastLogCount = 0;
});

// ─── Chat Scroll ───────────────────────────────────────────────────────────

function isChatNearBottom(threshold = 56): boolean {
  const distanceFromBottom = chatThread.scrollHeight - (chatThread.scrollTop + chatThread.clientHeight);
  return distanceFromBottom <= threshold;
}

function performChatScrollToBottom(): void {
  suppressChatScrollEvent = true;
  chatThread.scrollTop = chatThread.scrollHeight;
  queueMicrotask(() => { suppressChatScrollEvent = false; });
}

function scheduleChatScrollToBottom(force = false, frames = 3): void {
  if (!force && !chatAutoPinned) return;
  if (force) chatAutoPinned = true;
  chatScrollFramesRemaining = Math.max(chatScrollFramesRemaining, frames);
  if (chatScrollRaf !== null) return;

  const tick = () => {
    performChatScrollToBottom();
    chatScrollFramesRemaining -= 1;
    if (chatScrollFramesRemaining > 0) {
      chatScrollRaf = window.requestAnimationFrame(tick);
      return;
    }
    chatScrollRaf = null;
  };

  chatScrollRaf = window.requestAnimationFrame(tick);
}

chatThread.addEventListener('scroll', () => {
  if (suppressChatScrollEvent) return;
  chatAutoPinned = isChatNearBottom();
});

chatThread.addEventListener('toggle', (event: Event) => {
  const target = event.target as HTMLElement | null;
  if (!target?.classList.contains('chat-tool-details')) return;
  scheduleChatScrollToBottom(true, 6);
}, true);

const chatResizeObserver = new ResizeObserver(() => {
  scheduleChatScrollToBottom(false, 4);
});
chatResizeObserver.observe(chatThread);

const chatMutationObserver = new MutationObserver(() => {
  scheduleChatScrollToBottom(false, 5);
});
chatMutationObserver.observe(chatThread, {
  childList: true,
  subtree: true,
  characterData: true,
});

// ─── Markdown Rendering ────────────────────────────────────────────────────

function renderInlineMarkdown(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function renderMarkdown(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').trim().split('\n');
  const parts: string[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    parts.push(`<p>${renderInlineMarkdown(paragraph.join('<br>'))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (listItems.length === 0) return;
    parts.push(`<ul>${listItems.map(item => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</ul>`);
    listItems = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(3, heading[1].length);
      parts.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    if (trimmed.startsWith('- ')) {
      flushParagraph();
      listItems.push(trimmed.slice(2));
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  return parts.join('');
}

function prettifyToolName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function truncateSingleLine(text: string, max = 120): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}

function extractToolName(text: string): string {
  return text.split('→')[0]?.trim() || text.trim();
}

function summarizeToolCall(text: string): string {
  const toolName = extractToolName(text);
  return prettifyToolName(toolName);
}

function summarizeToolResult(text: string): string {
  const [, detail = 'Completed'] = text.split('→');
  return truncateSingleLine(detail || 'Completed');
}

function summarizeUnknownForUi(value: unknown, max = 140): string {
  if (value == null) return 'Completed';
  if (typeof value === 'string') return truncateSingleLine(value, max);
  try {
    return truncateSingleLine(JSON.stringify(value), max);
  } catch {
    return truncateSingleLine(String(value), max);
  }
}

function isRawToolTranscript(text: string): boolean {
  const trimmed = text.trim();
  return /^\+\s*tool\b/i.test(trimmed)
    || /^tool\s+[a-z0-9_]+/i.test(trimmed)
    || /^tool result:\s/i.test(trimmed)
    || /^tool call:\s/i.test(trimmed);
}

// ─── Chat Message Helpers ──────────────────────────────────────────────────

function isInternalPromptText(text: string): boolean {
  return text.startsWith('Run a critique pass on the current draft answer before finalizing.')
    || text.startsWith('Revise the draft answer using the critique and verification records now stored in task memory.');
}

function isInternalModelText(text: string): boolean {
  return text.startsWith('## Critique Summary');
}

function shouldShowMemoryEntry(entry: TaskMemoryEntry): boolean {
  if (entry.kind === 'system' || entry.kind === 'handoff' || entry.kind === 'browser_finding') return false;
  if (entry.kind === 'user_prompt') return !isInternalPromptText(entry.text);
  if (entry.kind === 'model_result') return !isInternalModelText(entry.text);
  return true;
}

function appendUserMessage(text: string): void {
  if (chatEmptyState.parentNode) chatEmptyState.remove();
  const el = document.createElement('div');
  el.className = 'chat-msg chat-msg-user';
  el.textContent = text;
  chatThread.appendChild(el);
  scheduleChatScrollToBottom(true);
}

function clearChatThread(): void {
  chatThread.innerHTML = '';
  chatThread.appendChild(chatEmptyState);
}

function createLiveRunCard(taskId: string, provider: string): LiveRunCard {
  if (chatEmptyState.parentNode) chatEmptyState.remove();
  const root = document.createElement('div');
  root.className = 'chat-msg chat-msg-model chat-msg-live';
  root.dataset.taskId = taskId;
  root.innerHTML =
    `<div class="chat-msg-header">` +
    `<span class="chat-msg-provider ${escapeHtml(provider)}">${escapeHtml(provider)}</span>` +
    `<span class="chat-msg-meta">working...</span>` +
    `</div>` +
    `<div class="chat-activity"></div>` +
    `<div class="chat-msg-text chat-msg-thinking shimmer">Working\u2026</div>`;
  chatThread.appendChild(root);
  scheduleChatScrollToBottom(true, 5);
  const card: LiveRunCard = {
    root,
    meta: root.querySelector('.chat-msg-meta') as HTMLElement,
    activity: root.querySelector('.chat-activity') as HTMLElement,
    output: root.querySelector('.chat-msg-text') as HTMLElement,
    seenThoughts: new Set(),
    pendingToolBlock: null,
    typingQueue: [],
    typingTimer: null,
    activeThoughtEl: null,
    deferredToolEvents: [],
  };
  liveRunCards.set(taskId, card);
  return card;
}

function appendMemoryEntry(entry: TaskMemoryEntry): void {
  if (!shouldShowMemoryEntry(entry)) return;

  if (entry.kind === 'user_prompt') {
    appendUserMessage(entry.text);
    return;
  }

  if (chatEmptyState.parentNode) chatEmptyState.remove();
  const el = document.createElement('div');
  el.className = 'chat-msg chat-msg-model';
  const provider = entry.providerId || 'system';
  el.innerHTML =
    `<div class="chat-msg-header">` +
    `<span class="chat-msg-provider ${escapeHtml(provider)}">${escapeHtml(provider)}</span>` +
    `<span class="chat-msg-meta">${escapeHtml(formatTime(entry.createdAt))}</span>` +
    `</div>` +
    `<div class="chat-msg-text chat-markdown">${renderMarkdown(entry.text)}</div>`;
  chatThread.appendChild(el);
  scheduleChatScrollToBottom(true);
}

async function refreshTaskConversation(taskId: string | null): Promise<void> {
  if (!taskId) {
    renderedTaskMemoryKey = null;
    clearChatThread();
    return;
  }

  const existingCard = liveRunCards.get(taskId);
  if (existingCard?.root.isConnected) return;

  if (!modelApi?.getTaskMemory) {
    renderedTaskMemoryKey = `${taskId}:model-disabled`;
    clearChatThread();
    return;
  }

  const memory = await modelApi.getTaskMemory(taskId);
  const memoryKey = `${taskId}:${memory.lastUpdatedAt || 0}:${memory.entries.length}`;
  if (memoryKey === renderedTaskMemoryKey) return;

  renderedTaskMemoryKey = memoryKey;
  clearChatThread();
  for (const entry of memory.entries) {
    appendMemoryEntry(entry);
  }
}

// ─── Thought / Tool Activity Streaming ─────────────────────────────────────

function appendThought(taskId: string, text: string): void {
  const card = liveRunCards.get(taskId);
  if (!card) return;
  const trimmed = text.trim();
  if (!trimmed) return;
  if (isRawToolTranscript(trimmed)) return;
  if (/^(##\s*(Observation|Inference|Critique Summary)|Observation:|Inference:)/.test(trimmed)) return;
  if (trimmed.length > 260 || trimmed.split('\n').length > 4) return;
  if (card.seenThoughts.has(trimmed)) return;
  card.seenThoughts.add(trimmed);
  card.pendingToolBlock = null;
  card.typingQueue.push(trimmed);
  if (card.typingTimer !== null) return;

  const typeNext = () => {
    const next = card.typingQueue.shift();
    if (!next) {
      card.typingTimer = null;
      card.activeThoughtEl = null;
      while (card.deferredToolEvents.length > 0) {
        const event = card.deferredToolEvents.shift()!;
        appendToolActivity(taskId, event.kind, event.text);
      }
      return;
    }

    const el = document.createElement('div');
    el.className = 'chat-thought';
    card.activity.appendChild(el);
    card.activeThoughtEl = el;
    let idx = 0;
    const step = () => {
      idx += 2;
      el.textContent = next.slice(0, idx);
      scheduleChatScrollToBottom(true, 4);
      if (idx < next.length) {
        card.typingTimer = window.setTimeout(step, 10);
      } else {
        card.typingTimer = window.setTimeout(() => {
          card.typingTimer = null;
          card.activeThoughtEl = null;
          while (card.deferredToolEvents.length > 0) {
            const event = card.deferredToolEvents.shift()!;
            appendToolActivity(taskId, event.kind, event.text);
          }
          typeNext();
        }, 90);
      }
    };
    step();
  };

  typeNext();
}

function appendToolActivity(taskId: string, kind: 'call' | 'result', text: string): void {
  const card = liveRunCards.get(taskId);
  if (!card) return;
  if (card.typingTimer !== null || card.activeThoughtEl) {
    card.deferredToolEvents.push({ kind, text });
    return;
  }
  if (kind === 'call' || !card.pendingToolBlock) {
    const toolName = extractToolName(text);
    const details = document.createElement('details');
    details.className = 'chat-tool-details';
    details.dataset.toolName = toolName;
    details.innerHTML =
      `<summary><span class="chat-tool-label">Tool</span><span class="chat-tool-summary-code">${escapeHtml(summarizeToolCall(toolName))}</span></summary>` +
      `<div class="chat-tool-list"></div>`;
    card.activity.appendChild(details);
    card.pendingToolBlock = details;
  }

  const target = card.pendingToolBlock.querySelector('.chat-tool-list') as HTMLElement;
  const row = document.createElement('div');
  row.className = `chat-tool-row ${kind}`;
  const detailText = kind === 'call' ? text : (text.includes('→') ? text.split('→').slice(1).join('→').trim() : text);
  row.innerHTML = `<span class="chat-tool-kind">${kind === 'call' ? 'CALL' : 'RESULT'}</span><code>${escapeHtml(detailText)}</code>`;
  target.appendChild(row);

  if (kind === 'result') {
    const summaryEl = card.pendingToolBlock.querySelector('.chat-tool-summary-code') as HTMLElement | null;
    if (summaryEl) {
      const toolName = card.pendingToolBlock.dataset.toolName || extractToolName(text);
      summaryEl.textContent = `${prettifyToolName(toolName)} · ${summarizeToolResult(text)}`;
    }
    card.pendingToolBlock = null;
  }
  scheduleChatScrollToBottom(true, 5);
}

function appendCodexItemProgress(taskId: string, progressData: string, item?: CodexItem): void {
  if (!item) return;
  const started = /\bstarted$/.test(progressData);
  const completed = /\bcompleted$/.test(progressData);

  if (item.type === 'agent_message' && completed) {
    for (const line of item.text.split('\n')) {
      appendThought(taskId, line);
    }
    return;
  }

  if (item.type === 'mcp_tool_call') {
    const toolLabel = item.tool || item.server || 'tool';
    if (started) {
      appendToolActivity(taskId, 'call', toolLabel);
    } else if (completed) {
      const detail = item.error?.message ? `Error: ${item.error.message}` : summarizeUnknownForUi(item.result);
      appendToolActivity(taskId, 'result', `${toolLabel} → ${detail}`);
    }
    return;
  }

  if (item.type === 'command_execution') {
    if (started) {
      appendToolActivity(taskId, 'call', item.command);
    } else if (completed) {
      const detail = item.exit_code == null ? 'Completed' : (item.exit_code === 0 ? 'Succeeded' : `Exit ${item.exit_code}`);
      appendToolActivity(taskId, 'result', `${item.command} → ${detail}`);
    }
    return;
  }

  if (item.type === 'file_change' && completed) {
    const detail = item.changes.map((change) => `${change.kind} ${change.path}`).join(', ') || 'Updated files';
    appendToolActivity(taskId, 'result', `file_change → ${detail}`);
  }
}

function replaceWithResult(taskId: string, result: any, provider?: string): void {
  const card = liveRunCards.get(taskId);
  if (!card) return;
  if (result.codexItems && result.codexItems.length > 0) {
    for (const item of result.codexItems) {
      if (item.type === 'command_execution' && item.status === 'completed') {
        appendToolActivity(taskId, 'result', `$ ${item.command}`);
      } else if (item.type === 'file_change' && item.status === 'completed') {
        const changes = item.changes.map((c: any) => `${c.kind}: ${c.path}`).join(', ');
        appendToolActivity(taskId, 'result', changes);
      }
    }
  }

  const usage = result.usage;
  const meta = `${usage.durationMs}ms | ${usage.inputTokens}in / ${usage.outputTokens}out`;

  if (result.success) {
    card.meta.textContent = meta;
    card.output.className = 'chat-msg-text chat-markdown';
    card.output.innerHTML = renderMarkdown(result.output);
  } else {
    card.meta.textContent = 'failed';
    card.output.className = 'chat-msg-error';
    card.output.textContent = result.error || 'Unknown error';
  }
  trackTokenUsage(result, provider || result.providerId || 'codex');
  scheduleChatScrollToBottom(true, 6);
}

function replaceWithError(taskId: string, error: string): void {
  const card = liveRunCards.get(taskId);
  if (!card) return;
  card.meta.textContent = 'failed';
  card.output.className = 'chat-msg-error';
  card.output.textContent = error;
  scheduleChatScrollToBottom(true, 6);
}

// ─── Chat Submission ───────────────────────────────────────────────────────

function getActiveTaskIdFromState(): string | null {
  const state = (window as any).__lastState;
  return state?.activeTaskId || null;
}

async function submitChat(): Promise<void> {
  const prompt = chatInput.value.trim();
  if (!prompt) { chatInput.focus(); return; }

  if (!modelApi?.invoke) {
    appendUserMessage(prompt);
    chatInput.value = '';
    const disabledTaskId = `model-disabled-${chatCounter++}`;
    createLiveRunCard(disabledTaskId, 'system');
    replaceWithError(disabledTaskId, 'Model integration is not enabled in this v2 browser build.');
    workspaceAPI.addLog('warn', 'system', 'Model integration is not enabled in this v2 browser build.');
    chatInput.focus();
    return;
  }

  chatCounter++;
  let taskId = getActiveTaskIdFromState();
  const owner = selectedOwner === 'auto' ? undefined : selectedOwner;

  if (!taskId) {
    const title = prompt.length > 48 ? `${prompt.slice(0, 48)}...` : prompt;
    const createdTask = await workspaceAPI.createTask(title);
    taskId = createdTask.id;
  }

  chatInput.value = '';
  chatSubmitBtn.setAttribute('disabled', '');

  appendUserMessage(prompt);

  let resolvedOwner: string = owner || '';
  if (!resolvedOwner) {
    try {
      resolvedOwner = modelApi.resolve ? await modelApi.resolve(prompt) : 'haiku';
    } catch {
      resolvedOwner = 'haiku';
    }
  }

  createLiveRunCard(taskId, resolvedOwner);

  try {
    const result = await modelApi.invoke(taskId, prompt, resolvedOwner);
    replaceWithResult(taskId, result, resolvedOwner);
  } catch (err: any) {
    replaceWithError(taskId, err.message || String(err));
  } finally {
    chatSubmitBtn.removeAttribute('disabled');
    chatInput.focus();
  }
}

chatSubmitBtn.addEventListener('click', submitChat);
chatInput.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter') submitChat();
});

// ─── Full State Render ─────────────────────────────────────────────────────

function renderState(state: any): void {
  (window as any).__lastState = state;
  const active = state.tasks.find((t: any) => t.id === state.activeTaskId);
  taskSummary.textContent = active ? active.title : 'No active task';
  renderLogs(state.logs);

  if (state.executionSplit) {
    const ratio = state.executionSplit.ratio;
    splitLabel.textContent = `split ${Math.round(ratio * 100)}/${Math.round((1 - ratio) * 100)}`;
    splitSelector.querySelectorAll('[data-preset]').forEach((btn) => {
      (btn as HTMLElement).classList.toggle('active', (btn as HTMLElement).dataset.preset === state.executionSplit.preset);
    });
  }

  taskCount.textContent = `tasks: ${state.tasks.length}`;

  // Update session/model labels from providers
  const haiku = state.providers?.haiku;
  if (haiku?.sessionId) {
    sessionLabel.textContent = haiku.sessionId.slice(0, 12);
  } else {
    sessionLabel.textContent = haiku?.status || 'unavailable';
  }
  if (haiku?.model) {
    modelLabel.textContent = haiku.model;
  }

  // Update metrics from provider state if available
  if (haiku?.metrics) {
    renderCodexMetrics(haiku.metrics);
  }

  const nextTaskId = state.activeTaskId || null;
  if (nextTaskId !== currentRenderedTaskId) {
    currentRenderedTaskId = nextTaskId;
    renderedTaskMemoryKey = null;
    void refreshTaskConversation(nextTaskId);
  } else if (!nextTaskId || !liveRunCards.get(nextTaskId)?.root.isConnected) {
    void refreshTaskConversation(nextTaskId);
  }
}

// ─── Live Updates ──────────────────────────────────────────────────────────

workspaceAPI.onStateUpdate((state: any) => renderState(state));

if (modelApi?.onProgress) {
  modelApi.onProgress((progress: any) => {
    if (!progress?.taskId || !liveRunCards.has(progress.taskId)) return;
    if (progress.type === 'token') {
      appendThought(progress.taskId, String(progress.data || ''));
      return;
    }
    if (progress.type === 'item') {
      appendCodexItemProgress(progress.taskId, String(progress.data || ''), progress.codexItem as CodexItem | undefined);
      return;
    }
    if (progress.type === 'status') {
      const text = String(progress.data || '');
      if (text.startsWith('Calling ')) {
        appendToolActivity(progress.taskId, 'call', text.replace(/^Calling\s+/, '').replace(/\.\.\.$/, ''));
      } else if (text.startsWith('Tool result: ')) {
        appendToolActivity(progress.taskId, 'result', text.slice('Tool result: '.length));
      } else if (text && !/^Turn completed/.test(text)) {
        appendThought(progress.taskId, text);
      }
    }
  });
}

// ─── Init ──────────────────────────────────────────────────────────────────

workspaceAPI.getState().then((state: any) => {
  renderState(state);
  workspaceAPI.addLog('info', 'system', 'Command Center initialized');
});
