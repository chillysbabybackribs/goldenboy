import { formatTime, escapeHtml } from '../shared/utils.js';
import { HAIKU_PROVIDER_ID, PRIMARY_PROVIDER_ID, ProviderId } from '../../shared/types/model.js';
import {
  appendCodexItemProgress as appendCodexItemProgressInternal,
  appendThought as appendThoughtInternal,
  appendToolActivity as appendToolActivityInternal,
  appendToolStatus as appendToolStatusInternal,
  appendToken as appendTokenInternal,
  createLiveRunCard as createLiveRunCardInternal,
  getLiveRunCard,
  replaceWithError as replaceWithErrorInternal,
  replaceWithResult as replaceWithResultInternal,
} from './live-run.js';
import { TaskStatusBar } from './taskStatusBar.js';

const getWorkspaceAPI = () => (window as any).workspaceAPI as WorkspaceAPI | null;
const getModelAPI = () => getWorkspaceAPI()?.model ?? null;

// ─── DOM ────────────────────────────────────────────────────────────────────

const taskSummary = document.getElementById('taskSummary')!;
const splitLabel = document.getElementById('splitLabel')!;
const targetLabel = document.getElementById('targetLabel')!;
const modelLabel = document.getElementById('modelLabel')!;
const sessionLabel = document.getElementById('sessionLabel')!;
const taskCount = document.getElementById('taskCount')!;
const commandShell = document.querySelector('.cc-shell') as HTMLElement;
const logStream = document.getElementById('logStream')!;
const logsCopyBtn = document.getElementById('logsCopyBtn')!;
const logsClearBtn = document.getElementById('logsClearBtn')!;
const logsBtn = document.getElementById('logsBtn') as HTMLButtonElement;
const logsOverlay = document.getElementById('logsOverlay') as HTMLDivElement;
const logsCloseBtn = document.getElementById('logsCloseBtn')!;

// Chat
const chatThread = document.getElementById('chatThread')!;
const chatInner = document.getElementById('chatInner')!;
const chatEmptyState = document.getElementById('chatEmptyState')!;
const chatInput = document.getElementById('chatInput') as HTMLTextAreaElement;
const chatCopyLastBtn = document.getElementById('chatCopyLastBtn') as HTMLButtonElement;
const modelChip = document.getElementById('modelChip') as HTMLButtonElement;
const modelChipLabel = document.getElementById('modelChipLabel') as HTMLSpanElement;
const chatZoomOutBtn = document.getElementById('chatZoomOutBtn') as HTMLButtonElement;
const chatZoomResetBtn = document.getElementById('chatZoomResetBtn') as HTMLButtonElement;
const chatZoomInBtn = document.getElementById('chatZoomInBtn') as HTMLButtonElement;

// History
const chatHistoryBtn = document.getElementById('chatHistoryBtn')!;
const historyOverlay = document.getElementById('historyOverlay')!;
const historyList = document.getElementById('historyList')!;
const historyNewBtn = document.getElementById('historyNewBtn')!;
const historyCloseBtn = document.getElementById('historyCloseBtn')!;

// Token usage — displayed in status bar
const tokenStatusLabel = document.getElementById('tokenStatusLabel')!;

// Stop
const chatStopBtn = document.getElementById('chatStopBtn') as HTMLButtonElement;

// Attachments
const attachDocBtn = document.getElementById('attachDocBtn')!;
const attachImgBtn = document.getElementById('attachImgBtn')!;
const attachPreview = document.getElementById('attachPreview') as HTMLDivElement;
const attachPreviewList = document.getElementById('attachPreviewList') as HTMLDivElement;
const docFileInput = document.getElementById('docFileInput') as HTMLInputElement;
const imgFileInput = document.getElementById('imgFileInput') as HTMLInputElement;
const taskStatusBarEl = document.getElementById('taskStatusBar') as HTMLDivElement;

// ─── Task Status Bar ─────────────────────────────────────────────────────

const taskStatusBar = new TaskStatusBar(taskStatusBarEl);

// ─── State ──────────────────────────────────────────────────────────────────

type SelectableOwner = 'auto' | typeof PRIMARY_PROVIDER_ID | typeof HAIKU_PROVIDER_ID;
type ExplicitSelectableOwner = Exclude<SelectableOwner, 'auto'>;
type ProviderRuntimeView = {
  status?: string;
  model?: string;
  sessionId?: string;
  errorDetail?: string | null;
};

