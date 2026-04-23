import { formatTime, escapeHtml } from '../shared/utils.js';
import {
  PRIMARY_PROVIDER_ID,
  InvocationAttachment,
  ImageInvocationAttachment,
  type TaskMemoryEntry,
} from '../../shared/types/model.js';
import type { DocumentImportRequest, DocumentInvocationAttachment } from '../../shared/types/attachments.js';
import {
  appendCodexItemProgress as appendCodexItemProgressInternal,
  appendToolActivity as appendToolActivityInternal,
  appendToolStatus as appendToolStatusInternal,
  appendToken as appendTokenInternal,
  createLiveRunCard as createLiveRunCardInternal,
  getLiveRunCard,
  markCancelling as markCancellingInternal,
  replaceWithError as replaceWithErrorInternal,
  replaceWithResult as replaceWithResultInternal,
} from './live-run.js';
import { attachmentIconSvg, getAttachmentFileKind } from './attachmentIcons.js';
import { renderMarkdown } from './markdown.js';
import {
  optimizeImageForCodex,
  extensionForMediaType,
  normalizeMediaType,
  type OptimizedImage,
} from './imageOptimization.js';

const getWorkspaceAPI = () => (window as any).workspaceAPI as WorkspaceAPI | null;
const getModelAPI = () => getWorkspaceAPI()?.model ?? null;
const getAttachmentAPI = () => getWorkspaceAPI()?.attachments ?? null;

// ─── DOM ────────────────────────────────────────────────────────────────────

const taskSummary = document.getElementById('taskSummary')!;
const modelLabel = document.getElementById('modelLabel')!;
const taskCount = document.getElementById('taskCount')!;
const commandShell = document.querySelector('.cc-shell') as HTMLElement;
const commandMain = document.querySelector('.cc-main') as HTMLElement;
const commandBrowserPane = document.getElementById('commandBrowserPane') as HTMLElement | null;
const logStream = document.getElementById('logStream')!;
const logsCopyBtn = document.getElementById('logsCopyBtn')!;
const logsClearBtn = document.getElementById('logsClearBtn')!;
const logsBtn = document.getElementById('logsBtn') as HTMLButtonElement;
const logsOverlay = document.getElementById('logsOverlay') as HTMLDivElement;
const logsCloseBtn = document.getElementById('logsCloseBtn')!;

// Terminal overlay
const commandTerminalBtn = document.getElementById('commandTerminalBtn') as HTMLButtonElement | null;
const terminalOverlay = document.getElementById('terminalOverlay') as HTMLDivElement | null;
const commandTerminalSurface = document.getElementById('commandTerminalSurface') as HTMLDivElement | null;
const commandTerminalStatus = document.getElementById('commandTerminalStatus') as HTMLSpanElement | null;
const commandTerminalMeta = document.getElementById('commandTerminalMeta') as HTMLSpanElement | null;
const commandTerminalCloseBtn = document.getElementById('commandTerminalCloseBtn') as HTMLButtonElement | null;
const commandTerminalRestartBtn = document.getElementById('commandTerminalRestartBtn') as HTMLButtonElement | null;

// Chat
const chatThread = document.getElementById('chatThread')!;
const chatInner = document.getElementById('chatInner')!;
const chatEmptyState = document.getElementById('chatEmptyState')!;
const chatScrollTopBtn = document.getElementById('chatScrollTopBtn') as HTMLButtonElement;
const chatScrollBottomBtn = document.getElementById('chatScrollBottomBtn') as HTMLButtonElement;
const chatInput = document.getElementById('chatInput') as HTMLTextAreaElement;
const visualMaskApplyBtn = document.getElementById('visualMaskApplyBtn') as HTMLButtonElement;
const visualMaskClearBtn = document.getElementById('visualMaskClearBtn') as HTMLButtonElement;
const visualMaskStatus = document.getElementById('visualMaskStatus') as HTMLSpanElement;
const chatNewBtn = document.getElementById('chatNewBtn') as HTMLButtonElement;
const chatCopyLastBtn = document.getElementById('chatCopyLastBtn') as HTMLButtonElement;
const modelBtnPrimary = document.getElementById('modelBtnPrimary') as HTMLButtonElement;
const chatZoomOutBtn = document.getElementById('chatZoomOutBtn') as HTMLButtonElement;
const chatZoomResetBtn = document.getElementById('chatZoomResetBtn') as HTMLButtonElement;
const chatZoomInBtn = document.getElementById('chatZoomInBtn') as HTMLButtonElement;
const commandBrowserSurfaceArea = document.getElementById('commandBrowserSurfaceArea') as HTMLDivElement;
const commandBrowserBackBtn = document.getElementById('commandBrowserBackBtn') as HTMLButtonElement;
const commandBrowserForwardBtn = document.getElementById('commandBrowserForwardBtn') as HTMLButtonElement;
const commandBrowserReloadBtn = document.getElementById('commandBrowserReloadBtn') as HTMLButtonElement;
const commandBrowserTabList = document.getElementById('commandBrowserTabList') as HTMLDivElement;
const commandBrowserTabNewBtn = document.getElementById('commandBrowserTabNewBtn') as HTMLButtonElement;
const commandBrowserAddressInput = document.getElementById('commandBrowserAddressInput') as HTMLInputElement;
const commandBrowserStatus = document.getElementById('commandBrowserStatus') as HTMLDivElement;
const commandBrowserAttachBtn = document.getElementById('commandBrowserAttachBtn') as HTMLButtonElement;

// Agent tabs
const agentTabsShell = document.getElementById('agentTabsShell') as HTMLDivElement;
const agentSidebarHeaderToggleBtn = document.getElementById('agentSidebarHeaderToggleBtn') as HTMLButtonElement;
const agentTabs = document.getElementById('agentTabs') as HTMLDivElement;
const agentTabsList = document.getElementById('agentTabsList') as HTMLDivElement;
const agentTabNewBtn = document.getElementById('agentTabNewBtn') as HTMLButtonElement;
const agentSidebarFooter = document.getElementById('agentSidebarFooter') as HTMLDivElement;
const agentSidebarCollapseMoreBtn = document.getElementById('agentSidebarCollapseMoreBtn') as HTMLButtonElement;
const agentSidebarFooterCount = document.getElementById('agentSidebarFooterCount') as HTMLSpanElement;

// History
const chatHistoryBtn = document.getElementById('chatHistoryBtn')!;
const historyOverlay = document.getElementById('historyOverlay')!;
const historyList = document.getElementById('historyList')!;
const historyNewBtn = document.getElementById('historyNewBtn')!;
const historyCloseBtn = document.getElementById('historyCloseBtn')!;
const NEW_CHAT_TITLE = 'New Chat';

// Token usage — displayed in status bar
const tokenStatusLabel = document.getElementById('tokenStatusLabel')!;
const tokenUsageResetBtn = document.getElementById('tokenUsageResetBtn') as HTMLButtonElement;

// Stop
const chatStopBtn = document.getElementById('chatStopBtn') as HTMLButtonElement;

// Attachments
const attachDocBtn = document.getElementById('attachDocBtn')!;
const attachImgBtn = document.getElementById('attachImgBtn')!;
const attachPreview = document.getElementById('attachPreview') as HTMLDivElement;
const attachPreviewList = document.getElementById('attachPreviewList') as HTMLDivElement;
const docFileInput = document.getElementById('docFileInput') as HTMLInputElement;
const imgFileInput = document.getElementById('imgFileInput') as HTMLInputElement;


// ─── State ──────────────────────────────────────────────────────────────────

let activeTurnWrapper: HTMLElement | null = null;

type SelectableOwner = typeof PRIMARY_PROVIDER_ID;
type ExplicitSelectableOwner = SelectableOwner;
type ProviderRuntimeView = {
  status?: string;
  model?: string;
  sessionId?: string;
  errorDetail?: string | null;
};

const SELECTABLE_OWNERS: SelectableOwner[] = [PRIMARY_PROVIDER_ID];
const SELECTED_OWNER_STORAGE_KEY = 'command-center-selected-owner';
const AGENT_SIDEBAR_COLLAPSED_STORAGE_KEY = 'command-center-agent-sidebar-collapsed';
const OWNER_LABELS: Record<SelectableOwner, string> = {
  [PRIMARY_PROVIDER_ID]: 'Codex',
};

function getOwnerDisplayLabel(owner: SelectableOwner): string {
  return OWNER_LABELS[owner].toLowerCase();
}

let selectedOwner: SelectableOwner = PRIMARY_PROVIDER_ID;
let chatCounter = 0;
let renderedTaskMemoryKey: string | null = null;
let currentRenderedTaskId: string | null = null;
let chatAutoPinned = true;
let chatScrollRaf: number | null = null;
let chatScrollFramesRemaining = 0;
let suppressChatScrollEvent = false;
let suppressNextChatScrollActivation = false;
let chatScrollControlsActivated = false;
let chatScrollControlsDimmed = false;
let chatScrollControlsIdleTimer: number | null = null;
let lastAgentResponseText = '';
let chatCopyFeedbackTimer: number | null = null;
let chatZoom = 1;
let visualMaskStatusTimer: number | null = null;
let agentSidebarCollapsed = true;
const runningTaskIds = new Set<string>();
let completedExpanded = false;
/** Keys of date buckets (e.g. 'today', 'previous-7', 'month-2025-8') the user has opened. */
const expandedBuckets = new Set<string>();
let lastTaskListSignature = '';
let lastAgentTabsRenderKey = '';
let browserBoundsTimer: number | null = null;
let browserBoundsObserver: ResizeObserver | null = null;
let lastCommandBrowserState: BrowserState | null = null;
const pendingLiveProgressByTask = new Map<string, Array<any>>();
let lastStateChromeKey = '';

const CHAT_ZOOM_STORAGE_KEY = 'command-center-chat-zoom';
const CHAT_ZOOM_DEFAULT = 1;
const CHAT_ZOOM_MIN = 0.8;
const CHAT_ZOOM_MAX = 1.6;
const CHAT_ZOOM_STEP = 0.1;

function isSelectableOwner(value: string): value is SelectableOwner {
  return SELECTABLE_OWNERS.includes(value as SelectableOwner);
}

function isExplicitSelectableOwner(value: string): value is ExplicitSelectableOwner {
  return value === PRIMARY_PROVIDER_ID;
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
  return PRIMARY_PROVIDER_ID;
}

function persistSelectedOwner(): void {
  try {
    window.localStorage.setItem(SELECTED_OWNER_STORAGE_KEY, selectedOwner);
  } catch {
    // Ignore storage failures in restricted renderer environments.
  }
}

function getStoredAgentSidebarCollapsed(): boolean {
  try {
    const stored = window.localStorage.getItem(AGENT_SIDEBAR_COLLAPSED_STORAGE_KEY);
    if (stored === 'false') return false;
    if (stored === 'true') return true;
  } catch {
    // Ignore storage failures in restricted renderer environments.
  }
  return true;
}

function persistAgentSidebarCollapsed(): void {
  try {
    window.localStorage.setItem(AGENT_SIDEBAR_COLLAPSED_STORAGE_KEY, String(agentSidebarCollapsed));
  } catch {
    // Ignore storage failures in restricted renderer environments.
  }
}

function getFallbackSelectableOwner(state: any, preferredOwner: SelectableOwner = PRIMARY_PROVIDER_ID): SelectableOwner {
  if (canSelectOwner(state, preferredOwner)) return preferredOwner;
  return SELECTABLE_OWNERS.find((owner) => canSelectOwner(state, owner)) ?? preferredOwner;
}

function normalizeSelectedOwner(nextOwner: SelectableOwner, state: any): SelectableOwner {
  return canSelectOwner(state, nextOwner) ? nextOwner : getFallbackSelectableOwner(state, nextOwner);
}

function getLastUsedOwnerForTask(task: any | null, _state: any): SelectableOwner | null {
  if (task?.owner && isExplicitSelectableOwner(task.owner)) return task.owner;
  return null;
}

function syncSelectedOwnerForActiveTask(state: any): void {
  const activeTaskId: string | null = state?.activeTaskId ?? null;
  const activeTask = activeTaskId
    ? state?.tasks?.find((task: any) => task.id === activeTaskId) ?? null
    : null;
  const taskScopedOwner = getLastUsedOwnerForTask(activeTask, state);

  if (taskScopedOwner) {
    if (selectedOwner !== taskScopedOwner) {
      selectedOwner = taskScopedOwner;
      persistSelectedOwner();
    }
    return;
  }

  const normalizedOwner = normalizeSelectedOwner(selectedOwner, state);
  if (normalizedOwner !== selectedOwner) {
    selectedOwner = normalizedOwner;
    persistSelectedOwner();
    return;
  }
  selectedOwner = normalizedOwner;
}

function setSelectedOwner(nextOwner: SelectableOwner, state: any = (window as any).__lastState): void {
  selectedOwner = normalizeSelectedOwner(nextOwner, state);
  persistSelectedOwner();
  syncModelToggleState(state);
  updateTokenUsageDisplay(state, selectedOwner);
}

function getModelBtn(owner: ExplicitSelectableOwner): HTMLButtonElement {
  void owner;
  return modelBtnPrimary;
}

function isActiveTabRunning(): boolean {
  const activeId = getActiveTaskIdFromState();
  return activeId !== null && runningTaskIds.has(activeId);
}

function syncModelToggleState(state: any = (window as any).__lastState): void {
  const busy = isActiveTabRunning();
  for (const owner of SELECTABLE_OWNERS as ExplicitSelectableOwner[]) {
    const btn = getModelBtn(owner);
    const runtime = getProviderRuntime(state, owner);
    const status = runtime?.status ?? 'unavailable';
    const available = status !== 'unavailable' && status !== 'error';
    const active = selectedOwner === owner;

    btn.classList.toggle('cc-model-btn-active', active);
    btn.classList.toggle('cc-model-btn-unavailable', !available && !active);
    btn.disabled = busy || (active && !available);

    const details = [OWNER_LABELS[owner], runtime?.model || status, runtime?.errorDetail || '']
      .filter(Boolean);
    btn.title = details.join(' • ');
  }
}

function initializeModelToggle(): void {
  selectedOwner = getStoredSelectedOwner();

  for (const owner of SELECTABLE_OWNERS as ExplicitSelectableOwner[]) {
    getModelBtn(owner).addEventListener('click', () => {
      if (isActiveTabRunning()) return;
      setSelectedOwner(owner, (window as any).__lastState);
    });
  }

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

function reportCommandBrowserBounds(): void {
  if (!commandWindowAPI) return;
  if (lastCommandBrowserState?.hostWindowRole !== 'command') return;
  if (browserBoundsTimer !== null) window.clearTimeout(browserBoundsTimer);
  browserBoundsTimer = window.setTimeout(() => {
    const rect = commandBrowserSurfaceArea.getBoundingClientRect();
    commandWindowAPI.browser.reportBounds({
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
    browserBoundsTimer = null;
  }, 40);
}

function renderCommandBrowserState(state: BrowserState): void {
  lastCommandBrowserState = state;
  const attached = state.hostWindowRole === 'command';
  commandMain.classList.toggle('browser-host-command', attached);
  if (commandBrowserPane) {
    commandBrowserPane.hidden = !attached;
  }
  commandBrowserAttachBtn.disabled = state.hostWindowRole === null;
  commandBrowserAttachBtn.textContent = attached ? 'Detach' : 'Attach';
  commandBrowserAttachBtn.title = attached ? 'Move browser back to execution window' : 'Move browser to command window';
  commandBrowserAttachBtn.setAttribute('aria-label', commandBrowserAttachBtn.title);
  renderCommandBrowserTabs(
    state.tabs,
    state.activeTabId,
    state.splitLeftTabId,
    state.splitRightTabId,
  );
  const nav = state.navigation;
  if (document.activeElement !== commandBrowserAddressInput) {
    commandBrowserAddressInput.value = nav.url || '';
  }
  commandBrowserBackBtn.disabled = !nav.canGoBack;
  commandBrowserForwardBtn.disabled = !nav.canGoForward;
  commandBrowserStatus.textContent = nav.isLoading ? 'Loading...' : (nav.title || 'Ready');
  if (attached) {
    reportCommandBrowserBounds();
  }
}

function renderCommandBrowserTabs(
  tabs: TabInfo[],
  activeTabId: string,
  splitLeftTabId: string | null,
  splitRightTabId: string | null,
): void {
  commandBrowserTabList.innerHTML = tabs.map((tab) => {
    const title = tab.navigation?.title || tab.navigation?.url || 'New Tab';
    const isActive = tab.id === activeTabId;
    const isSplitSide = tab.id === splitLeftTabId || tab.id === splitRightTabId;
    const isSplitActiveSide = isActive && isSplitSide;
    const faviconHtml = tab.navigation?.favicon
      ? `<img class="cc-browser-tab-favicon" src="${escapeHtml(tab.navigation.favicon)}" alt="">`
      : '';
    const classes = [
      'cc-browser-tab',
      isActive ? 'active' : '',
      isSplitSide ? 'split-side' : '',
      isSplitActiveSide ? 'split-active-side' : '',
    ].filter(Boolean).join(' ');

    return `<div class="${classes}" data-command-browser-tab-id="${tab.id}" title="${escapeHtml(title)}">
      ${faviconHtml}
      <span class="cc-browser-tab-title">${escapeHtml(title)}</span>
      <button class="cc-browser-tab-close" data-command-browser-close-tab="${tab.id}" type="button" aria-label="Close tab">×</button>
    </div>`;
  }).join('');
}

function initializeCommandBrowserPane(): void {
  commandBrowserBackBtn.addEventListener('click', () => {
    commandWindowAPI?.actions.submit({ target: 'browser', kind: 'browser.back', payload: {} });
  });
  commandBrowserForwardBtn.addEventListener('click', () => {
    commandWindowAPI?.actions.submit({ target: 'browser', kind: 'browser.forward', payload: {} });
  });
  commandBrowserReloadBtn.addEventListener('click', () => {
    commandWindowAPI?.actions.submit({ target: 'browser', kind: 'browser.reload', payload: {} });
  });
  commandBrowserTabNewBtn.addEventListener('click', () => {
    commandWindowAPI?.actions.submit({ target: 'browser', kind: 'browser.create-tab', payload: {} });
  });
  commandBrowserTabList.addEventListener('click', (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const closeTabId = target.closest<HTMLElement>('[data-command-browser-close-tab]')?.dataset.commandBrowserCloseTab;
    if (closeTabId) {
      e.stopPropagation();
      commandWindowAPI?.actions.submit({ target: 'browser', kind: 'browser.close-tab', payload: { tabId: closeTabId } });
      return;
    }

    const tabId = target.closest<HTMLElement>('[data-command-browser-tab-id]')?.dataset.commandBrowserTabId;
    if (!tabId) return;
    commandWindowAPI?.actions.submit({ target: 'browser', kind: 'browser.activate-tab', payload: { tabId } });
  });
  commandBrowserAttachBtn.addEventListener('click', () => {
    const targetRole = lastCommandBrowserState?.hostWindowRole === 'command' ? 'execution' : 'command';
    void commandWindowAPI?.browser.attachSurface(targetRole);
  });
  commandBrowserAddressInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    const url = commandBrowserAddressInput.value.trim();
    if (!url) return;
    commandWindowAPI?.actions.submit({ target: 'browser', kind: 'browser.navigate', payload: { url } });
    commandBrowserAddressInput.blur();
  });
  commandBrowserAddressInput.addEventListener('focus', () => {
    requestAnimationFrame(() => commandBrowserAddressInput.select());
  });
  window.addEventListener('resize', reportCommandBrowserBounds);
  if (typeof ResizeObserver !== 'undefined') {
    browserBoundsObserver = new ResizeObserver(() => reportCommandBrowserBounds());
    browserBoundsObserver.observe(commandBrowserSurfaceArea);
  }
}

function setVisualMaskStatus(message: string, tone: 'neutral' | 'success' | 'error' = 'neutral'): void {
  visualMaskStatus.textContent = message;
  visualMaskStatus.classList.remove('is-success', 'is-error');
  if (tone === 'success') visualMaskStatus.classList.add('is-success');
  if (tone === 'error') visualMaskStatus.classList.add('is-error');
  if (visualMaskStatusTimer !== null) window.clearTimeout(visualMaskStatusTimer);
  if (!message) return;
  visualMaskStatusTimer = window.setTimeout(() => {
    visualMaskStatus.textContent = '';
    visualMaskStatus.classList.remove('is-success', 'is-error');
    visualMaskStatusTimer = null;
  }, 2400);
}

function setVisualMaskControlsDisabled(disabled: boolean): void {
  visualMaskApplyBtn.disabled = disabled;
  visualMaskClearBtn.disabled = disabled;
}

function showVisualMaskHint(): void {
  setVisualMaskStatus('Right-click page element -> Blur This Element');
  if (!commandWindowAPI) return;
  void commandWindowAPI.addLog('info', 'browser', 'To blur something, right-click the page element in the browser and choose "Blur This Element".');
}

async function clearVisualMasksFromComposer(): Promise<void> {
  if (!commandWindowAPI) return;

  setVisualMaskControlsDisabled(true);
  setVisualMaskStatus('Clearing…');
  try {
    const record = await commandWindowAPI.actions.submit({
      target: 'browser',
      kind: 'browser.clear-visual-masks',
      payload: { all: true },
    });
    const clearedCount = Number((record.resultData as any)?.clearedCount ?? 0);
    setVisualMaskStatus(clearedCount > 0 ? `Cleared ${clearedCount}` : 'Nothing to clear', clearedCount > 0 ? 'success' : 'neutral');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setVisualMaskStatus('Clear failed', 'error');
    void commandWindowAPI.addLog('error', 'browser', `Failed to clear visual masks: ${message}`);
  } finally {
    setVisualMaskControlsDisabled(false);
  }
}

// ─── Log Rendering ─────────────────────────────────────────────────────────

let lastLogCount = 0;
let logsCopyFeedbackTimer: number | null = null;
let logsOpen = false;
let lastLogsSignature = '';

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
  const nextSignature = logs.length > 0
    ? `${logs.length}:${logs[0]?.id || ''}:${logs[logs.length - 1]?.id || ''}`
    : '0';
  if (nextSignature === lastLogsSignature) return;
  if (logs.length < lastLogCount) {
    logStream.innerHTML = '';
    lastLogCount = 0;
  }
  const newLogs = logs.slice(lastLogCount);
  for (const log of newLogs) {
    const el = document.createElement('div');
    el.className = `log-entry ${log.level}`;
    el.innerHTML = `<span class="log-time">${formatTime(log.timestamp)}</span><span class="log-source" data-source="${escapeHtml(log.source)}">[${escapeHtml(log.source)}]</span><span class="log-message">${escapeHtml(log.message)}</span>`;
    logStream.appendChild(el);
  }
  lastLogCount = logs.length;
  lastLogsSignature = nextSignature;
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

// ─── Terminal Overlay ─────────────────────────────────────────────────────

declare const Terminal: any;
declare const FitAddon: any;

let commandTerm: any = null;
let commandTermFitAddon: any = null;
let commandTermInitialized = false;
let commandTermOverlayOpen = false;
let commandTermResizeObserver: ResizeObserver | null = null;
let commandTermFitTimer: number | null = null;
let commandTermScrollbackLoaded = false;

function fitCommandTerminal(): void {
  if (!commandTerm || !commandTermFitAddon) return;
  try {
    commandTermFitAddon.fit();
    const dims = { cols: commandTerm.cols, rows: commandTerm.rows };
    if (dims.cols > 0 && dims.rows > 0) {
      void getWorkspaceAPI()?.terminal.resize(dims.cols, dims.rows);
    }
  } catch {
    // xterm resize errors are non-fatal and can recur on overlay close.
  }
}

function scheduleCommandTerminalFit(): void {
  if (commandTermFitTimer !== null) window.clearTimeout(commandTermFitTimer);
  commandTermFitTimer = window.setTimeout(() => {
    fitCommandTerminal();
    commandTermFitTimer = null;
  }, 32);
}

function updateCommandTerminalMeta(session: { status?: string; cwd?: string; pid?: number | null } | null): void {
  if (!session) return;
  const statusMap: Record<string, string> = {
    running: 'Running', exited: 'Exited', error: 'Error', starting: 'Starting',
  };
  if (commandTerminalStatus) {
    commandTerminalStatus.textContent = statusMap[session.status || ''] || session.status || '';
  }
  if (commandTerminalMeta) {
    const bits: string[] = [];
    if (session.pid) bits.push(`pid ${session.pid}`);
    if (session.cwd) bits.push(session.cwd);
    commandTerminalMeta.textContent = bits.join(' | ');
  }
}

async function ensureCommandTerminalInitialized(): Promise<void> {
  if (commandTermInitialized) return;
  if (!commandTerminalSurface) return;
  if (typeof Terminal === 'undefined' || typeof FitAddon === 'undefined') {
    console.error('[command] xterm vendor scripts not loaded');
    return;
  }

  commandTerm = new Terminal({
    theme: {
      background: '#000000', foreground: '#ededed', cursor: '#ffffff',
      cursorAccent: '#000000', selectionBackground: 'rgba(255,255,255,0.12)',
      selectionForeground: '#ffffff',
      black: '#000000', red: '#ee4444', green: '#00d47b', yellow: '#ff9500',
      blue: '#3b82f6', magenta: '#a78bfa', cyan: '#22d3ee', white: '#ededed',
      brightBlack: '#555555', brightRed: '#ff6b6b', brightGreen: '#34d399',
      brightYellow: '#fbbf24', brightBlue: '#60a5fa', brightMagenta: '#c4b5fd',
      brightCyan: '#67e8f9', brightWhite: '#ffffff',
    },
    fontFamily: "'Geist Mono', 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
    fontSize: 13, lineHeight: 1.35, cursorBlink: true, cursorStyle: 'bar',
    allowTransparency: false, scrollback: 50000,
  });
  commandTermFitAddon = new FitAddon.FitAddon();
  commandTerm.loadAddon(commandTermFitAddon);
  commandTerm.open(commandTerminalSurface);

  const api = getWorkspaceAPI();
  commandTerm.onData((data: string) => { void api?.terminal.write(data); });
  api?.terminal.onOutput((data: string) => { commandTerm?.write(data); });
  api?.terminal.onStatus((session: any) => updateCommandTerminalMeta(session));
  api?.terminal.onExit((code: number) => {
    if (commandTerminalStatus) commandTerminalStatus.textContent = `Exited (${code})`;
  });

  if (typeof ResizeObserver !== 'undefined' && commandTerminalSurface) {
    commandTermResizeObserver = new ResizeObserver(() => scheduleCommandTerminalFit());
    commandTermResizeObserver.observe(commandTerminalSurface);
  }

  commandTermInitialized = true;

  requestAnimationFrame(() => fitCommandTerminal());

  try {
    const existing = await api?.terminal.getSession();
    if (existing && existing.status === 'running') {
      updateCommandTerminalMeta(existing);
    } else {
      const started = await api?.terminal.startSession(commandTerm.cols, commandTerm.rows);
      if (started) updateCommandTerminalMeta(started);
    }
  } catch (err) {
    console.warn('[command] terminal session bootstrap failed:', err);
  }

  if (!commandTermScrollbackLoaded) {
    try {
      const capture = await api?.terminal.captureScrollback();
      if (typeof capture === 'string' && capture.length > 0) {
        commandTerm.write(capture);
      }
    } catch {
      // Scrollback capture is best-effort; empty terminal is still usable.
    }
    commandTermScrollbackLoaded = true;
  }
}

function setCommandTerminalOpen(open: boolean): void {
  commandTermOverlayOpen = open;
  if (!terminalOverlay || !commandTerminalBtn) return;
  terminalOverlay.hidden = !open;
  commandTerminalBtn.classList.toggle('active', open);
  commandTerminalBtn.setAttribute('aria-expanded', String(open));
  commandTerminalBtn.setAttribute('title', open ? 'Hide terminal' : 'Show terminal');
  commandTerminalBtn.setAttribute('aria-label', open ? 'Hide terminal' : 'Show terminal');
  if (open) {
    void ensureCommandTerminalInitialized().then(() => {
      requestAnimationFrame(() => {
        fitCommandTerminal();
        commandTerm?.focus();
      });
    });
  }
}

commandTerminalBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  setCommandTerminalOpen(!commandTermOverlayOpen);
});