const SELECTABLE_OWNERS: SelectableOwner[] = ['auto', PRIMARY_PROVIDER_ID, HAIKU_PROVIDER_ID];
const SELECTED_OWNER_STORAGE_KEY = 'command-center-selected-owner';
const OWNER_LABELS: Record<SelectableOwner, string> = {
  auto: 'Default',
  [PRIMARY_PROVIDER_ID]: 'GPT-5.4',
  [HAIKU_PROVIDER_ID]: 'Haiku 4.5',
};

function getOwnerDisplayLabel(owner: SelectableOwner): string {
  return OWNER_LABELS[owner].toLowerCase();
}

let selectedOwner: SelectableOwner = 'auto';
let chatCounter = 0;
let renderedTaskMemoryKey: string | null = null;
let currentRenderedTaskId: string | null = null;
let chatAutoPinned = true;
let chatScrollRaf: number | null = null;
let chatScrollFramesRemaining = 0;
let suppressChatScrollEvent = false;
let lastAgentResponseText = '';
let chatCopyFeedbackTimer: number | null = null;
let chatZoom = 1;
let runningTaskId: string | null = null;

const CHAT_ZOOM_STORAGE_KEY = 'command-center-chat-zoom';
const CHAT_ZOOM_DEFAULT = 1;
const CHAT_ZOOM_MIN = 0.8;
const CHAT_ZOOM_MAX = 1.6;
const CHAT_ZOOM_STEP = 0.1;

function isSelectableOwner(value: string): value is SelectableOwner {
  return SELECTABLE_OWNERS.includes(value as SelectableOwner);
}

function isExplicitSelectableOwner(value: string): value is ExplicitSelectableOwner {
  return value === PRIMARY_PROVIDER_ID || value === HAIKU_PROVIDER_ID;
}

function getProviderRuntime(state: any, owner: ExplicitSelectableOwner): ProviderRuntimeView | null {
  return (state?.providers?.[owner] as ProviderRuntimeView | undefined) ?? null;
}

function canSelectOwner(state: any, owner: ExplicitSelectableOwner): boolean {
  const runtime = getProviderRuntime(state, owner);
  if (!runtime) return false;
  return runtime.status !== 'unavailable' && runtime.status !== 'error';
}

function getStoredSelectedOwner(): SelectableOwner {
  try {
    const stored = window.localStorage.getItem(SELECTED_OWNER_STORAGE_KEY);
    if (stored && isSelectableOwner(stored)) return stored;
  } catch {
    // Ignore storage failures in restricted renderer environments.
  }
  return 'auto';
}

function persistSelectedOwner(): void {
  try {
    window.localStorage.setItem(SELECTED_OWNER_STORAGE_KEY, selectedOwner);
  } catch {
    // Ignore storage failures in restricted renderer environments.
  }
}

function normalizeSelectedOwner(nextOwner: SelectableOwner, state: any): SelectableOwner {
  if (nextOwner === 'auto') return 'auto';
  return canSelectOwner(state, nextOwner) ? nextOwner : 'auto';
}

function setSelectedOwner(nextOwner: SelectableOwner, state: any = (window as any).__lastState): void {
  selectedOwner = normalizeSelectedOwner(nextOwner, state);
  persistSelectedOwner();
  syncModelToggleState(state);
}

function syncModelToggleState(state: any = (window as any).__lastState): void {
  const isExplicit = selectedOwner !== 'auto';
  modelChip.classList.toggle('cc-model-chip-explicit', isExplicit);
  modelChipLabel.textContent = OWNER_LABELS[selectedOwner].toUpperCase();
  modelChip.disabled = Boolean(runningTaskId);

  if (isExplicit) {
    const runtime = getProviderRuntime(state, selectedOwner as ExplicitSelectableOwner);
    const status = runtime?.status || 'unavailable';
    const details = [OWNER_LABELS[selectedOwner], runtime?.model || status, runtime?.errorDetail || '']
      .filter(Boolean);
    modelChip.title = details.join(' • ');
  } else {
    modelChip.title = 'Select model (auto)';
  }
}

function initializeModelToggle(): void {
  selectedOwner = getStoredSelectedOwner();

  modelChip.addEventListener('click', () => {
    // Cycle: auto → PRIMARY_PROVIDER_ID → HAIKU_PROVIDER_ID → auto
    const state = (window as any).__lastState;
    const cycle: SelectableOwner[] = ['auto', PRIMARY_PROVIDER_ID, HAIKU_PROVIDER_ID];
    const currentIdx = cycle.indexOf(selectedOwner);
    const nextOwner = cycle[(currentIdx + 1) % cycle.length];
    setSelectedOwner(nextOwner, state);
  });

  syncModelToggleState();
}