commandTerminalCloseBtn?.addEventListener('click', () => setCommandTerminalOpen(false));

commandTerminalRestartBtn?.addEventListener('click', async () => {
  if (!commandTerminalRestartBtn) return;
  commandTerminalRestartBtn.disabled = true;
  try {
    await getWorkspaceAPI()?.actions.submit({
      target: 'terminal', kind: 'terminal.restart', payload: {},
    });
    commandTerm?.clear();
  } finally {
    commandTerminalRestartBtn.disabled = false;
  }
});

window.addEventListener('resize', () => {
  if (commandTermOverlayOpen) scheduleCommandTerminalFit();
});

// ─── Chat Scroll ───────────────────────────────────────────────────────────

function isChatNearBottom(threshold = 56): boolean {
  const distanceFromBottom = chatThread.scrollHeight - (chatThread.scrollTop + chatThread.clientHeight);
  return distanceFromBottom <= threshold;
}

function isChatNearTop(threshold = 56): boolean {
  return chatThread.scrollTop <= threshold;
}

function scheduleChatScrollControlsIdle(): void {
  if (chatScrollControlsIdleTimer !== null) window.clearTimeout(chatScrollControlsIdleTimer);
  chatScrollControlsDimmed = false;
  chatThread.classList.remove('cc-chat-scroll-idle');
  chatScrollControlsIdleTimer = window.setTimeout(() => {
    chatScrollControlsDimmed = true;
    chatThread.classList.add('cc-chat-scroll-idle');
  }, 900);
}

function activateChatScrollControls(): void {
  chatScrollControlsActivated = true;
  scheduleChatScrollControlsIdle();
  updateChatScrollControls();
}

function updateChatScrollControls(): void {
  const maxScrollTop = Math.max(0, chatThread.scrollHeight - chatThread.clientHeight);
  const hasOverflow = maxScrollTop > 8;
  if (!hasOverflow || !chatScrollControlsActivated) {
    chatScrollTopBtn.hidden = true;
    chatScrollBottomBtn.hidden = true;
    chatThread.classList.remove('cc-chat-scroll-idle');
    return;
  }

  const nearTop = isChatNearTop();
  const nearBottom = isChatNearBottom();

  if (nearTop) {
    chatScrollTopBtn.hidden = true;
    chatScrollBottomBtn.hidden = false;
    return;
  }

  if (nearBottom) {
    chatScrollTopBtn.hidden = false;
    chatScrollBottomBtn.hidden = true;
    return;
  }

  const scrollMidpoint = maxScrollTop / 2;
  const inUpperHalf = chatThread.scrollTop < scrollMidpoint;
  chatScrollTopBtn.hidden = inUpperHalf;
  chatScrollBottomBtn.hidden = !inUpperHalf;
}

function updateChatLayoutState(): void {
  // Short-thread centering is no longer wanted — each turn anchors to the top.
  chatInner.classList.remove('cc-chat-inner-short-thread');
}