function clampChatZoom(value: number): number {
  return Math.min(CHAT_ZOOM_MAX, Math.max(CHAT_ZOOM_MIN, value));
}

function roundChatZoom(value: number): number {
  return Math.round(value * 10) / 10;
}

function syncChatZoomControls(): void {
  chatZoomOutBtn.disabled = chatZoom <= CHAT_ZOOM_MIN;
  chatZoomInBtn.disabled = chatZoom >= CHAT_ZOOM_MAX;
  const percent = Math.round(chatZoom * 100);
  chatZoomResetBtn.textContent = `${percent}%`;
  chatZoomResetBtn.setAttribute('title', `Reset chat zoom (${percent}%)`);
  chatZoomResetBtn.setAttribute('aria-label', `Reset chat zoom (${percent}%)`);
}

function setChatZoom(nextZoom: number, persist = true): void {
  chatZoom = roundChatZoom(clampChatZoom(nextZoom));
  commandShell.style.setProperty('--cc-chat-zoom', String(chatZoom));
  syncChatZoomControls();
  scheduleChatScrollToBottom(false, 2);
  if (!persist) return;
  try {
    window.localStorage.setItem(CHAT_ZOOM_STORAGE_KEY, String(chatZoom));
  } catch {
    // Ignore storage failures in restricted renderer environments.
  }
}

function adjustChatZoom(delta: number): void {
  setChatZoom(chatZoom + delta);
}

function resetChatZoom(): void {
  setChatZoom(CHAT_ZOOM_DEFAULT);
}

function initializeChatZoom(): void {
  try {
    const stored = window.localStorage.getItem(CHAT_ZOOM_STORAGE_KEY);
    const parsed = stored == null ? NaN : Number.parseFloat(stored);
    if (Number.isFinite(parsed)) {
      setChatZoom(parsed, false);
      return;
    }
  } catch {
    // Ignore storage failures in restricted renderer environments.
  }
  setChatZoom(CHAT_ZOOM_DEFAULT, false);
}

// ─── Log Rendering ─────────────────────────────────────────────────────────

let lastLogCount = 0;
let logsCopyFeedbackTimer: number | null = null;
let logsOpen = false;

function setLogsOpen(open: boolean): void {
  logsOpen = open;
  logsOverlay.hidden = !open;
  logsBtn.classList.toggle('active', open);
  if (open) logStream.scrollTop = logStream.scrollHeight;
}

logsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  setLogsOpen(!logsOpen);
});

logsCloseBtn.addEventListener('click', () => setLogsOpen(false));

document.addEventListener('click', (e) => {
  if (logsOpen && !logsOverlay.contains(e.target as Node) && e.target !== logsBtn) {
    setLogsOpen(false);
  }
});

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
    getWorkspaceAPI()?.addLog('error', 'system', `Failed to copy logs: ${err instanceof Error ? err.message : String(err)}`);
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

chatThread.addEventListener('wheel', (e: WheelEvent) => {
  // User scrolling up — immediately unpin auto-scroll
  if (e.deltaY < 0) {
    chatAutoPinned = false;
    // Cancel any pending scroll-to-bottom animation
    if (chatScrollRaf !== null) {
      window.cancelAnimationFrame(chatScrollRaf);
      chatScrollRaf = null;
      chatScrollFramesRemaining = 0;
    }
  }
}, { passive: true });

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
  scheduleChatScrollToBottom(false, 1);
});
chatMutationObserver.observe(chatInner, {
  childList: true,
});

// ─── Markdown Rendering ────────────────────────────────────────────────────

function renderInlineMarkdown(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function renderMarkdown(text: string): string {
  // Normalize: convert literal <br> tags and \r\n to newlines before splitting
  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .trim();

  const lines = normalized.split('\n');
  const parts: string[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let listOrdered = false;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    parts.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (listItems.length === 0) return;
    const tag = listOrdered ? 'ol' : 'ul';
    parts.push(`<${tag}>${listItems.map(item => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</${tag}>`);
    listItems = [];
    listOrdered = false;
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

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      // If we were building an ordered list, flush it first
      if (listItems.length > 0 && listOrdered) flushList();
      flushParagraph();
      listOrdered = false;
      listItems.push(trimmed.slice(2));
      continue;
    }

    const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch) {
      // If we were building an unordered list, flush it first
      if (listItems.length > 0 && !listOrdered) flushList();
      flushParagraph();
      listOrdered = true;
      listItems.push(orderedMatch[1]);
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  return parts.join('');
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

function appendUserMessage(text: string, imageDataUrls?: string[]): void {
  if (chatEmptyState.parentNode) chatEmptyState.remove();
  const el = document.createElement('div');
  const hasText = Boolean(text.trim());
  const hasImages = imageDataUrls && imageDataUrls.length > 0;

  el.className = 'chat-msg chat-msg-user' + (!hasText && hasImages ? ' chat-msg-user-imgonly' : '');

  if (hasText) {
    el.textContent = text;
  }

  if (hasImages) {
    const imgContainer = document.createElement('div');
    imgContainer.className = 'chat-msg-images';
    for (const url of imageDataUrls) {
      const img = document.createElement('img');
      img.className = 'chat-msg-img';
      img.src = url;
      img.alt = 'Attached image';
      imgContainer.appendChild(img);
    }
    el.appendChild(imgContainer);
  }

  chatInner.appendChild(el);
  scheduleChatScrollToBottom(true);
}

function clearChatThread(): void {
  chatInner.innerHTML = '';
  chatInner.appendChild(chatEmptyState);
  updateLastAgentResponseText('');
}

function updateLastAgentResponseText(nextText: string): void {
  const trimmed = nextText.trim();
  lastAgentResponseText = trimmed;
  const hasResponse = Boolean(trimmed);
  chatCopyLastBtn.toggleAttribute('disabled', !hasResponse);
  chatCopyLastBtn.setAttribute('title', hasResponse ? 'Copy last agent response' : 'No agent response yet');
  chatCopyLastBtn.setAttribute('aria-label', hasResponse ? 'Copy last agent response' : 'No agent response yet');
}

async function copyTextToClipboard(text: string): Promise<boolean> {
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
    return true;
  } catch (err) {
    return false;
  }
}

function flashChatCopyFeedback(label: string): void {
  chatCopyLastBtn.classList.add('copied');
  chatCopyLastBtn.setAttribute('title', label);
  chatCopyLastBtn.setAttribute('aria-label', label);
  if (chatCopyFeedbackTimer !== null) window.clearTimeout(chatCopyFeedbackTimer);
  chatCopyFeedbackTimer = window.setTimeout(() => {
    chatCopyLastBtn.classList.remove('copied');
    chatCopyLastBtn.setAttribute('title', lastAgentResponseText ? 'Copy last agent response' : 'No agent response yet');
    chatCopyLastBtn.setAttribute('aria-label', lastAgentResponseText ? 'Copy last agent response' : 'No agent response yet');
    chatCopyFeedbackTimer = null;
  }, 1200);
}

async function copyLastAgentResponse(): Promise<void> {
  const text = lastAgentResponseText.trim();
  if (!text) return;

  const copied = await copyTextToClipboard(text);
  if (copied) {
    flashChatCopyFeedback('Copied');
    return;
  }

  getWorkspaceAPI()?.addLog('error', 'system', 'Failed to copy last agent response');
}

function createLiveRunCard(taskId: string, _provider: string, prompt?: string): void {
  createLiveRunCardInternal(taskId, _provider, chatInner, {
    renderMarkdown,
    updateLastAgentResponseText,
    scheduleChatScrollToBottom,
  }, prompt);
}

function appendToken(taskId: string, text: string): void {
  appendTokenInternal(taskId, text);
}

function appendThought(taskId: string, text: string): void {
  appendThoughtInternal(taskId, text);
}

function appendToolActivity(taskId: string, kind: 'call' | 'result', text: string): void {
  appendToolActivityInternal(taskId, kind, text);
}

function appendCodexItemProgress(taskId: string, progressData: string, item?: unknown): void {
  appendCodexItemProgressInternal(taskId, progressData, item as any);
}

function replaceWithResult(taskId: string, result: any, provider?: string): void {
  replaceWithResultInternal(taskId, result, provider);
}

function replaceWithError(taskId: string, error: string): void {
  replaceWithErrorInternal(taskId, error);
}

function appendMemoryEntry(entry: TaskMemoryEntry): void {
  if (chatEmptyState.parentNode) chatEmptyState.remove();

  if (entry.kind === 'user_prompt') {
    const el = document.createElement('div');
    el.className = 'chat-msg chat-msg-user';
    el.textContent = entry.text;
    chatInner.appendChild(el);
    return;
  }

  if (entry.kind === 'model_result') {
    updateLastAgentResponseText(entry.text);
    const el = document.createElement('div');
    el.className = 'chat-msg chat-msg-model chat-msg-done';
    el.innerHTML = `<div class="chat-msg-text chat-markdown">${renderMarkdown(entry.text)}</div>`;
    chatInner.appendChild(el);
    return;
  }
}

async function refreshTaskConversation(taskId: string | null): Promise<void> {
  if (!taskId) {
    renderedTaskMemoryKey = null;
    clearChatThread();
    return;
  }

  const existingCard = getLiveRunCard(taskId);
  if (existingCard?.root.isConnected) return;

  const modelApi = getModelAPI();
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

  // Render full conversation history in order
  const visible = memory.entries.filter(shouldShowMemoryEntry);
  for (const entry of visible) {
    appendMemoryEntry(entry);
  }
  scheduleChatScrollToBottom(true);
}

// ─── Chat Submission ───────────────────────────────────────────────────────

function getActiveTaskIdFromState(): string | null {
  const state = (window as any).__lastState;
  return state?.activeTaskId || null;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // Strip the "data:...;base64," prefix
      const base64 = dataUrl.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

function getImageMediaType(file: File): ImageMediaType {
  const type = file.type.toLowerCase();
  if (type === 'image/png') return 'image/png';
  if (type === 'image/gif') return 'image/gif';
  if (type === 'image/webp') return 'image/webp';
  return 'image/jpeg';
}

async function buildAttachments(): Promise<Array<{ type: 'image'; mediaType: ImageMediaType; data: string; name: string }>> {
  const imageFiles = attachedFiles.filter(f => f.type === 'image');
  if (imageFiles.length === 0) return [];

  const results: Array<{ type: 'image'; mediaType: ImageMediaType; data: string; name: string }> = [];
  for (const entry of imageFiles) {
    const data = await fileToBase64(entry.file);
    results.push({
      type: 'image',
      mediaType: getImageMediaType(entry.file),
      data,
      name: entry.file.name,
    });
  }
  return results;
}

async function submitChat(): Promise<void> {
  const prompt = chatInput.value.trim();
  const hasImages = attachedFiles.some(f => f.type === 'image');
  if (!prompt && !hasImages) { chatInput.focus(); return; }

  const modelApi = getModelAPI();
  if (!modelApi?.invoke) {
    appendUserMessage(prompt || '(image)');
    chatInput.value = '';
    clearAttachments();
    const disabledTaskId = `model-disabled-${chatCounter++}`;
    createLiveRunCard(disabledTaskId, 'system');
    replaceWithError(disabledTaskId, 'Model integration is not enabled in this v2 browser build.');
    getWorkspaceAPI()?.addLog('warn', 'system', 'Model integration is not enabled in this v2 browser build.');
    chatInput.focus();
    return;
  }

  // Capture attachments and preview URLs before clearing
  const pendingAttachments = await buildAttachments();
  const imagePreviewUrls = attachedFiles
    .filter(f => f.type === 'image' && f.previewUrl)
    .map(f => f.previewUrl!);

  chatCounter++;
  let taskId = getActiveTaskIdFromState();
  const owner = selectedOwner === 'auto' ? undefined : selectedOwner;

  if (!taskId) {
    const workspaceAPI = getWorkspaceAPI();
    if (!workspaceAPI) {
      replaceWithError(`model-disabled-${chatCounter}`, 'Command surface is not connected to the runtime API.');
      console.warn('[command] Command submit failed: getWorkspaceAPI() is unavailable.');
      chatInput.value = '';
      chatInput.focus();
      return;
    }
    const titleSource = prompt || 'Image attachment';
    const title = titleSource.length > 48 ? `${titleSource.slice(0, 48)}...` : titleSource;
    const createdTask = await workspaceAPI.createTask(title);
    taskId = createdTask.id;
  }

  chatInput.value = '';
  clearAttachments();
  chatStopBtn.hidden = false;

  let resolvedOwner: string = owner || '';
  if (!resolvedOwner) {
    try {
      resolvedOwner = modelApi.resolve ? await modelApi.resolve(prompt) : PRIMARY_PROVIDER_ID;
    } catch {
      resolvedOwner = PRIMARY_PROVIDER_ID;
    }
  }

  runningTaskId = taskId;
  taskStatusBar.start();
  createLiveRunCard(taskId, resolvedOwner, prompt || undefined);

  const invokeOptions = pendingAttachments.length > 0
    ? { attachments: pendingAttachments }
    : undefined;

  const effectivePrompt = prompt || (pendingAttachments.length > 0 ? 'Describe this image.' : '');

  try {
    const result = await modelApi.invoke(taskId, effectivePrompt, resolvedOwner, invokeOptions);
    replaceWithResult(taskId, result, result?.providerId || resolvedOwner);
  } catch (err: any) {
    replaceWithError(taskId, err.message || String(err));
  } finally {
    taskStatusBar.end();
    runningTaskId = null;
    chatStopBtn.hidden = true;
    chatInput.focus();
  }
}
chatStopBtn.addEventListener('click', () => {
  const modelApi = getModelAPI();
  if (runningTaskId && modelApi?.cancel) {
    taskStatusBar.end(true);
    void modelApi.cancel(runningTaskId);
  }
});
chatCopyLastBtn.addEventListener('click', () => {
  void copyLastAgentResponse();
});
chatZoomOutBtn.addEventListener('click', () => {
  adjustChatZoom(-CHAT_ZOOM_STEP);
});
chatZoomResetBtn.addEventListener('click', () => {
  resetChatZoom();
});
chatZoomInBtn.addEventListener('click', () => {
  adjustChatZoom(CHAT_ZOOM_STEP);
});
chatInput.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    void submitChat();
  }
});