function performChatScrollToBottom(): void {
  suppressChatScrollEvent = true;
  chatThread.scrollTop = chatThread.scrollHeight;
  queueMicrotask(() => {
    suppressChatScrollEvent = false;
    updateChatScrollControls();
  });
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

function hasActiveTurn(): boolean {
  return Boolean(chatInner.querySelector('.chat-turn-active'));
}

chatThread.addEventListener('scroll', () => {
  if (suppressChatScrollEvent) return;
  if (suppressNextChatScrollActivation) {
    suppressNextChatScrollActivation = false;
  } else {
    activateChatScrollControls();
  }
  // While a turn is active (user message pinned at top), never auto-pin to bottom.
  if (!hasActiveTurn()) {
    chatAutoPinned = isChatNearBottom();
  }
  updateChatScrollControls();
});

chatThread.addEventListener('wheel', (e: WheelEvent) => {
  // User scrolling up — immediately unpin auto-scroll
  if (e.deltaY !== 0) {
    activateChatScrollControls();
  }
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
  if (!target?.classList.contains('chat-process-details')) return;
  // Don't auto-scroll when a user expands the tool disclosure — they opened
  // it to read; leave the viewport where it is.
}, true);

const chatResizeObserver = new ResizeObserver(() => {
  if (chatEmptyState.parentNode) return;
  updateChatLayoutState();
  scheduleChatScrollToBottom(false, 4);
});
chatResizeObserver.observe(chatThread);

const chatMutationObserver = new MutationObserver(() => {
  updateChatLayoutState();
  if (chatEmptyState.parentNode) return;
  scheduleChatScrollToBottom(false, 1);
  updateChatScrollControls();
});
chatMutationObserver.observe(chatInner, {
  childList: true,
});

chatScrollTopBtn.addEventListener('click', () => {
  activateChatScrollControls();
  chatAutoPinned = false;
  suppressNextChatScrollActivation = true;
  chatThread.scrollTo({ top: 0, behavior: 'smooth' });
  updateChatScrollControls();
});

chatScrollBottomBtn.addEventListener('click', () => {
  activateChatScrollControls();
  chatAutoPinned = true;
  suppressNextChatScrollActivation = true;
  chatThread.scrollTo({ top: chatThread.scrollHeight, behavior: 'smooth' });
  updateChatScrollControls();
});

// ─── Chat Message Helpers ──────────────────────────────────────────────────

function isInternalPromptText(text: string): boolean {
  return text.startsWith('Run a critique pass on the current draft answer before finalizing.')
    || text.startsWith('Revise the draft answer using the critique and verification records now stored in task memory.');
}

function isInternalModelText(text: string): boolean {
  return text.startsWith('## Critique Summary');
}

function shouldShowMemoryEntry(entry: TaskMemoryEntry): boolean {
  if (entry.kind === 'system' || entry.kind === 'browser_finding') return false;
  if (entry.kind === 'user_prompt') return !isInternalPromptText(entry.text);
  if (entry.kind === 'model_result') return !isInternalModelText(entry.text);
  return true;
}

type DocumentAttachmentPreview = Pick<DocumentInvocationAttachment, 'name' | 'mediaType' | 'sizeBytes'>
  & Partial<Pick<DocumentInvocationAttachment, 'id' | 'status' | 'statusDetail' | 'excerpt' | 'chunkCount' | 'tokenEstimate' | 'language'>>;

function formatAttachmentSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return '0 B';
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  if (sizeBytes < 1024 * 1024 * 1024) return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function appendUserAttachmentMessageTo(container: HTMLElement, imageDataUrls: string[], documents: DocumentAttachmentPreview[]): void {
  if (imageDataUrls.length === 0 && documents.length === 0) return;

  const el = document.createElement('div');
  el.className = 'chat-msg chat-msg-user-attachments';

  if (imageDataUrls.length > 0) {
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

  if (documents.length > 0) {
    const docContainer = document.createElement('div');
    docContainer.className = 'chat-msg-documents';
    for (const docAttachment of documents) {
      const kind = getAttachmentFileKind(docAttachment.name, docAttachment.mediaType);
      const card = document.createElement('div');
      card.className = 'chat-msg-document chat-msg-document-tile';
      card.dataset.fileKind = kind;

      const iconWrap = document.createElement('div');
      iconWrap.className = 'chat-msg-document-icon-wrap';
      iconWrap.innerHTML = attachmentIconSvg(kind);

      const title = document.createElement('div');
      title.className = 'chat-msg-document-name';
      title.textContent = docAttachment.name;
      title.title = docAttachment.name;

      const meta = document.createElement('div');
      meta.className = 'chat-msg-document-meta';
      const metaParts = [
        docAttachment.mediaType,
        formatAttachmentSize(docAttachment.sizeBytes),
        docAttachment.status,
        typeof docAttachment.chunkCount === 'number' && docAttachment.chunkCount > 0 ? `${docAttachment.chunkCount} chunks` : '',
      ].filter((part): part is string => Boolean(part));
      meta.textContent = metaParts.join(' • ');

      card.append(iconWrap, title, meta);

      if (docAttachment.excerpt?.trim()) {
        const excerpt = document.createElement('div');
        excerpt.className = 'chat-msg-document-excerpt';
        excerpt.textContent = docAttachment.excerpt.trim();
        card.appendChild(excerpt);
      } else if (docAttachment.statusDetail?.trim()) {
        const detail = document.createElement('div');
        detail.className = 'chat-msg-document-excerpt';
        detail.textContent = docAttachment.statusDetail.trim();
        card.appendChild(detail);
      }

      docContainer.appendChild(card);
    }
    el.appendChild(docContainer);
  }

  container.appendChild(el);
}

function appendUserMessage(text: string, imageDataUrls: string[] = [], documents: DocumentAttachmentPreview[] = []): void {
  if (chatEmptyState.parentNode) chatEmptyState.remove();

  // Hide all previous turns — each new turn takes over the chat viewport.
  // Prior conversation is preserved via task history.
  chatInner.querySelectorAll<HTMLElement>('.chat-turn').forEach(el => {
    el.classList.add('chat-turn-hidden');
    el.classList.remove('chat-turn-active');
  });

  const wrapper = document.createElement('div');
  wrapper.className = 'chat-turn chat-turn-active';
  chatInner.appendChild(wrapper);
  activeTurnWrapper = wrapper;

  const hasText = Boolean(text.trim());
  if (hasText) {
    const bubble = document.createElement('div');
    bubble.className = 'chat-msg chat-msg-user';
    bubble.textContent = text;
    wrapper.appendChild(bubble);
  }
  if (imageDataUrls.length > 0 || documents.length > 0) {
    appendUserAttachmentMessageTo(wrapper, imageDataUrls, documents);
  }

  chatAutoPinned = false;
  suppressChatScrollEvent = true;
  chatThread.scrollTop = 0;
  queueMicrotask(() => { suppressChatScrollEvent = false; });
}

function getAttachmentImageDataUrls(attachments?: InvocationAttachment[]): string[] {
  if (!attachments?.length) return [];
  return attachments
    .filter((attachment): attachment is ImageInvocationAttachment => attachment.type === 'image')
    .map((attachment) => `data:${attachment.mediaType};base64,${attachment.data}`);
}

function getAttachmentDocumentPreviews(attachments?: InvocationAttachment[]): DocumentAttachmentPreview[] {
  if (!attachments?.length) return [];
  return attachments
    .filter((attachment): attachment is DocumentInvocationAttachment => attachment.type === 'document')
    .map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      mediaType: attachment.mediaType,
      sizeBytes: attachment.sizeBytes,
      status: attachment.status,
      statusDetail: attachment.statusDetail,
      excerpt: attachment.excerpt,
      chunkCount: attachment.chunkCount,
      tokenEstimate: attachment.tokenEstimate,
      language: attachment.language,
    }));
}

function getTaskMemoryAttachments(entry: TaskMemoryEntry): InvocationAttachment[] {
  const attachments = Array.isArray(entry.metadata?.attachments)
    ? entry.metadata.attachments as InvocationAttachment[]
    : [];
  return attachments;
}

function clearChatThread(): void {
  chatInner.innerHTML = '';
  chatInner.appendChild(chatEmptyState);
  updateChatLayoutState();
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

const COPY_ICON_SVG =
  '<svg class="chat-msg-copy-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="5" y="5" width="8.5" height="9" rx="1.5"/>' +
    '<path d="M10.5 5V3.5A1 1 0 0 0 9.5 2.5h-6A1 1 0 0 0 2.5 3.5v7A1 1 0 0 0 3.5 11.5H5"/>' +
  '</svg>';

const COPY_CHECK_SVG =
  '<svg class="chat-msg-copy-icon chat-msg-copy-icon-check" viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M3.5 8.5 6.75 11.5 12.5 5.25"/>' +
  '</svg>';

/**
 * Walk every `<pre>` descendant of `root` and make sure it has a
 * click-to-copy button in the top-right corner. Safe to call repeatedly
 * (live-run rewrites innerHTML every frame), so we key off a data flag
 * and a WeakMap to avoid stacking listeners.
 */
const CODE_COPY_BTN_ATTR = 'data-chat-code-copy';

function enhanceCodeBlocks(root: HTMLElement): void {
  const blocks = root.querySelectorAll<HTMLPreElement>('pre');
  blocks.forEach((pre) => {
    if (pre.hasAttribute(CODE_COPY_BTN_ATTR)) return;
    pre.setAttribute(CODE_COPY_BTN_ATTR, 'true');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chat-code-copy-btn';
    btn.setAttribute('title', 'Copy code');
    btn.setAttribute('aria-label', 'Copy code');
    btn.innerHTML = COPY_ICON_SVG;

    let feedbackTimer: number | null = null;
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      event.preventDefault();
      const codeEl = pre.querySelector('code');
      const text = (codeEl?.textContent ?? pre.textContent ?? '').replace(/\n$/, '');
      if (!text) return;

      const copied = await copyTextToClipboard(text);
      if (!copied) {
        getWorkspaceAPI()?.addLog('error', 'system', 'Failed to copy code block');
        return;
      }

      btn.classList.add('chat-code-copy-btn-copied');
      btn.setAttribute('title', 'Copied');
      btn.setAttribute('aria-label', 'Copied');
      btn.innerHTML = COPY_CHECK_SVG;
      if (feedbackTimer !== null) window.clearTimeout(feedbackTimer);
      feedbackTimer = window.setTimeout(() => {
        btn.classList.remove('chat-code-copy-btn-copied');
        btn.setAttribute('title', 'Copy code');
        btn.setAttribute('aria-label', 'Copy code');
        btn.innerHTML = COPY_ICON_SVG;
        feedbackTimer = null;
      }, 1200);
    });

    pre.appendChild(btn);
  });
}

function attachResponseCopyButton(msgRoot: HTMLElement, getText: () => string): void {
  msgRoot.querySelector(':scope > .chat-msg-actions')?.remove();

  const actions = document.createElement('div');
  actions.className = 'chat-msg-actions';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chat-msg-copy-btn';
  btn.setAttribute('title', 'Copy response');
  btn.setAttribute('aria-label', 'Copy response');
  btn.innerHTML = COPY_ICON_SVG;

  let feedbackTimer: number | null = null;
  btn.addEventListener('click', async (event) => {
    event.stopPropagation();
    const text = (getText() || '').trim();
    if (!text) return;
    const copied = await copyTextToClipboard(text);
    if (!copied) {
      getWorkspaceAPI()?.addLog('error', 'system', 'Failed to copy response');
      return;
    }
    btn.classList.add('chat-msg-copy-btn-copied');
    btn.setAttribute('title', 'Copied');
    btn.setAttribute('aria-label', 'Copied');
    btn.innerHTML = COPY_CHECK_SVG;
    if (feedbackTimer !== null) window.clearTimeout(feedbackTimer);
    feedbackTimer = window.setTimeout(() => {
      btn.classList.remove('chat-msg-copy-btn-copied');
      btn.setAttribute('title', 'Copy response');
      btn.setAttribute('aria-label', 'Copy response');
      btn.innerHTML = COPY_ICON_SVG;
      feedbackTimer = null;
    }, 1200);
  });

  actions.appendChild(btn);
  msgRoot.appendChild(actions);
}