// Paste images directly into the textarea
chatInput.addEventListener('paste', (e: ClipboardEvent) => {
  const items = e.clipboardData?.items;
  if (!items) return;

  for (const item of Array.from(items)) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) {
        const dt = new DataTransfer();
        dt.items.add(file);
        addFiles(dt.files, 'image');
      }
      return;
    }
  }
});

window.addEventListener('keydown', (event: KeyboardEvent) => {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
  if (event.key === '=' || event.key === '+') {
    event.preventDefault();
    adjustChatZoom(CHAT_ZOOM_STEP);
    return;
  }
  if (event.key === '-' || event.key === '_') {
    event.preventDefault();
    adjustChatZoom(-CHAT_ZOOM_STEP);
    return;
  }
  if (event.key === '0') {
    event.preventDefault();
    resetChatZoom();
  }
});

// ─── Chat History ─────────────────────────────────────────────────────────

function formatHistoryDate(timestamp: number): string {
  const d = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function openHistoryPopup(): void {
  const state = (window as any).__lastState;
  const tasks: any[] = state?.tasks || [];
  const activeId = state?.activeTaskId || null;

  historyList.innerHTML = '';

  if (tasks.length === 0) {
    historyList.innerHTML = '<div class="cc-history-empty">No conversations yet.</div>';
    historyOverlay.hidden = false;
    return;
  }

  // Sort newest first
  const sorted = [...tasks].sort((a, b) => b.updatedAt - a.updatedAt);

  for (const task of sorted) {
    const item = document.createElement('div');
    item.className = 'cc-history-item' + (task.id === activeId ? ' active' : '');
    item.innerHTML =
      `<span class="cc-history-item-title">${escapeHtml(task.title)}</span>` +
      `<span class="cc-history-item-date">${formatHistoryDate(task.updatedAt)}</span>`;
    item.addEventListener('click', () => {
      switchToTask(task.id);
      historyOverlay.hidden = true;
    });
    historyList.appendChild(item);
  }

  historyOverlay.hidden = false;
}

function closeHistoryPopup(): void {
  historyOverlay.hidden = true;
  chatInput.focus();
}

async function startNewChat(): Promise<void> {
  const workspaceAPI = getWorkspaceAPI();
  if (!workspaceAPI) return;

  historyOverlay.hidden = true;

  // Clear active task — will show empty state
  await workspaceAPI.setActiveTask(null);
  currentRenderedTaskId = null;
  renderedTaskMemoryKey = null;
  clearChatThread();
  chatInput.focus();
}

function switchToTask(taskId: string): void {
  const workspaceAPI = getWorkspaceAPI();
  if (!workspaceAPI) return;

  void workspaceAPI.setActiveTask(taskId);
  // renderState will pick up the change and call refreshTaskConversation
}

chatHistoryBtn.addEventListener('click', (e: MouseEvent) => {
  e.stopPropagation();
  if (!historyOverlay.hidden) {
    closeHistoryPopup();
  } else {
    openHistoryPopup();
  }
});
historyCloseBtn.addEventListener('click', closeHistoryPopup);
historyNewBtn.addEventListener('click', () => { void startNewChat(); });

// Close on outside click
document.addEventListener('click', (e: MouseEvent) => {
  if (historyOverlay.hidden) return;
  const target = e.target as Node;
  if (!historyOverlay.contains(target) && !chatHistoryBtn.contains(target)) {
    closeHistoryPopup();
  }
});

// Close on Escape
window.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape' && !historyOverlay.hidden) {
    e.preventDefault();
    closeHistoryPopup();
  }
});

// ─── Token Usage Display ──────────────────────────────────────────────────

function formatTokenCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function updateTokenUsageDisplay(state: any): void {
  const usage = state?.tokenUsage;
  if (!usage) return;
  tokenStatusLabel.textContent = `${formatTokenCount(usage.inputTokens)} in / ${formatTokenCount(usage.outputTokens)} out`;
}

// ─── Full State Render ─────────────────────────────────────────────────────

function renderState(state: any): void {
  (window as any).__lastState = state;
  const normalizedOwner = normalizeSelectedOwner(selectedOwner, state);
  if (normalizedOwner !== selectedOwner) {
    selectedOwner = normalizedOwner;
    persistSelectedOwner();
  } else {
    selectedOwner = normalizedOwner;
  }
  syncModelToggleState(state);
  const active = state.tasks.find((t: any) => t.id === state.activeTaskId);
  renderLogs(state.logs);

  if (state.executionSplit) {
    const ratio = state.executionSplit.ratio;
    splitLabel.textContent = `split ${Math.round(ratio * 100)}/${Math.round((1 - ratio) * 100)}`;
  }

  taskCount.textContent = `tasks: ${state.tasks.length}`;
  updateTokenUsageDisplay(state);

  const activeProviderId = active?.owner && active.owner !== 'user'
    ? active.owner
    : null;
  const activeProvider = activeProviderId ? state.providers?.[activeProviderId] : null;
  const selectedRuntime = selectedOwner !== 'auto'
    ? getProviderRuntime(state, selectedOwner)
    : null;

  targetLabel.textContent = `target ${getOwnerDisplayLabel(selectedOwner)}`;

  if (activeProviderId && activeProvider) {
    modelLabel.textContent = `active ${getOwnerDisplayLabel(activeProviderId)}`;
    if (activeProvider.sessionId) {
      sessionLabel.textContent = `session ${activeProvider.sessionId.slice(0, 12)}`;
    } else {
      sessionLabel.textContent = activeProvider.model || activeProvider.status || 'unavailable';
    }
  } else if (selectedOwner !== 'auto' && selectedRuntime) {
    modelLabel.textContent = `ready ${getOwnerDisplayLabel(selectedOwner)}`;
    sessionLabel.textContent = selectedRuntime.model || selectedRuntime.status || 'unavailable';
  } else {
    const availableProviders = SELECTABLE_OWNERS
      .filter((owner): owner is Exclude<SelectableOwner, 'auto'> => owner !== 'auto')
      .filter((owner) => canSelectOwner(state, owner));
    modelLabel.textContent = 'ready default';
    sessionLabel.textContent = availableProviders.length > 0
      ? availableProviders.map((owner) => getOwnerDisplayLabel(owner)).join(' / ')
      : 'no providers';
  }

  syncModelToggleState(state);

  const nextTaskId = state.activeTaskId || null;
  if (nextTaskId !== currentRenderedTaskId) {
    currentRenderedTaskId = nextTaskId;
    renderedTaskMemoryKey = null;
    void refreshTaskConversation(nextTaskId);
  } else if (!nextTaskId || !getLiveRunCard(nextTaskId)?.root.isConnected) {
    void refreshTaskConversation(nextTaskId);
  }
}