function createLiveRunCard(taskId: string, _provider: string, prompt?: string): void {
  const container = activeTurnWrapper ?? chatInner;
  // Keep activeTurnWrapper set until the turn completes (flushFinalResult/flushError
  // removes the chat-turn-active class on the wrapper). This tells the scroll handler
  // to leave chatAutoPinned alone during streaming.
  createLiveRunCardInternal(taskId, _provider, container, {
    renderMarkdown,
    updateLastAgentResponseText,
    scheduleChatScrollToBottom,
    disableChatAutoPin: () => {
      chatAutoPinned = false;
      updateChatScrollControls();
    },
    attachResponseCopyButton,
    enhanceCodeBlocks,
  }, prompt);
  flushPendingLiveProgress(taskId);
}

function enqueuePendingLiveProgress(taskId: string, progress: any): void {
  const queue = pendingLiveProgressByTask.get(taskId) ?? [];
  queue.push(progress);
  if (queue.length > 100) {
    queue.splice(0, queue.length - 100);
  }
  pendingLiveProgressByTask.set(taskId, queue);
}

function handleLiveProgress(progress: any): void {
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
    if (text.startsWith('tool-start:') || text.startsWith('tool-done:') || text.startsWith('tool-progress:')) {
      appendToolStatusInternal(progress.taskId, text);
    } else if (text === 'thought-boundary' || text === 'turn-boundary') {
      appendToolStatusInternal(progress.taskId, text);
    } else if (text.startsWith('Calling ')) {
      appendToolActivity(progress.taskId, 'call', text.replace(/^Calling\s+/, '').replace(/\.\.\.$/, ''));
    } else if (text.startsWith('Tool result: ')) {
      appendToolActivity(progress.taskId, 'result', text.slice('Tool result: '.length));
    }
    // Other status strings (pre-task setup, informational chatter) are not
    // rendered in the live card; the thinking line is reserved for Codex
    // token output routed through `type: 'token'`.
  }
}

function flushPendingLiveProgress(taskId: string): void {
  const queue = pendingLiveProgressByTask.get(taskId);
  if (!queue?.length) return;
  pendingLiveProgressByTask.delete(taskId);
  for (const progress of queue) {
    handleLiveProgress(progress);
  }
}

function appendToken(taskId: string, text: string): void {
  appendTokenInternal(taskId, text);
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

function appendModelMemoryEntry(entry: TaskMemoryEntry): void {
  if (entry.kind !== 'model_result' || !shouldShowMemoryEntry(entry)) return;

  if (chatEmptyState.parentNode) chatEmptyState.remove();
  updateLastAgentResponseText(entry.text);

  const el = document.createElement('div');
  el.className = 'chat-msg chat-msg-model chat-msg-done';
  el.innerHTML = `<div class="chat-msg-text chat-markdown">${renderMarkdown(entry.text)}</div>`;
  enhanceCodeBlocks(el);
  attachResponseCopyButton(el, () => entry.text);

  const container = activeTurnWrapper ?? chatInner;
  activeTurnWrapper = null;
  container.appendChild(el);
  container.classList.remove('chat-turn-active');
  scheduleChatScrollToBottom(true);
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

  const state = (window as any).__lastState;
  const activeTask = state?.tasks?.find((task: any) => task.id === taskId) || null;

  for (const entry of memory.entries) {
    if (!shouldShowMemoryEntry(entry)) continue;
    if (entry.kind === 'user_prompt') {
      const attachments = getTaskMemoryAttachments(entry);
      appendUserMessage(
        entry.text,
        getAttachmentImageDataUrls(attachments),
        getAttachmentDocumentPreviews(attachments),
      );
      continue;
    }
    if (entry.kind === 'model_result') {
      appendModelMemoryEntry(entry);
    }
  }

  if (activeTask?.status === 'running') {
    createLiveRunCard(taskId, activeTask.owner || 'system', undefined);
  }
}

// ─── Chat Submission ───────────────────────────────────────────────────────

function getActiveTaskIdFromState(): string | null {
  const state = (window as any).__lastState;
  return state?.activeTaskId || null;
}

function getActiveTaskFromState(): any | null {
  const state = (window as any).__lastState;
  const taskId = state?.activeTaskId || null;
  if (!taskId) return null;
  return state?.tasks?.find((task: any) => task.id === taskId) || null;
}

function buildTaskTitleFromDraft(prompt: string, pendingDocumentPreviews: Array<{ name: string }>, imageAttachments: Array<{ name?: string }>): string {
  const titleSource = prompt || pendingDocumentPreviews[0]?.name || imageAttachments[0]?.name || 'Attachment';
  return titleSource.length > 48 ? `${titleSource.slice(0, 48)}...` : titleSource;
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

function getElectronFilePath(file: File): string | undefined {
  // Prefer the modern webUtils.getPathForFile bridge (Electron 32+). Fall back
  // to the deprecated File.path property only if the bridge is unavailable
  // (e.g. running outside Electron in a test harness).
  const viaPreload = getWorkspaceAPI()?.file?.getPathForFile?.(file);
  if (typeof viaPreload === 'string' && viaPreload.trim()) return viaPreload;
  const legacy = (file as File & { path?: unknown }).path;
  return typeof legacy === 'string' && legacy.trim() ? legacy : undefined;
}

async function buildAttachments(): Promise<ImageInvocationAttachment[]> {
  const imageFiles = attachedFiles.filter(f => f.type === 'image');
  if (imageFiles.length === 0) return [];

  const results: ImageInvocationAttachment[] = [];
  let totalOriginal = 0;
  let totalOptimized = 0;
  let reencodedCount = 0;

  for (const entry of imageFiles) {
    const localPath = getElectronFilePath(entry.file);
    // Reuse the background optimization started at attach-time when
    // available; fall back to running it synchronously here if the entry
    // was produced by a path that didn't kick it off (defensive).
    const optimized = entry.optimizationResult
      ?? (await (entry.optimization ?? optimizeImageForCodex(entry.file)));
    entry.optimizationResult = optimized;
    totalOriginal += optimized.originalBytes;
    totalOptimized += optimized.optimizedBytes;
    if (optimized.reencoded) reencodedCount++;

    results.push({
      type: 'image',
      mediaType: optimized.mediaType,
      data: optimized.data,
      name: optimized.name,
      // Keep the local disk path only when we passed the original bytes
      // through; if we re-encoded in memory, force the provider onto the
      // data-URL branch so Codex sees the optimized bytes instead of the
      // (oversized) file on disk.
      path: optimized.reencoded ? undefined : localPath,
    });
  }

  if (totalOriginal > 0 && totalOptimized < totalOriginal) {
    const savedBytes = totalOriginal - totalOptimized;
    const savedKB = Math.round(savedBytes / 1024);
    const pct = Math.round((savedBytes / totalOriginal) * 100);
    console.info(
      `[command] image attachments: re-encoded ${reencodedCount}/${imageFiles.length}, ` +
      `saved ${savedKB} KB (${pct}% smaller before base64 inflation).`,
    );
  }

  return results;
}

async function buildDocumentImportRequests(): Promise<DocumentImportRequest[]> {
  const documentFiles = attachedFiles.filter((entry) => entry.type === 'document');
  if (documentFiles.length === 0) return [];

  const results: DocumentImportRequest[] = [];
  for (const { file } of documentFiles) {
    const localPath = getElectronFilePath(file);
    if (localPath) {
      results.push({
        path: localPath,
        name: file.name,
        mediaType: file.type || undefined,
        sizeBytes: file.size,
        lastModifiedMs: file.lastModified,
      });
    } else {
      const dataBase64 = await fileToBase64(file);
      results.push({
        dataBase64,
        name: file.name,
        mediaType: file.type || undefined,
        sizeBytes: file.size,
        lastModifiedMs: file.lastModified,
      });
    }
  }
  return results;
}

function buildPendingDocumentPreviews(): DocumentAttachmentPreview[] {
  return attachedFiles
    .filter((entry) => entry.type === 'document')
    .map(({ file }) => ({
      name: file.name,
      mediaType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      status: 'queued',
      chunkCount: 0,
      tokenEstimate: 0,
      language: '',
    }));
}

async function submitChat(): Promise<void> {
  const prompt = chatInput.value.trim();
  const hasImages = attachedFiles.some(f => f.type === 'image');
  const hasDocuments = attachedFiles.some(f => f.type === 'document');
  if (!prompt && !hasImages && !hasDocuments) { chatInput.focus(); return; }

  const imageAttachments = await buildAttachments();
  const imageDataUrls = getAttachmentImageDataUrls(imageAttachments);
  const pendingDocumentPreviews = buildPendingDocumentPreviews();

  const modelApi = getModelAPI();
  if (!modelApi?.invoke) {
    appendUserMessage(prompt, imageDataUrls, pendingDocumentPreviews);
    chatInput.value = '';
    clearAttachments();
    const disabledTaskId = `model-disabled-${chatCounter++}`;
    createLiveRunCard(disabledTaskId, 'system');
    replaceWithError(disabledTaskId, 'Model integration is not enabled in this v2 browser build.');
    getWorkspaceAPI()?.addLog('warn', 'system', 'Model integration is not enabled in this v2 browser build.');
    chatInput.focus();
    return;
  }

  chatCounter++;
  let taskId = getActiveTaskIdFromState();
  const activeTask = getActiveTaskFromState();
  const owner = selectedOwner;

  if (!taskId) {
    const workspaceAPI = getWorkspaceAPI();
    if (!workspaceAPI) {
      replaceWithError(`model-disabled-${chatCounter}`, 'Command surface is not connected to the runtime API.');
      console.warn('[command] Command submit failed: getWorkspaceAPI() is unavailable.');
      chatInput.value = '';
      chatInput.focus();
      return;
    }
    const title = buildTaskTitleFromDraft(prompt, pendingDocumentPreviews, imageAttachments);
    const createdTask = await workspaceAPI.createTask(title);
    taskId = createdTask.id;
  } else if (activeTask?.title === NEW_CHAT_TITLE) {
    const workspaceAPI = getWorkspaceAPI();
    const nextTitle = buildTaskTitleFromDraft(prompt, pendingDocumentPreviews, imageAttachments);
    await workspaceAPI?.updateTask(taskId, { title: nextTitle });
  }

  const resolvedOwner: string = owner;

  try {
    let documentAttachments: DocumentInvocationAttachment[] = [];
    if (hasDocuments) {
      const attachmentApi = getAttachmentAPI();
      if (!attachmentApi?.importDocuments) {
        throw new Error('Document attachment import is not available in this build.');
      }
      documentAttachments = await attachmentApi.importDocuments(taskId, await buildDocumentImportRequests());
    }

    const pendingAttachments: InvocationAttachment[] = [...imageAttachments, ...documentAttachments];
    const effectivePrompt = prompt || (documentAttachments.length > 0 ? 'Review the attached document(s).' : prompt);
    const invokeOptions = pendingAttachments.length > 0 || effectivePrompt !== prompt
      ? {
        attachments: pendingAttachments.length > 0 ? pendingAttachments : undefined,
        displayPrompt: prompt,
      }
      : undefined;

    chatInput.value = '';
    appendUserMessage(prompt, imageDataUrls, documentAttachments);
    clearAttachments();

    runningTaskIds.add(taskId);
    syncStopBtn();
    syncModelToggleState();
    createLiveRunCard(taskId, resolvedOwner);

    const result = await modelApi.invoke(taskId, effectivePrompt, resolvedOwner, invokeOptions);
    replaceWithResult(taskId, result, result?.providerId || resolvedOwner);
  } catch (err: any) {
    const message = err?.message || String(err);
    if (runningTaskIds.has(taskId)) {
      replaceWithError(taskId, message);
    } else {
      getWorkspaceAPI()?.addLog('error', 'system', `Failed to send chat: ${message}`, taskId);
    }
  } finally {
    runningTaskIds.delete(taskId);
    syncStopBtn();
    syncModelToggleState();
    chatInput.focus();
  }
}

async function resetTokenUsageDisplay(): Promise<void> {
  const workspaceAPI = getWorkspaceAPI();
  if (!workspaceAPI?.resetTokenUsage) {
    getWorkspaceAPI()?.addLog('warn', 'system', 'Token usage reset is not available in this build.');
    return;
  }

  tokenUsageResetBtn.disabled = true;
  try {
    await workspaceAPI.resetTokenUsage();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void workspaceAPI.addLog('error', 'system', `Failed to reset token usage: ${message}`);
  } finally {
    tokenUsageResetBtn.disabled = false;
  }
}
function syncStopBtn(): void {
  const activeId = getActiveTaskIdFromState();
  const activeRunning = activeId !== null && runningTaskIds.has(activeId);
  chatStopBtn.hidden = !activeRunning;
  if (!activeRunning) {
    chatStopBtn.disabled = false;
    chatStopBtn.classList.remove('cc-stop-btn-stopping');
    chatStopBtn.title = 'Stop task';
    chatStopBtn.setAttribute('aria-label', 'Stop task');
  }
}

chatStopBtn.addEventListener('click', () => {
  const modelApi = getModelAPI();
  const activeId = getActiveTaskIdFromState();
  if (activeId && runningTaskIds.has(activeId) && modelApi?.cancel) {
    markCancellingInternal(activeId);
    chatStopBtn.classList.add('cc-stop-btn-stopping');
    chatStopBtn.disabled = true;
    chatStopBtn.title = 'Stopping…';
    chatStopBtn.setAttribute('aria-label', 'Stopping task');
    void modelApi.cancel(activeId);
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
tokenUsageResetBtn.addEventListener('click', () => {
  void resetTokenUsageDisplay();
});
chatInput.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    void submitChat();
  }
});

visualMaskApplyBtn.addEventListener('click', () => {
  showVisualMaskHint();
});

visualMaskClearBtn.addEventListener('click', () => {
  void clearVisualMasksFromComposer();
});

// Idle-state suggestion chips — fill input on click
chatEmptyState.addEventListener('click', (e: MouseEvent) => {
  const target = e.target;
  if (!(target instanceof Element)) return;
  const chip = target.closest('.cc-idle-chip') as HTMLElement | null;
  if (!chip) return;
  const prompt = chip.dataset.prompt;
  if (!prompt) return;
  chatInput.value = prompt;
  chatInput.focus();
  // Auto-resize the textarea in case the prompt is longer than one line
  chatInput.style.height = 'auto';
  chatInput.style.height = `${chatInput.scrollHeight}px`;
});

// Paste images directly into the textarea. Collects every image item on the
// clipboard in one event so Codex receives all of them as separate input items.
chatInput.addEventListener('paste', (e: ClipboardEvent) => {
  const items = e.clipboardData?.items;
  if (!items) return;

  const pastedImages: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind !== 'file') continue;
    if (!item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file) pastedImages.push(file);
  }

  if (pastedImages.length === 0) return;
  e.preventDefault();

  const ts = Date.now();
  const dt = new DataTransfer();
  pastedImages.forEach((file, idx) => {
    dt.items.add(renamePastedImageIfGeneric(file, idx, ts));
  });
  addFiles(dt.files, 'image');
});