// ─── Live Updates ──────────────────────────────────────────────────────────

const commandWindowAPI = getWorkspaceAPI();
const modelApi = getModelAPI();
if (commandWindowAPI && modelApi?.onProgress) {
  modelApi.onProgress((progress: any) => {
    const card = progress?.taskId ? getLiveRunCard(progress.taskId) : null;
    if (!card?.root.isConnected) return;
    if (progress.type === 'token') {
      appendToken(progress.taskId, String(progress.data || ''));
      return;
    }
    if (progress.type === 'item') {
      appendCodexItemProgress(progress.taskId, String(progress.data || ''), progress.codexItem as any);
      return;
    }
    if (progress.type === 'status') {
      const text = String(progress.data || '');
      taskStatusBar.push(text);
      if (text.startsWith('tool-start:') || text.startsWith('tool-done:')) {
        appendToolStatusInternal(progress.taskId, text);
      } else if (text.startsWith('Calling ')) {
        appendToolActivity(progress.taskId, 'call', text.replace(/^Calling\s+/, '').replace(/\.\.\.$/, ''));
      } else if (text.startsWith('Tool result: ')) {
        appendToolActivity(progress.taskId, 'result', text.slice('Tool result: '.length));
      } else if (text && !/^Turn completed/.test(text)) {
        appendThought(progress.taskId, text);
      }
    }
  });
}