function renamePastedImageIfGeneric(file: File, index: number, ts: number): File {
  const original = file.name?.trim() ?? '';
  const isGeneric =
    !original ||
    original === 'image.png' ||
    original === 'image.jpg' ||
    original === 'image.jpeg' ||
    original.toLowerCase() === 'image';
  if (!isGeneric) return file;

  const ext = extensionForMediaType(normalizeMediaType(file.type));
  return new File([file], `pasted-${ts}-${index + 1}.${ext}`, {
    type: file.type || 'image/png',
    lastModified: file.lastModified || ts,
  });
}

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
    const title = document.createElement('span');
    title.className = 'cc-history-item-title';
    title.textContent = task.title;

    const date = document.createElement('span');
    date.className = 'cc-history-item-date';
    date.textContent = `${formatHistoryDate(task.updatedAt)} • ${task.id}`;

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'cc-history-delete';
    deleteBtn.type = 'button';
    deleteBtn.title = task.status === 'running' ? 'Cannot delete a running chat' : 'Delete chat';
    deleteBtn.setAttribute('aria-label', task.status === 'running' ? 'Cannot delete a running chat' : `Delete ${task.title}`);
    deleteBtn.disabled = task.status === 'running';
    deleteBtn.innerHTML =
      '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M3.5 4.5h9"/><path d="M6 4.5V3h4v1.5"/><path d="M5.5 6.5v5"/><path d="M8 6.5v5"/><path d="M10.5 6.5v5"/><path d="M4.5 4.5l.5 8h6l.5-8"/>' +
      '</svg>';
    deleteBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      void deleteHistoryTask(task.id);
    });

    item.append(title, date, deleteBtn);
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

async function deleteHistoryTask(taskId: string): Promise<void> {
  const workspaceAPI = getWorkspaceAPI();
  if (!workspaceAPI) return;

  try {
    await workspaceAPI.deleteTask(taskId);
    const nextState = await workspaceAPI.getState();
    renderState(nextState);
    if (!historyOverlay.hidden) openHistoryPopup();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void workspaceAPI.addLog('error', 'system', `Failed to delete chat: ${message}`);
  }
}

async function startNewChat(): Promise<void> {
  const workspaceAPI = getWorkspaceAPI();
  if (!workspaceAPI) return;

  historyOverlay.hidden = true;
  await workspaceAPI.createTask(NEW_CHAT_TITLE);
  chatInput.focus();
}

function switchToTask(taskId: string): void {
  const workspaceAPI = getWorkspaceAPI();
  if (!workspaceAPI) return;

  void workspaceAPI.setActiveTask(taskId).then(() => {
    syncStopBtn();
    syncModelToggleState();
  });
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
chatNewBtn.addEventListener('click', () => { void startNewChat(); });

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

type FooterTokenFigures = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  apiCalls: number;
};

const EMPTY_FIGURES: FooterTokenFigures = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  cacheCreationInputTokens: 0,
  apiCalls: 0,
};

function readFooterTokenFigures(state: any, owner: SelectableOwner): FooterTokenFigures {
  const activeTaskId: string | null = state?.activeTaskId ?? null;
  if (!activeTaskId || !isExplicitSelectableOwner(owner)) return EMPTY_FIGURES;
  const task = state?.taskTokenUsage?.[activeTaskId];
  if (!task) return EMPTY_FIGURES;
  return {
    inputTokens: task.inputTokens ?? 0,
    outputTokens: task.outputTokens ?? 0,
    cachedInputTokens: task.cachedInputTokens ?? 0,
    cacheCreationInputTokens: task.cacheCreationInputTokens ?? 0,
    apiCalls: task.apiCalls ?? 0,
  };
}

function buildFooterTokenTooltip(owner: SelectableOwner, figures: FooterTokenFigures, total: number, freshInput: number): string {
  const label = isExplicitSelectableOwner(owner) ? OWNER_LABELS[owner] : String(owner);
  const lines = [
    `${label} · active task`,
    `total    ${total.toLocaleString()}`,
    `in       ${freshInput.toLocaleString()} (fresh input)`,
    `cached   ${figures.cachedInputTokens.toLocaleString()} (cache read)`,
    `out      ${figures.outputTokens.toLocaleString()}`,
  ];
  if (figures.cacheCreationInputTokens > 0) {
    lines.push(`cache+   ${figures.cacheCreationInputTokens.toLocaleString()} (cache write)`);
  }
  if (figures.apiCalls > 0) {
    lines.push(`calls    ${figures.apiCalls.toLocaleString()}`);
  }
  return lines.join('\n');
}

function updateTokenUsageDisplay(state: any = (window as any).__lastState, owner: SelectableOwner = selectedOwner): void {
  if (!state) return;
  const figures = readFooterTokenFigures(state, owner);
  const freshInput = Math.max(0, figures.inputTokens - figures.cachedInputTokens);
  const total = freshInput + figures.cachedInputTokens + figures.outputTokens;

  tokenStatusLabel.innerHTML = '';

  const totalEl = document.createElement('span');
  totalEl.className = 'cc-token-total';
  totalEl.textContent = `${formatTokenCount(total)} total`;
  tokenStatusLabel.appendChild(totalEl);

  const appendBreakdown = (value: number, label: string): void => {
    const sep = document.createElement('span');
    sep.className = 'cc-token-sep';
    sep.setAttribute('aria-hidden', 'true');
    sep.textContent = '·';
    tokenStatusLabel.appendChild(sep);

    const part = document.createElement('span');
    part.className = 'cc-token-part';
    part.textContent = `${formatTokenCount(value)} ${label}`;
    tokenStatusLabel.appendChild(part);
  };

  appendBreakdown(freshInput, 'in');
  appendBreakdown(figures.cachedInputTokens, 'cached');
  appendBreakdown(figures.outputTokens, 'out');

  tokenStatusLabel.title = buildFooterTokenTooltip(owner, figures, total, freshInput);
}

// ─── Agent Tab Strip ───────────────────────────────────────────────────────

const COMPLETED_PREVIEW_COUNT = 3;

function syncAgentSidebarUi(hasVisibleTasks: boolean): void {
  agentTabsShell.hidden = !hasVisibleTasks;
  agentTabsShell.classList.toggle('is-collapsed', agentSidebarCollapsed);
  agentSidebarHeaderToggleBtn.hidden = !hasVisibleTasks;
  agentSidebarHeaderToggleBtn.classList.toggle('is-active', !agentSidebarCollapsed);
  agentSidebarHeaderToggleBtn.setAttribute('aria-expanded', String(!agentSidebarCollapsed));
  const toggleLabel = agentSidebarCollapsed ? 'Show agents' : 'Hide agents';
  agentSidebarHeaderToggleBtn.title = toggleLabel;
  agentSidebarHeaderToggleBtn.setAttribute('aria-label', toggleLabel);
}