// ─── File Attachments ─────────────────────────────────────────────────────

interface AttachedFile {
  file: File;
  type: 'document' | 'image';
  previewUrl?: string;
}

const attachedFiles: AttachedFile[] = [];

function syncAttachmentPreview(): void {
  if (attachedFiles.length === 0) {
    attachPreview.hidden = true;
    attachPreviewList.innerHTML = '';
    return;
  }

  attachPreview.hidden = false;
  attachPreviewList.innerHTML = '';

  for (let i = 0; i < attachedFiles.length; i++) {
    const entry = attachedFiles[i];
    const item = document.createElement('div');
    item.className = 'cc-attach-preview-item';

    if (entry.type === 'image' && entry.previewUrl) {
      item.innerHTML =
        `<img src="${entry.previewUrl}" alt="${escapeHtml(entry.file.name)}">` +
        `<span class="cc-preview-name">${escapeHtml(entry.file.name)}</span>` +
        `<button class="cc-preview-remove" data-index="${i}" title="Remove" aria-label="Remove ${escapeHtml(entry.file.name)}">&times;</button>`;
    } else {
      item.innerHTML =
        `<div class="cc-attach-preview-doc">` +
        `<svg viewBox="0 0 16 16"><path d="M9 1.5H4.5a2 2 0 00-2 2v9a2 2 0 002 2h7a2 2 0 002-2V6L9 1.5z" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 1.5V6h4.5" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>` +
        `<span class="cc-preview-doc-name">${escapeHtml(entry.file.name)}</span>` +
        `</div>` +
        `<button class="cc-preview-remove" data-index="${i}" title="Remove" aria-label="Remove ${escapeHtml(entry.file.name)}">&times;</button>`;
    }

    attachPreviewList.appendChild(item);
  }
}

function addFiles(files: FileList, type: 'document' | 'image'): void {
  for (const file of Array.from(files)) {
    const entry: AttachedFile = { file, type };
    if (type === 'image') {
      entry.previewUrl = URL.createObjectURL(file);
    }
    attachedFiles.push(entry);
  }
  syncAttachmentPreview();
}

function removeAttachment(index: number): void {
  const removed = attachedFiles.splice(index, 1);
  if (removed[0]?.previewUrl) {
    URL.revokeObjectURL(removed[0].previewUrl);
  }
  syncAttachmentPreview();
}

function clearAttachments(): void {
  for (const entry of attachedFiles) {
    if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
  }
  attachedFiles.length = 0;
  syncAttachmentPreview();
}

attachDocBtn.addEventListener('click', () => {
  docFileInput.click();
});

attachImgBtn.addEventListener('click', () => {
  imgFileInput.click();
});

docFileInput.addEventListener('change', () => {
  if (docFileInput.files?.length) {
    addFiles(docFileInput.files, 'document');
    docFileInput.value = '';
  }
});

imgFileInput.addEventListener('change', () => {
  if (imgFileInput.files?.length) {
    addFiles(imgFileInput.files, 'image');
    imgFileInput.value = '';
  }
});

attachPreviewList.addEventListener('click', (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  const removeBtn = target.closest<HTMLButtonElement>('.cc-preview-remove');
  if (!removeBtn) return;
  const idx = parseInt(removeBtn.dataset.index || '', 10);
  if (!isNaN(idx)) removeAttachment(idx);
});

// ─── Init ──────────────────────────────────────────────────────────────────

setLogsOpen(false);
initializeChatZoom();
initializeModelToggle();

if (!commandWindowAPI) {
  console.error('[command] workspaceAPI is not available; command controls are disabled.');
} else {
  commandWindowAPI.onStateUpdate((state: any) => renderState(state));
  commandWindowAPI.getState().then((state: any) => {
    renderState(state);
    commandWindowAPI.addLog('info', 'system', 'Command Center initialized');
  }).catch((error: unknown) => {
    console.error('[command] Failed to initialize command renderer:', error);
  });
}