function setAgentSidebarCollapsed(nextCollapsed: boolean): void {
  agentSidebarCollapsed = nextCollapsed;
  persistAgentSidebarCollapsed();

  const state = (window as any).__lastState;
  const tasks: any[] = state?.tasks ?? [];
  const activeId: string | null = state?.activeTaskId ?? null;
  const hasVisibleTasks = tasks.some((task) =>
    (task.status === 'running' && task.id !== activeId) ||
    task.status === 'completed' ||
    task.status === 'failed' ||
    task.status === 'cancelled');

  syncAgentSidebarUi(hasVisibleTasks);
}

type CompletedBucket = {
  /** Stable key, used to preserve order of first-occurrence across renders. */
  key: string;
  label: string;
  tasks: any[];
};

/** Bucket a completed task into a human-friendly date group. Newest first. */
function bucketCompletedTask(task: any, now: number): { key: string; label: string } {
  const ts = typeof task.updatedAt === 'number'
    ? task.updatedAt
    : typeof task.createdAt === 'number'
      ? task.createdAt
      : now;

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const taskDay = new Date(ts);
  taskDay.setHours(0, 0, 0, 0);
  const daysAgo = Math.round((today.getTime() - taskDay.getTime()) / 86_400_000);

  if (daysAgo <= 0) return { key: 'today', label: 'Today' };
  if (daysAgo === 1) return { key: 'yesterday', label: 'Yesterday' };
  if (daysAgo <= 7) return { key: 'previous-7', label: 'Previous 7 days' };
  if (daysAgo <= 30) return { key: 'previous-30', label: 'Previous 30 days' };

  const d = new Date(ts);
  const sameYear = d.getFullYear() === today.getFullYear();
  const label = sameYear
    ? d.toLocaleDateString('en-US', { month: 'long' })
    : d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const key = `month-${d.getFullYear()}-${d.getMonth()}`;
  return { key, label };
}

function groupCompletedByDate(tasks: any[]): CompletedBucket[] {
  const now = Date.now();
  const buckets: CompletedBucket[] = [];
  const index = new Map<string, number>();
  for (const task of tasks) {
    const { key, label } = bucketCompletedTask(task, now);
    let idx = index.get(key);
    if (idx === undefined) {
      idx = buckets.length;
      index.set(key, idx);
      buckets.push({ key, label, tasks: [] });
    }
    buckets[idx].tasks.push(task);
  }
  return buckets;
}

function syncAgentTabs(state: any): void {
  const tasks: any[] = state?.tasks ?? [];
  const activeId: string | null = state?.activeTaskId ?? null;

  // Running = status 'running' but NOT the active task (those are backgrounded)
  const runningTasks = tasks.filter(t => t.status === 'running' && t.id !== activeId);
  // Completed = done or failed, newest first
  const completedTasks = [...tasks]
    .filter(t => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled')
    .sort((a, b) => b.updatedAt - a.updatedAt);

  // Sidebar only appears when there are backgrounded running OR completed tasks
  if (runningTasks.length === 0 && completedTasks.length === 0) {
    lastAgentTabsRenderKey = '';
    syncAgentSidebarUi(false);
    return;
  }
  syncAgentSidebarUi(true);

  // Reset expansion state only when tasks are added or removed
  const signature = completedTasks.map(t => t.id).join(',');
  if (signature !== lastTaskListSignature) {
    lastTaskListSignature = signature;
    completedExpanded = false;
  }
  const renderKey = [
    activeId || '',
    runningTasks.map(t => `${t.id}:${t.updatedAt}:${t.status}`).join(','),
    completedTasks.map(t => `${t.id}:${t.updatedAt}:${t.status}`).join(','),
    completedExpanded ? '1' : '0',
    agentSidebarCollapsed ? '1' : '0',
  ].join('|');
  if (renderKey === lastAgentTabsRenderKey) {
    return;
  }
  lastAgentTabsRenderKey = renderKey;

  agentTabsList.innerHTML = '';

  // ── Running section ──────────────────────────────────────────────────
  if (runningTasks.length > 0) {
    agentTabsList.appendChild(buildSectionLabel('Running', 'running'));
    for (const task of runningTasks) {
      agentTabsList.appendChild(buildAgentTab(task, activeId));
    }
  }

  // ── Completed section ────────────────────────────────────────────────
  const hiddenCount = completedTasks.length - COMPLETED_PREVIEW_COUNT;
  const canExpand = hiddenCount > 0;

  if (completedTasks.length > 0) {
    if (completedExpanded) {
      // Expanded: show every completed task bucketed by date group; each section
      // starts collapsed and toggles open via its chevron header.
      const groups = groupCompletedByDate(completedTasks);
      // Drop stale keys so expandedBuckets doesn't grow unbounded over time.
      const liveKeys = new Set(groups.map(g => g.key));
      for (const key of Array.from(expandedBuckets)) {
        if (!liveKeys.has(key)) expandedBuckets.delete(key);
      }
      for (const group of groups) {
        agentTabsList.appendChild(buildCollapsibleSection(group, activeId));
      }
    } else {
      // Collapsed: flat preview, a single "Completed" header.
      agentTabsList.appendChild(buildSectionLabel('Completed', 'completed'));
      const visibleCompleted = completedTasks.slice(0, COMPLETED_PREVIEW_COUNT);
      for (const task of visibleCompleted) {
        agentTabsList.appendChild(buildAgentTab(task, activeId));
      }
      if (canExpand) {
        const showMoreBtn = document.createElement('button');
        showMoreBtn.type = 'button';
        showMoreBtn.className = 'cc-agent-show-more';
        showMoreBtn.innerHTML =
          `<span>Show ${hiddenCount} more</span>`
          + '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>';
        showMoreBtn.addEventListener('click', () => {
          completedExpanded = true;
          expandedBuckets.clear();
          syncAgentTabs((window as any).__lastState);
        });
        agentTabsList.appendChild(showMoreBtn);
      }
    }
  }

  // Sticky footer — only while the full history is expanded.
  const footerVisible = completedExpanded && canExpand;
  agentSidebarFooter.hidden = !footerVisible;
  agentSidebarFooterCount.textContent = footerVisible
    ? `${completedTasks.length} total`
    : '';
}

function buildSectionLabel(text: string, variant: 'running' | 'completed'): HTMLDivElement {
  const el = document.createElement('div');
  el.className = `cc-agent-section-label cc-agent-section-label-${variant}`;
  el.textContent = text;
  return el;
}

/**
 * Render one date bucket (Today / Yesterday / Previous 7 days / month) as a
 * collapsible `<details>`-style block. Starts collapsed by default so expanding
 * the full history doesn't dump a 400-row wall on the user.
 */
function buildCollapsibleSection(group: CompletedBucket, activeId: string | null): HTMLDivElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'cc-agent-section';
  wrapper.dataset.bucketKey = group.key;

  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'cc-agent-section-header';
  const isOpen = expandedBuckets.has(group.key);
  header.setAttribute('aria-expanded', String(isOpen));

  const chevron = document.createElement('span');
  chevron.className = 'cc-agent-section-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.innerHTML =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M6 4l4 4-4 4"/>'
    + '</svg>';

  const label = document.createElement('span');
  label.className = 'cc-agent-section-header-label';
  label.textContent = group.label;

  const count = document.createElement('span');
  count.className = 'cc-agent-section-header-count';
  count.textContent = String(group.tasks.length);

  header.append(chevron, label, count);

  const body = document.createElement('div');
  body.className = 'cc-agent-section-body';
  body.hidden = !isOpen;
  for (const task of group.tasks) {
    body.appendChild(buildAgentTab(task, activeId));
  }

  header.addEventListener('click', () => {
    const nextOpen = !expandedBuckets.has(group.key);
    if (nextOpen) {
      expandedBuckets.add(group.key);
    } else {
      expandedBuckets.delete(group.key);
    }
    wrapper.classList.toggle('is-open', nextOpen);
    header.setAttribute('aria-expanded', String(nextOpen));
    body.hidden = !nextOpen;
  });

  if (isOpen) wrapper.classList.add('is-open');
  wrapper.append(header, body);
  return wrapper;
}

function formatRelativeTime(ts: number | undefined | null): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 5) return 'now';
  if (diffSec < 60) return `${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d`;
  const diffWk = Math.floor(diffDay / 7);
  if (diffWk < 5) return `${diffWk}w`;
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getAgentTabProviderLabel(owner: unknown): string {
  if (typeof owner !== 'string') return '';
  if (isExplicitSelectableOwner(owner)) return OWNER_LABELS[owner];
  if (owner.includes('codex') || owner.startsWith('gpt-')) return 'Codex';
  return owner;
}

/** Inline SVG for per-row status. Kept tiny so rows stay compact. */
function agentTabStatusSvg(status: string): string {
  if (status === 'running' || status === 'queued') {
    // Three-dot pulsing glyph, animated via CSS keyframes below.
    return '<span class="cc-agent-tab-status-pulse"></span>';
  }
  if (status === 'failed') {
    return (
      '<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">'
      + '<path d="M3.5 3.5l5 5M8.5 3.5l-5 5"/>'
      + '</svg>'
    );
  }
  if (status === 'cancelled') {
    return (
      '<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">'
      + '<circle cx="6" cy="6" r="4"/>'
      + '<path d="M3.8 3.8l4.4 4.4"/>'
      + '</svg>'
    );
  }
  return (
    '<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M2.8 6.3l2.3 2.3 4.1-4.4"/>'
    + '</svg>'
  );
}

function buildAgentTab(task: any, activeId: string | null): HTMLButtonElement {
  const tab = document.createElement('button');
  tab.type = 'button';
  tab.dataset.taskId = task.id;
  const status: string = task.status || 'queued';
  const classes = ['cc-agent-tab', `cc-agent-tab-status-${status}`];
  if (task.id === activeId) classes.push('cc-agent-tab-active');
  if (status === 'running') classes.push('cc-agent-tab-running');
  tab.className = classes.join(' ');

  const statusBadge = document.createElement('span');
  statusBadge.className = 'cc-agent-tab-status';
  statusBadge.innerHTML = agentTabStatusSvg(status);

  const body = document.createElement('span');
  body.className = 'cc-agent-tab-body';

  const titleRow = document.createElement('span');
  titleRow.className = 'cc-agent-tab-title';
  const label = task.title || task.id;
  titleRow.textContent = label;
  titleRow.title = task.title || task.id;

  const meta = document.createElement('span');
  meta.className = 'cc-agent-tab-meta';
  const provider = getAgentTabProviderLabel(task.owner);
  if (provider) {
    const providerEl = document.createElement('span');
    providerEl.className = 'cc-agent-tab-model';
    providerEl.textContent = provider;
    meta.appendChild(providerEl);
  }
  const timeLabel = formatRelativeTime(task.updatedAt ?? task.createdAt);
  if (timeLabel) {
    if (provider) {
      const sep = document.createElement('span');
      sep.className = 'cc-agent-tab-meta-sep';
      sep.textContent = '·';
      sep.setAttribute('aria-hidden', 'true');
      meta.appendChild(sep);
    }
    const timeEl = document.createElement('span');
    timeEl.className = 'cc-agent-tab-time';
    timeEl.textContent = timeLabel;
    meta.appendChild(timeEl);
  }

  body.append(titleRow);
  if (meta.childElementCount > 0) body.append(meta);
  tab.append(statusBadge, body);

  if (task.id !== activeId) {
    tab.addEventListener('click', () => switchToTask(task.id));
  } else {
    tab.setAttribute('aria-current', 'true');
  }

  return tab;
}

agentSidebarHeaderToggleBtn.addEventListener('click', () => {
  setAgentSidebarCollapsed(!agentSidebarCollapsed);
});

agentSidebarCollapseMoreBtn.addEventListener('click', () => {
  if (!completedExpanded) return;
  completedExpanded = false;
  expandedBuckets.clear();
  lastAgentTabsRenderKey = '';
  syncAgentTabs((window as any).__lastState);
  // Keep the user at the top of the list so the preview is immediately visible.
  agentTabsList.scrollTop = 0;
});

agentTabNewBtn.addEventListener('click', () => { void startNewChat(); });

// ─── Full State Render ─────────────────────────────────────────────────────

function renderState(state: any): void {
  (window as any).__lastState = state;
  const activeTaskForKey = state?.activeTaskId
    ? state?.taskTokenUsage?.[state.activeTaskId]
    : null;
  const activeTokenKey = activeTaskForKey
    ? `${activeTaskForKey.inputTokens ?? 0}:${activeTaskForKey.outputTokens ?? 0}:${activeTaskForKey.cachedInputTokens ?? 0}:${activeTaskForKey.cacheCreationInputTokens ?? 0}:${activeTaskForKey.updatedAt ?? 0}`
    : '0:0:0:0:0';
  const chromeKey = [
    state?.activeTaskId || '',
    state?.tasks?.length || 0,
    state?.logs?.length || 0,
    activeTokenKey,
    state?.tasks?.map((task: any) => `${task.id}:${task.status}:${task.updatedAt}`).join(',') || '',
    state?.providers
      ? Object.entries(state.providers).map(([id, runtime]: [string, any]) => `${id}:${runtime?.status || ''}:${runtime?.model || ''}`).join(',')
      : '',
  ].join('|');
  if (chromeKey === lastStateChromeKey) {
    return;
  }
  lastStateChromeKey = chromeKey;
  syncSelectedOwnerForActiveTask(state);
  syncModelToggleState(state);
  syncAgentTabs(state);
  syncStopBtn();
  const active = state.tasks.find((t: any) => t.id === state.activeTaskId);
  renderLogs(state.logs);

  taskCount.textContent = `tasks: ${state.tasks.length}`;
  if (active?.id) {
    taskSummary.textContent = active.id;
    taskSummary.hidden = false;
  } else {
    taskSummary.textContent = '';
    taskSummary.hidden = true;
  }

  const activeProviderId = active?.owner && active.owner !== 'user'
    ? active.owner
    : null;
  const footerOwner = activeProviderId && isExplicitSelectableOwner(activeProviderId)
    ? activeProviderId
    : selectedOwner;
  modelLabel.textContent = OWNER_LABELS[footerOwner];
  updateTokenUsageDisplay(state, footerOwner);

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
    if (!progress?.taskId) return;
    if (!card?.root.isConnected) {
      enqueuePendingLiveProgress(progress.taskId, progress);
      return;
    }
    handleLiveProgress(progress);
  });
}

// ─── File Attachments ─────────────────────────────────────────────────────

interface AttachedFile {
  file: File;
  type: 'document' | 'image';
  previewUrl?: string;
  /** Promise of the (possibly downscaled) payload we will actually send. */
  optimization?: Promise<OptimizedImage>;
  /** Populated once `optimization` resolves so the preview can read it. */
  optimizationResult?: OptimizedImage;
  /** Set when optimization rejected so the preview can stop showing "…". */
  optimizationFailed?: boolean;
}

const attachedFiles: AttachedFile[] = [];

function renderImageSizeBadge(entry: AttachedFile): string {
  const original = formatAttachmentSize(entry.file.size);
  if (entry.optimizationFailed) {
    return `<span class="cc-preview-size" title="Original size — optimization failed">${escapeHtml(original)}</span>`;
  }
  const result = entry.optimizationResult;
  if (!result) {
    return `<span class="cc-preview-size cc-preview-size--pending" title="Preparing optimized version\u2026">${escapeHtml(original)} \u2192 \u2026</span>`;
  }
  if (!result.reencoded || result.optimizedBytes >= result.originalBytes) {
    return `<span class="cc-preview-size" title="Sent as-is — already within token budget">${escapeHtml(original)}</span>`;
  }
  const optimized = formatAttachmentSize(result.optimizedBytes);
  const savedPct = Math.round(((result.originalBytes - result.optimizedBytes) / result.originalBytes) * 100);
  const title = `Will send ${optimized} to Codex (${savedPct}% smaller than ${original})`;
  return (
    `<span class="cc-preview-size cc-preview-size--saved" title="${escapeHtml(title)}">` +
    `${escapeHtml(original)} <span class="cc-preview-size-arrow">\u2192</span> ${escapeHtml(optimized)} ` +
    `<span class="cc-preview-size-delta">-${savedPct}%</span>` +
    `</span>`
  );
}

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
        renderImageSizeBadge(entry) +
        `<button class="cc-preview-remove" data-index="${i}" title="Remove" aria-label="Remove ${escapeHtml(entry.file.name)}">&times;</button>`;
    } else {
      item.classList.add('cc-attach-preview-item--doc');
      const kind = getAttachmentFileKind(entry.file.name, entry.file.type);
      item.innerHTML =
        `<div class="cc-attach-preview-doc" data-file-kind="${kind}">` +
        `<div class="cc-attach-preview-icon-wrap">${attachmentIconSvg(kind)}</div>` +
        `<span class="cc-preview-doc-name">${escapeHtml(entry.file.name)}</span>` +
        `</div>` +
        `<span class="cc-preview-size" title="Document size">${escapeHtml(formatAttachmentSize(entry.file.size))}</span>` +
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
      // Kick off optimization in the background so the preview can show the
      // final byte count before submit, and submit can reuse the result
      // without re-decoding the image.
      const pending = optimizeImageForCodex(file);
      entry.optimization = pending;
      pending.then(
        (result) => {
          if (!attachedFiles.includes(entry)) return;
          entry.optimizationResult = result;
          syncAttachmentPreview();
        },
        (err) => {
          if (!attachedFiles.includes(entry)) return;
          entry.optimizationFailed = true;
          console.warn('[command] image optimization failed', err);
          syncAttachmentPreview();
        },
      );
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

// ─── Drag-and-drop attachments ────────────────────────────────────────────
//
// Users can drop image/document files anywhere on the composer. Dropped
// files are routed by MIME type: image/* → image attachments (optimizer
// kicks in), everything else → document import.
//
// We also catch stray drops on the window so Electron doesn't navigate away
// if a file is dropped outside the composer target.

const dropTarget: HTMLElement =
  document.querySelector<HTMLElement>('.cc-compose-shell') ??
  document.querySelector<HTMLElement>('.cc-input-footer') ??
  chatInput;

let dragDepth = 0;

function isFileDrag(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  if (!types) return false;
  for (let i = 0; i < types.length; i++) {
    if (types[i] === 'Files') return true;
  }
  return false;
}

function partitionDroppedFiles(files: FileList): { images: File[]; documents: File[] } {
  const images: File[] = [];
  const documents: File[] = [];
  for (const file of Array.from(files)) {
    if (file.type && file.type.startsWith('image/')) {
      images.push(file);
    } else {
      documents.push(file);
    }
  }
  return { images, documents };
}

function filesFromList(list: File[]): FileList {
  const dt = new DataTransfer();
  for (const file of list) dt.items.add(file);
  return dt.files;
}

dropTarget.addEventListener('dragenter', (event: DragEvent) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  dragDepth++;
  dropTarget.classList.add('is-dragging');
});

dropTarget.addEventListener('dragover', (event: DragEvent) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
});

dropTarget.addEventListener('dragleave', (event: DragEvent) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropTarget.classList.remove('is-dragging');
});

dropTarget.addEventListener('drop', (event: DragEvent) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  dragDepth = 0;
  dropTarget.classList.remove('is-dragging');
  const files = event.dataTransfer?.files;
  if (!files || files.length === 0) return;
  const { images, documents } = partitionDroppedFiles(files);
  if (images.length > 0) addFiles(filesFromList(images), 'image');
  if (documents.length > 0) addFiles(filesFromList(documents), 'document');
  chatInput.focus();
});

// Defensive: swallow file drops that land outside the composer so Electron
// doesn't navigate the window to file:// URLs.
window.addEventListener('dragover', (event: DragEvent) => {
  if (isFileDrag(event)) event.preventDefault();
});
window.addEventListener('drop', (event: DragEvent) => {
  if (isFileDrag(event)) event.preventDefault();
});

// ─── Init ──────────────────────────────────────────────────────────────────

setLogsOpen(false);
agentSidebarCollapsed = getStoredAgentSidebarCollapsed();
syncAgentSidebarUi(false);
initializeChatZoom();
initializeModelToggle();

if (!commandWindowAPI) {
  console.error('[command] workspaceAPI is not available; command controls are disabled.');
} else {
  initializeCommandBrowserPane();
  commandWindowAPI.browser.onStateUpdate((state: BrowserState) => renderCommandBrowserState(state));
  commandWindowAPI.browser.onNavUpdate((nav: BrowserNavigationState) => {
    if (document.activeElement !== commandBrowserAddressInput) {
      commandBrowserAddressInput.value = nav.url || '';
    }
    commandBrowserBackBtn.disabled = !nav.canGoBack;
    commandBrowserForwardBtn.disabled = !nav.canGoForward;
    commandBrowserStatus.textContent = nav.isLoading ? 'Loading...' : (nav.title || 'Ready');
    reportCommandBrowserBounds();
  });
  commandWindowAPI.onStateUpdate((state: any) => renderState(state));
  void commandWindowAPI.browser.getState().then(renderCommandBrowserState).catch(() => {});
  commandWindowAPI.getState().then((state: any) => {
    renderState(state);
    commandWindowAPI.addLog('info', 'system', 'Command Center initialized');
  }).catch((error: unknown) => {
    console.error('[command] Failed to initialize command renderer:', error);
  });
}
