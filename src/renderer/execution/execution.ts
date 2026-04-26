import { escapeHtml, formatDate, formatTimeShort, formatNullableTime } from '../shared/utils.js';
export {};
const workspaceAPI = (window as any).workspaceAPI as WorkspaceAPI | null;

// ─── DOM ────────────────────────────────────────────────────────────────────
const browserPane = document.getElementById('browserPane')!;
const executionShell = document.querySelector('.execution-shell') as HTMLElement;
const tabBar = document.getElementById('tabBar')!;
const tabList = document.getElementById('tabList')!;
const tabScrollLeft = document.getElementById('tabScrollLeft') as HTMLButtonElement;
const tabScrollRight = document.getElementById('tabScrollRight') as HTMLButtonElement;
const btnTabOverflow = document.getElementById('btnTabOverflow')!;
const btnOpenHeatmap = document.getElementById('btnOpenHeatmap') as HTMLButtonElement;
const tabOverflowDropdown = document.getElementById('tabOverflowDropdown')!;
const btnNewTab = document.getElementById('btnNewTab')!;
const tabContextMenu = document.getElementById('tabContextMenu')!;
const addressInput = document.getElementById('addressInput') as HTMLInputElement;
const btnBack = document.getElementById('btnBack') as HTMLButtonElement;
const btnForward = document.getElementById('btnForward') as HTMLButtonElement;
const btnReload = document.getElementById('btnReload') as HTMLButtonElement;
const btnStop = document.getElementById('btnStop') as HTMLButtonElement;
const btnBookmark = document.getElementById('btnBookmark') as HTMLButtonElement;
const btnAttachBrowserHere = document.getElementById('btnAttachBrowserHere') as HTMLButtonElement;
const btnZoomIn = document.getElementById('btnZoomIn') as HTMLButtonElement;
const btnZoomOut = document.getElementById('btnZoomOut') as HTMLButtonElement;
const zoomLabel = document.getElementById('zoomLabel')!;
const btnDevTools = document.getElementById('btnDevTools') as HTMLButtonElement;
const btnMenu = document.getElementById('btnMenu') as HTMLButtonElement;
const findBar = document.getElementById('findBar')!;
const findInput = document.getElementById('findInput') as HTMLInputElement;
const findCount = document.getElementById('findCount')!;
const btnFindPrev = document.getElementById('btnFindPrev') as HTMLButtonElement;
const btnFindNext = document.getElementById('btnFindNext') as HTMLButtonElement;
const btnFindClose = document.getElementById('btnFindClose') as HTMLButtonElement;
const dropdownPanel = document.getElementById('dropdownPanel')!;
const dropdownContent = document.getElementById('dropdownContent')!;
const browserSurfaceArea = document.getElementById('browserSurfaceArea')!;
const connectionDot = document.getElementById('connectionDot')!;
const connectionLabel = document.getElementById('connectionLabel')!;
const browserLocationLabel = document.getElementById('browserLocationLabel')!;
const HEATMAP_INTERNAL_URL = 'goldenboy://heatmap';

// ─── State ──────────────────────────────────────────────────────────────────
let boundsTimer: ReturnType<typeof setTimeout> | null = null;
let activePanel: string | null = null;
let lastBrowserState: BrowserState | null = null;
let lastAuthDiagnostics: BrowserAuthDiagnostics | null = null;
let activeContextTabId = '';
let browserAttachedToExecution = false;
let lastDiagnosticsData: {
  consoleEvents: any[];
  networkEvents: any[];
  capturedAt: number | null;
} = {
  consoleEvents: [],
  networkEvents: [],
  capturedAt: null,
};
let recorderPanelRefreshTimer: ReturnType<typeof setInterval> | null = null;
let recorderState: {
  sources: ScreenRecorderSource[];
  selectedSourceIds: Set<string>;
  isLoading: boolean;
  isRecording: boolean;
  startedAt: number | null;
  isSaving: boolean;
  lastSaved: ScreenRecorderSaveResult | null;
  error: string | null;
} = {
  sources: [],
  selectedSourceIds: new Set<string>(),
  isLoading: false,
  isRecording: false,
  startedAt: null,
  isSaving: false,
  lastSaved: null,
  error: null,
};

type ActiveRecorderTrack = {
  source: ScreenRecorderSource;
  stream: MediaStream;
  recorder: MediaRecorder;
  chunks: Blob[];
  stopped: Promise<{ fileName: string; blob: Blob }>;
};

let activeRecorderTracks: ActiveRecorderTrack[] = [];

// CSP blocks inline `onerror` handlers, so favicon failures are handled here.
document.addEventListener('error', (event: Event) => {
  const target = event.target;
  if (!(target instanceof HTMLImageElement)) return;
  if (!target.matches('.tab-favicon, .overflow-tab-favicon, .item-favicon')) return;
  target.style.display = 'none';
}, true);

function formatNetworkDuration(ms: unknown): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return 'Unknown';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function formatRecorderDuration(startedAt: number | null): string {
  if (!startedAt) return '00:00';
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function sanitizeRecorderSegment(input: string): string {
  return input.replace(/[^a-z0-9._-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'display';
}

function getRecorderMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const candidate of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return 'video/webm';
}

function updateRecorderPanelRefreshTimer(): void {
  if (recorderPanelRefreshTimer) {
    clearInterval(recorderPanelRefreshTimer);
    recorderPanelRefreshTimer = null;
  }
  if (activePanel === 'recorder' && recorderState.isRecording) {
    recorderPanelRefreshTimer = setInterval(() => {
      if (activePanel === 'recorder') renderPanel('recorder');
    }, 1000);
  }
}

async function loadRecorderSources(force = false): Promise<void> {
  if (!workspaceAPI) return;
  if (recorderState.isLoading) return;
  if (!force && recorderState.sources.length > 0) return;
  recorderState.isLoading = true;
  recorderState.error = null;
  if (activePanel === 'recorder') renderPanel('recorder');
  try {
    const sources = await workspaceAPI.screenRecorder.listSources();
    recorderState.sources = sources;
    const currentSelections = new Set(recorderState.selectedSourceIds);
    const validSelections = new Set(
      sources
        .map((source) => source.id)
        .filter((sourceId) => currentSelections.has(sourceId)),
    );
    recorderState.selectedSourceIds = validSelections.size > 0
      ? validSelections
      : new Set(sources.map((source) => source.id));
  } catch (error) {
    recorderState.error = error instanceof Error ? error.message : 'Unable to load displays.';
  } finally {
    recorderState.isLoading = false;
    if (activePanel === 'recorder') renderPanel('recorder');
  }
}

function buildRecorderFileName(source: ScreenRecorderSource, startedAt: number): string {
  const stamp = new Date(startedAt).toISOString().replace(/[:.]/g, '-');
  const label = sanitizeRecorderSegment(source.displayId ? `${source.name}-display-${source.displayId}` : source.name);
  return `${label}-${stamp}.webm`;
}

async function createRecorderTrack(source: ScreenRecorderSource, mimeType: string, startedAt: number): Promise<ActiveRecorderTrack> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: source.id,
      },
    } as MediaTrackConstraints,
  } as MediaStreamConstraints);

  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const stopped = new Promise<{ fileName: string; blob: Blob }>((resolve, reject) => {
    recorder.onstop = () => {
      resolve({
        fileName: buildRecorderFileName(source, startedAt),
        blob: new Blob(chunks, { type: mimeType || 'video/webm' }),
      });
    };
    recorder.onerror = () => {
      reject(new Error(`Recording failed for ${source.name}.`));
    };
  });
  recorder.ondataavailable = (event: BlobEvent) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  };
  recorder.start(1000);

  return {
    source,
    stream,
    recorder,
    chunks,
    stopped,
  };
}

async function startRecorderSession(): Promise<void> {
  if (!workspaceAPI || recorderState.isRecording || recorderState.isSaving) return;
  await loadRecorderSources();
  const selectedSources = recorderState.sources.filter((source) => recorderState.selectedSourceIds.has(source.id));
  if (selectedSources.length === 0) {
    recorderState.error = 'Select at least one monitor before recording.';
    if (activePanel === 'recorder') renderPanel('recorder');
    return;
  }

  const startedAt = Date.now();
  const mimeType = getRecorderMimeType();
  recorderState.error = null;
  recorderState.lastSaved = null;

  const startedTracks: ActiveRecorderTrack[] = [];
  try {
    for (const source of selectedSources) {
      const track = await createRecorderTrack(source, mimeType, startedAt);
      startedTracks.push(track);
    }
    activeRecorderTracks = startedTracks;
    recorderState.isRecording = true;
    recorderState.startedAt = startedAt;
    updateRecorderPanelRefreshTimer();
    if (activePanel === 'recorder') renderPanel('recorder');
  } catch (error) {
    for (const track of startedTracks) {
      track.stream.getTracks().forEach((mediaTrack) => mediaTrack.stop());
    }
    activeRecorderTracks = [];
    recorderState.isRecording = false;
    recorderState.startedAt = null;
    recorderState.error = error instanceof Error ? error.message : 'Unable to start recording.';
    updateRecorderPanelRefreshTimer();
    if (activePanel === 'recorder') renderPanel('recorder');
  }
}

async function stopRecorderSession(): Promise<void> {
  if (!workspaceAPI || !recorderState.isRecording || recorderState.isSaving || activeRecorderTracks.length === 0) return;
  recorderState.isSaving = true;
  recorderState.error = null;
  if (activePanel === 'recorder') renderPanel('recorder');

  try {
    const pending = [...activeRecorderTracks];
    for (const track of pending) {
      if (track.recorder.state !== 'inactive') {
        track.recorder.stop();
      }
    }
    const finished = await Promise.all(pending.map((track) => track.stopped));
    for (const track of pending) {
      track.stream.getTracks().forEach((mediaTrack) => mediaTrack.stop());
    }

    const files = await Promise.all(finished.map(async (item) => {
      const bytes = new Uint8Array(await item.blob.arrayBuffer());
      return {
        fileName: item.fileName,
        bytes,
      };
    }));
    const result = await workspaceAPI.screenRecorder.saveFiles(files);
    recorderState.lastSaved = result;
    recorderState.isRecording = false;
    recorderState.startedAt = null;
    recorderState.error = null;
    activeRecorderTracks = [];
  } catch (error) {
    recorderState.error = error instanceof Error ? error.message : 'Unable to stop and save recordings.';
  } finally {
    recorderState.isSaving = false;
    recorderState.isRecording = false;
    recorderState.startedAt = null;
    activeRecorderTracks = [];
    updateRecorderPanelRefreshTimer();
    if (activePanel === 'recorder') renderPanel('recorder');
  }
}

function renderRecorderPanel(): void {
  const hasSources = recorderState.sources.length > 0;
  const selectionCount = recorderState.selectedSourceIds.size;
  const savedMarkup = recorderState.lastSaved
    ? `
      <div class="recorder-block">
        <div class="recorder-block-title">Last Capture</div>
        <div class="recorder-summary">${escapeHtml(recorderState.lastSaved.directory)}</div>
        <div class="recorder-saved-list">
          ${recorderState.lastSaved.files.map((file) => `
            <div class="recorder-saved-item">
              <span class="recorder-saved-name">${escapeHtml(file.fileName)}</span>
              <span class="recorder-saved-meta">${Math.max(1, Math.round(file.byteLength / 1048576))} MB</span>
            </div>
          `).join('')}
        </div>
      </div>
    `
    : '';

  dropdownContent.innerHTML = `
    <div class="recorder-block">
      <div class="recorder-header">
        <div>
          <div class="recorder-block-title">Multi-Monitor Recorder</div>
          <div class="recorder-summary">${recorderState.isRecording ? `Recording ${selectionCount} display${selectionCount === 1 ? '' : 's'} · ${formatRecorderDuration(recorderState.startedAt)}` : 'Capture selected monitors into separate WebM files.'}</div>
        </div>
        <div class="recorder-actions">
          <button class="ext-load-btn" id="btnRecorderRefreshSources" ${recorderState.isLoading || recorderState.isRecording || recorderState.isSaving ? 'disabled' : ''}>Refresh</button>
          <button class="ext-load-btn" id="btnRecorderStart" ${!hasSources || recorderState.isLoading || recorderState.isRecording || recorderState.isSaving || selectionCount === 0 ? 'disabled' : ''}>Start</button>
          <button class="ext-load-btn" id="btnRecorderStop" ${!recorderState.isRecording || recorderState.isSaving ? 'disabled' : ''}>Stop</button>
        </div>
      </div>
      <div class="recorder-chip-row">
        <button class="settings-toggle-button" id="btnRecorderSelectAll" ${!hasSources || recorderState.isRecording || recorderState.isSaving ? 'disabled' : ''}>All</button>
        <button class="settings-toggle-button" id="btnRecorderClearAll" ${!hasSources || recorderState.isRecording || recorderState.isSaving ? 'disabled' : ''}>None</button>
        <span class="recorder-pill ${recorderState.isRecording ? 'live' : ''}">${recorderState.isSaving ? 'Saving…' : recorderState.isRecording ? 'Live' : 'Idle'}</span>
      </div>
      ${recorderState.error ? `<div class="recorder-error">${escapeHtml(recorderState.error)}</div>` : ''}
      ${recorderState.isLoading ? '<div class="panel-empty">Loading displays...</div>' : ''}
      ${!recorderState.isLoading && !hasSources ? '<div class="panel-empty">No monitors available.</div>' : ''}
      <div class="recorder-grid">
        ${recorderState.sources.map((source) => `
          <label class="recorder-source-card ${recorderState.selectedSourceIds.has(source.id) ? 'selected' : ''}">
            <input class="recorder-source-checkbox" type="checkbox" data-recorder-source-id="${escapeHtml(source.id)}" ${recorderState.selectedSourceIds.has(source.id) ? 'checked' : ''} ${recorderState.isRecording || recorderState.isSaving ? 'disabled' : ''}>
            <div class="recorder-source-preview">${source.thumbnailDataUrl ? `<img src="${source.thumbnailDataUrl}" alt="${escapeHtml(source.name)}">` : '<div class="recorder-source-placeholder">No preview</div>'}</div>
            <div class="recorder-source-meta">
              <span class="recorder-source-title">${escapeHtml(source.name)}</span>
              <span class="recorder-source-subtitle">${escapeHtml(source.displayId ? `Display ${source.displayId}` : 'Desktop source')}</span>
            </div>
          </label>
        `).join('')}
      </div>
    </div>
    ${savedMarkup}
  `;
}


async function refreshAuthDiagnostics(): Promise<void> {
  if (!workspaceAPI) {
    lastAuthDiagnostics = null;
    return;
  }
  try {
    lastAuthDiagnostics = await workspaceAPI.browser.getAuthDiagnostics();
  } catch {
    lastAuthDiagnostics = null;
  }
}

async function refreshBrowserDiagnostics(): Promise<void> {
  if (!workspaceAPI) {
    lastDiagnosticsData = { consoleEvents: [], networkEvents: [], capturedAt: Date.now() };
    return;
  }
  try {
    if (!lastBrowserState?.activeTabId) {
      lastDiagnosticsData = { consoleEvents: [], networkEvents: [], capturedAt: Date.now() };
      return;
    }
    const tabId = lastBrowserState.activeTabId;
    const [consoleEvents, networkEvents] = await Promise.all([
      workspaceAPI.browser.getConsoleEvents(tabId),
      workspaceAPI.browser.getNetworkEvents(tabId),
    ]);
    lastDiagnosticsData = {
      consoleEvents: Array.isArray(consoleEvents) ? consoleEvents : [],
      networkEvents: Array.isArray(networkEvents) ? networkEvents : [],
      capturedAt: Date.now(),
    };
  } catch {
    lastDiagnosticsData = { consoleEvents: [], networkEvents: [], capturedAt: Date.now() };
  }
}

// ─── Browser Bounds ─────────────────────────────────────────────────────────
function reportBrowserBounds(): void {
  if (boundsTimer) clearTimeout(boundsTimer);
  boundsTimer = setTimeout(() => {
    if (!workspaceAPI) return;
    if (!browserAttachedToExecution) return;
    const rect = browserSurfaceArea.getBoundingClientRect();
    workspaceAPI.browser.reportBounds({
      x: Math.round(rect.left), y: Math.round(rect.top),
      width: Math.round(rect.width), height: Math.round(rect.height),
    });
    boundsTimer = null;
  }, 50);
}

function setExecutionBrowserAttached(attached: boolean): void {
  browserAttachedToExecution = attached;
  executionShell.classList.toggle('browser-detached', !attached);
  (browserPane as HTMLElement).hidden = !attached;
  btnAttachBrowserHere.disabled = false;
  btnAttachBrowserHere.textContent = attached ? 'Move to Command' : 'Attach Browser';
  btnAttachBrowserHere.title = attached ? 'Move browser to command window' : 'Move browser back to execution window';
  browserLocationLabel.textContent = attached ? 'Execution window' : 'Command window';
  connectionDot.className = attached ? 'status-dot done' : 'status-dot idle';
  connectionLabel.textContent = attached ? 'Browser attached' : 'Browser moved to command';
}

// ─── Tabs ───────────────────────────────────────────────────────────────────
function getTabsDataRenderKey(tabs: any[]): string {
  return tabs.map((tab) => [
    tab.id,
    tab.navigation?.title || '',
    tab.navigation?.url || '',
    tab.navigation?.favicon || '',
    tab.status || '',
  ].join('|')).join('||');
}

function getTabsSelectionRenderKey(
  activeTabId: string,
  splitLeftTabId: string | null,
  splitRightTabId: string | null,
): string {
  return `${activeTabId}::${splitLeftTabId || ''}::${splitRightTabId || ''}`;
}

function updateTabSelectionClasses(
  activeTabId: string,
  splitLeftTabId: string | null,
  splitRightTabId: string | null,
  shouldPlayShimmer: boolean,
): void {
  const tabElements = tabList.querySelectorAll('.browser-tab');
  for (const node of tabElements) {
    const tabEl = node as HTMLElement;
    const tabId = tabEl.dataset.tabId || '';
    const isActive = tabId === activeTabId;
    const isSplitLeft = tabId === splitLeftTabId;
    const isSplitRight = tabId === splitRightTabId;
    tabEl.classList.toggle('active', isActive);
    tabEl.classList.toggle('split-left', isSplitLeft);
    tabEl.classList.toggle('split-right', isSplitRight);
    tabEl.classList.toggle('split-active-side', isActive && (isSplitLeft || isSplitRight));
    tabEl.classList.toggle('tab-shimmer-on', isActive && shouldPlayShimmer);
  }
}

function renderTabs(
  tabs: any[],
  activeTabId: string,
  splitLeftTabId: string | null,
  splitRightTabId: string | null,
): void {
  cachedTabsForOverflow = tabs;
  cachedActiveTabId = activeTabId;
  const tabsDataKey = getTabsDataRenderKey(tabs);
  const selectionKey = getTabsSelectionRenderKey(activeTabId, splitLeftTabId, splitRightTabId);
  const shouldRender = tabsDataKey !== lastRenderedTabsDataKey;
  const shouldUpdateSelection = shouldRender || selectionKey !== lastRenderedTabsSelectionKey;
  const shouldScrollActiveTab = activeTabId !== lastRenderedActiveTabId || tabs.length !== lastRenderedTabCount;
  const shouldPlayShimmer = activeTabId !== lastShimmeredTabId;

  if (shouldRender) {
    tabList.innerHTML = tabs.map(tab => {
      const isActive = tab.id === activeTabId;
      const title = tab.navigation?.title || tab.navigation?.url || 'New Tab';
      const faviconHtml = tab.navigation?.favicon
        ? `<img class="tab-favicon" src="${escapeHtml(tab.navigation.favicon)}">`
        : '';
      const isNewActive = isActive && shouldPlayShimmer;
      const isSplitLeft = tab.id === splitLeftTabId;
      const isSplitRight = tab.id === splitRightTabId;
      const splitClass = isSplitLeft ? 'split-left' : isSplitRight ? 'split-right' : '';
      const splitActiveClass = isActive && (isSplitLeft || isSplitRight) ? 'split-active-side' : '';
      const tabClasses = [
        isActive ? 'active' : '',
        splitClass,
        splitActiveClass,
        isNewActive ? 'tab-shimmer-on' : '',
      ].filter(Boolean).join(' ');
      return `<div class="browser-tab ${tabClasses}" data-tab-id="${tab.id}">
        ${faviconHtml}
        <span class="tab-title">${escapeHtml(title.substring(0, 40))}</span>
        <button class="tab-close" data-close-tab="${tab.id}">&#x2715;</button>
      </div>`;
    }).join('');

    lastRenderedTabsDataKey = tabsDataKey;
    lastRenderedTabCount = tabs.length;
  } else if (shouldUpdateSelection) {
    updateTabSelectionClasses(activeTabId, splitLeftTabId, splitRightTabId, shouldPlayShimmer);
  }

  if (shouldUpdateSelection) {
    lastRenderedTabsSelectionKey = selectionKey;
    lastRenderedActiveTabId = activeTabId;
    lastShimmeredTabId = activeTabId;
  }

  const needsLayoutPass = shouldRender || shouldScrollActiveTab || btnNewTab.parentElement !== tabList;
  const shouldRefreshOverflowDropdown = overflowOpen && (shouldRender || shouldUpdateSelection);
  if (!needsLayoutPass && !shouldRefreshOverflowDropdown) return;

  requestAnimationFrame(() => {
    if (btnNewTab.parentElement !== tabList) {
      btnNewTab.style.display = 'inline-flex';
      tabList.append(btnNewTab);
    }
    if (shouldScrollActiveTab) {
      const activeTab = tabList.querySelector(`[data-tab-id="${activeTabId}"]`) as HTMLElement | null;
      activeTab?.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });
    }
    if (needsLayoutPass) {
      updateTabOverflow();
    }
    if (shouldRefreshOverflowDropdown) {
      renderTabOverflowDropdown();
    }
  });
}

tabList.addEventListener('click', (e: Event) => {
  const target = e.target as HTMLElement;

  const closeId = target.getAttribute('data-close-tab') || target.closest('[data-close-tab]')?.getAttribute('data-close-tab');
  if (closeId) { e.stopPropagation(); workspaceAPI?.actions.submit({ target: 'browser', kind: 'browser.close-tab', payload: { tabId: closeId } }); return; }
  const tabEl = target.closest('.browser-tab') as HTMLElement | null;
  if (tabEl) workspaceAPI?.actions.submit({ target: 'browser', kind: 'browser.activate-tab', payload: { tabId: tabEl.dataset.tabId! } });
});

function hideTabContextMenu(): void {
  tabContextMenu.style.display = 'none';
  tabContextMenu.classList.remove('open');
  activeContextTabId = '';
  requestAnimationFrame(() => reportBrowserBounds());
}

function showTabContextMenu(x: number, y: number, tabId: string): void {
  activeContextTabId = tabId;
  const rect = tabBar.getBoundingClientRect();
  tabContextMenu.style.left = `${Math.max(0, x - rect.left)}px`;
  tabContextMenu.style.top = `${Math.max(0, y - rect.top)}px`;
  tabContextMenu.style.display = 'flex';
  tabContextMenu.classList.add('open');
  requestAnimationFrame(() => reportBrowserBounds());
}

tabList.addEventListener('contextmenu', (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  const tabEl = target.closest('.browser-tab') as HTMLElement | null;
  if (!tabEl) {
    hideTabContextMenu();
    return;
  }
  e.preventDefault();
  const tabId = tabEl.dataset.tabId;
  if (!tabId) return;
  showTabContextMenu(e.clientX, e.clientY, tabId);
});

btnNewTab.addEventListener('click', () => workspaceAPI?.actions.submit({ target: 'browser', kind: 'browser.create-tab', payload: {} }));
btnOpenHeatmap.addEventListener('click', () => openHeatmapTab());
tabContextMenu.addEventListener('click', (e: Event) => {
  const target = e.target as HTMLElement;
  const action = target.getAttribute('data-context-action');
  if (!action || !activeContextTabId) {
    hideTabContextMenu();
    return;
  }

  e.preventDefault();
  e.stopPropagation();

  if (action === 'new-tab-next') {
    workspaceAPI?.actions.submit({
      target: 'browser',
      kind: 'browser.create-tab',
      payload: { insertAfterTabId: activeContextTabId },
    });
    hideTabContextMenu();
    return;
  }

  if (action === 'split-tab') {
    void workspaceAPI?.actions.submit({
      target: 'browser',
      kind: 'browser.split-tab',
      payload: { tabId: activeContextTabId },
    });
    hideTabContextMenu();
    return;
  }

  if (action === 'clear-split-view') {
    void workspaceAPI?.actions.submit({
      target: 'browser',
      kind: 'browser.clear-split-view',
      payload: {},
    });
    hideTabContextMenu();
    return;
  }

  hideTabContextMenu();
});

// ─── Tab Overflow: Scroll Arrows + Dropdown ────────────────────────────────

let cachedTabsForOverflow: any[] = [];
let cachedActiveTabId = '';
let lastRenderedTabsDataKey = '';
let lastRenderedTabsSelectionKey = '';
let lastRenderedActiveTabId = '';
let lastRenderedTabCount = 0;

function updateTabOverflow(): void {
  const isOverflowing = tabList.scrollWidth > tabList.clientWidth + 2;
  tabScrollLeft.classList.toggle('visible', isOverflowing && tabList.scrollLeft > 2);
  tabScrollRight.classList.toggle('visible', isOverflowing && tabList.scrollLeft < tabList.scrollWidth - tabList.clientWidth - 2);
  btnTabOverflow.classList.toggle('visible', isOverflowing);
}

tabList.addEventListener('scroll', updateTabOverflow);
new ResizeObserver(updateTabOverflow).observe(tabList);

tabScrollLeft.addEventListener('click', () => {
  tabList.scrollBy({ left: -160, behavior: 'smooth' });
});
tabScrollRight.addEventListener('click', () => {
  tabList.scrollBy({ left: 160, behavior: 'smooth' });
});

// Dropdown
function renderTabOverflowDropdown(): void {
  if (cachedTabsForOverflow.length === 0) {
    tabOverflowDropdown.innerHTML = '<div class="tab-overflow-empty">No tabs</div>';
    return;
  }
  tabOverflowDropdown.innerHTML = cachedTabsForOverflow.map(tab => {
    const isActive = tab.id === cachedActiveTabId;
    const title = tab.navigation?.title || tab.navigation?.url || 'New Tab';
    const shortTitle = title.length > 40 ? title.substring(0, 40) + '...' : title;
    const faviconHtml = tab.navigation?.favicon
      ? `<img class="overflow-tab-favicon" src="${escapeHtml(tab.navigation.favicon)}">`
      : '<span class="overflow-tab-dot"></span>';
    return `<div class="overflow-tab-item ${isActive ? 'active' : ''}" data-overflow-tab="${tab.id}">
      ${faviconHtml}
      <span class="overflow-tab-title">${escapeHtml(shortTitle)}</span>
      <span class="overflow-tab-id">${escapeHtml(tab.id.slice(-8))}</span>
    </div>`;
  }).join('');
}

let overflowOpen = false;
let lastShimmeredTabId = '';

function setOverflowOpen(open: boolean): void {
  overflowOpen = open;
  tabOverflowDropdown.style.display = open ? '' : 'none';
  btnTabOverflow.classList.toggle('active', open);
  if (open) {
    renderTabOverflowDropdown();
    // Notify bounds changed since panel pushes content down
    requestAnimationFrame(() => reportBrowserBounds());
  } else {
    requestAnimationFrame(() => reportBrowserBounds());
  }
}

btnTabOverflow.addEventListener('click', (e: Event) => {
  e.stopPropagation();
  setOverflowOpen(!overflowOpen);
});

tabOverflowDropdown.addEventListener('click', (e: Event) => {
  const target = e.target as HTMLElement;
  const item = target.closest('[data-overflow-tab]') as HTMLElement | null;
  if (item) {
    const tabId = item.getAttribute('data-overflow-tab')!;
    workspaceAPI?.actions.submit({ target: 'browser', kind: 'browser.activate-tab', payload: { tabId } });
    setOverflowOpen(false);
    // Scroll the activated tab into view
    requestAnimationFrame(() => {
      const tabEl = tabList.querySelector(`[data-tab-id="${tabId}"]`) as HTMLElement | null;
      if (tabEl) tabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    });
  }
});

// Close dropdown on outside click
document.addEventListener('click', () => {
  if (overflowOpen) {
    setOverflowOpen(false);
    btnTabOverflow.classList.remove('active');
  }
  if (tabContextMenu.style.display !== 'none') {
    hideTabContextMenu();
  }
});

// ─── Navigation Controls ────────────────────────────────────────────────────
btnBack.addEventListener('click', () => workspaceAPI?.actions.submit({ target: 'browser', kind: 'browser.back', payload: {} }));
btnForward.addEventListener('click', () => workspaceAPI?.actions.submit({ target: 'browser', kind: 'browser.forward', payload: {} }));
btnReload.addEventListener('click', () => workspaceAPI?.actions.submit({ target: 'browser', kind: 'browser.reload', payload: {} }));
btnStop.addEventListener('click', () => workspaceAPI?.actions.submit({ target: 'browser', kind: 'browser.stop', payload: {} }));

addressInput.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter') {
    const url = addressInput.value.trim();
    if (url) { workspaceAPI?.actions.submit({ target: 'browser', kind: 'browser.navigate', payload: { url } }); addressInput.blur(); }
  }
});
addressInput.addEventListener('focus', () => requestAnimationFrame(() => addressInput.select()));

// Bookmark
btnBookmark.addEventListener('click', () => {
  if (!lastBrowserState) return;
  const nav = lastBrowserState.navigation;
  if (nav.url) workspaceAPI?.browser.addBookmark(nav.url, nav.title || nav.url);
});
btnAttachBrowserHere.addEventListener('click', () => {
  const targetRole = lastBrowserState?.hostWindowRole === 'execution' ? 'command' : 'execution';
  void workspaceAPI?.browser.attachSurface(targetRole);
});

// Zoom
btnZoomIn.addEventListener('click', () => workspaceAPI?.browser.zoomIn());
btnZoomOut.addEventListener('click', () => workspaceAPI?.browser.zoomOut());
zoomLabel.addEventListener('click', () => workspaceAPI?.browser.zoomReset());

// DevTools
btnDevTools.addEventListener('click', () => workspaceAPI?.browser.toggleDevTools());

// ─── Find Bar ───────────────────────────────────────────────────────────────
function showFindBar(): void {
  findBar.style.display = 'flex';
  findInput.focus();
  reportBrowserBounds();
}
function hideFindBar(): void {
  findBar.style.display = 'none';
  workspaceAPI?.browser.stopFind();
  findInput.value = '';
  findCount.textContent = '0/0';
  reportBrowserBounds();
}

findInput.addEventListener('input', () => {
  const q = findInput.value;
  if (q) workspaceAPI?.browser.findInPage(q);
  else workspaceAPI?.browser.stopFind();
});
findInput.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter') { e.shiftKey ? workspaceAPI?.browser.findPrevious() : workspaceAPI?.browser.findNext(); }
  if (e.key === 'Escape') hideFindBar();
});
btnFindNext.addEventListener('click', () => workspaceAPI?.browser.findNext());
btnFindPrev.addEventListener('click', () => workspaceAPI?.browser.findPrevious());
btnFindClose.addEventListener('click', () => hideFindBar());

workspaceAPI?.browser.onFindUpdate((find: { activeMatch: number; totalMatches: number }) => {
  findCount.textContent = `${find.activeMatch}/${find.totalMatches}`;
});

// ─── Menu / Dropdown Panel ──────────────────────────────────────────────────
btnMenu.addEventListener('click', () => {
  if (dropdownPanel.style.display === 'none') {
    openPanel('history');
  } else {
    closePanel();
  }
});

function openPanel(panel: string): void {
  activePanel = panel;
  updateRecorderPanelRefreshTimer();
  dropdownPanel.style.display = 'flex';
  // Update tab active state
  dropdownPanel.querySelectorAll('.dropdown-tab').forEach(t => {
    (t as HTMLElement).classList.toggle('active', (t as HTMLElement).dataset.panel === panel);
  });
  if (panel === 'settings') {
    dropdownContent.innerHTML = '<div class="panel-empty">Loading settings...</div>';
    void refreshAuthDiagnostics().then(() => {
      if (activePanel === 'settings') renderPanel('settings');
    });
  } else if (panel === 'diagnostics') {
    dropdownContent.innerHTML = '<div class="panel-empty">Loading diagnostics...</div>';
    void refreshBrowserDiagnostics().then(() => {
      if (activePanel === 'diagnostics') renderPanel('diagnostics');
    });
  } else if (panel === 'recorder') {
    dropdownContent.innerHTML = '<div class="panel-empty">Loading recorder…</div>';
    void loadRecorderSources().then(() => {
      if (activePanel === 'recorder') renderPanel('recorder');
    });
  } else {
    renderPanel(panel);
  }
  reportBrowserBounds();
}

function closePanel(): void {
  activePanel = null;
  updateRecorderPanelRefreshTimer();
  dropdownPanel.style.display = 'none';
  reportBrowserBounds();
}

function openHeatmapTab(): void {
  workspaceAPI?.actions.submit({
    target: 'browser',
    kind: 'browser.create-tab',
    payload: { url: HEATMAP_INTERNAL_URL },
  });
  closePanel();
}

dropdownPanel.querySelector('.dropdown-tabs')!.addEventListener('click', (e: Event) => {
  const target = e.target as HTMLElement;
  if (target.dataset.panel) openPanel(target.dataset.panel);
});

function renderPanel(panel: string): void {
  if (!lastBrowserState) { dropdownContent.innerHTML = '<div class="panel-empty">Loading...</div>'; return; }
  const bs = lastBrowserState;

  if (panel === 'history') {
    const items = [...bs.history].reverse().slice(0, 100);
    if (items.length === 0) { dropdownContent.innerHTML = '<div class="panel-empty">No history</div>'; return; }
    dropdownContent.innerHTML = items.map(h => `
      <div class="panel-item" data-nav-url="${escapeHtml(h.url)}">
        ${h.favicon ? `<img class="item-favicon" src="${escapeHtml(h.favicon)}">` : '<span class="item-favicon"></span>'}
        <span class="item-title">${escapeHtml(h.title)}</span>
        <span class="item-time">${formatDate(h.visitedAt)} ${formatTimeShort(h.visitedAt)}</span>
      </div>
    `).join('');
  } else if (panel === 'bookmarks') {
    if (bs.bookmarks.length === 0) { dropdownContent.innerHTML = '<div class="panel-empty">No bookmarks</div>'; return; }
    dropdownContent.innerHTML = bs.bookmarks.map(b => `
      <div class="panel-item" data-nav-url="${escapeHtml(b.url)}">
        ${b.favicon ? `<img class="item-favicon" src="${escapeHtml(b.favicon)}">` : '<span class="item-favicon"></span>'}
        <span class="item-title">${escapeHtml(b.title)}</span>
        <span class="item-url">${escapeHtml(b.url)}</span>
        <button class="item-action" data-remove-bookmark="${b.id}">&#x2715;</button>
      </div>
    `).join('');
  } else if (panel === 'downloads') {
    const all = [...bs.activeDownloads, ...bs.completedDownloads];
    if (all.length === 0) { dropdownContent.innerHTML = '<div class="panel-empty">No downloads</div>'; return; }
    dropdownContent.innerHTML = all.map(d => {
      const pct = d.totalBytes > 0 ? Math.round((d.receivedBytes / d.totalBytes) * 100) : 0;
      const sizeStr = d.totalBytes > 0 ? `${(d.receivedBytes / 1048576).toFixed(1)} / ${(d.totalBytes / 1048576).toFixed(1)} MB` : '';
      return `<div class="panel-item">
        <span class="item-title">${escapeHtml(d.filename)}</span>
        ${d.state === 'progressing' ? `<div class="panel-dl-progress"><div class="panel-dl-progress-fill" style="width:${pct}%"></div></div><span class="item-time">${pct}%</span>` : `<span class="item-time">${d.state}</span>`}
        ${d.state === 'progressing' ? `<button class="item-action" data-cancel-download="${d.id}">&#x2715;</button>` : ''}
        <span class="item-url">${sizeStr}</span>
      </div>`;
    }).join('');
  } else if (panel === 'recorder') {
    renderRecorderPanel();
  } else if (panel === 'diagnostics') {
    try {
      const nav = bs.navigation;
      const consoleEvents = [...(lastDiagnosticsData.consoleEvents || [])]
        .filter((event: any) => ['error', 'warn'].includes(String(event?.level)))
        .slice(-20)
        .reverse();
      const problemNetworkEvents = [...(lastDiagnosticsData.networkEvents || [])]
        .filter((event: any) => String(event?.status) === 'failed' || (typeof event?.statusCode === 'number' && event.statusCode >= 400))
        .slice(-20)
        .reverse();
      const slowNetworkEvents = [...(lastDiagnosticsData.networkEvents || [])]
        .filter((event: any) => typeof event?.durationMs === 'number' && event.durationMs >= 750)
        .slice(-20)
        .reverse();
      const capturedLabel = lastDiagnosticsData.capturedAt ? `${formatDate(lastDiagnosticsData.capturedAt)} ${formatTimeShort(lastDiagnosticsData.capturedAt)}` : 'Not yet captured';
      dropdownContent.innerHTML = `
      <div class="diagnostics-block">
        <div class="diagnostics-title">Active Page</div>
        <div class="diagnostics-summary">${escapeHtml(nav.url || 'No active page')}</div>
        <div class="settings-actions-row">
          <button class="ext-load-btn" id="btnRefreshDiagnostics">Refresh Diagnostics</button>
          <button class="ext-load-btn" id="btnClearCurrentSiteData" ${nav.url ? '' : 'disabled'}>Clear Current Site Data</button>
        </div>
        <div class="diagnostics-summary">Snapshot: ${escapeHtml(capturedLabel)}</div>
      </div>
      <div class="diagnostics-block">
        <div class="diagnostics-title">Console Warnings / Errors</div>
        ${consoleEvents.length === 0
          ? '<div class="panel-empty">No recent console warnings or errors</div>'
          : consoleEvents.map((event: any) => `
              <div class="diagnostics-item ${escapeHtml(String(event.level || ''))}">
                <div class="diagnostics-item-head">
                  <span class="diagnostics-badge">${escapeHtml(String(event.level || 'log'))}</span>
                  <span class="diagnostics-meta">${escapeHtml(event.sourceId || 'inline')} : ${escapeHtml(String(event.lineNumber ?? 0))}</span>
                </div>
                <div class="diagnostics-message">${escapeHtml(String(event.message || ''))}</div>
              </div>
            `).join('')}
      </div>
      <div class="diagnostics-block">
        <div class="diagnostics-title">Failed / Problem Requests</div>
        ${problemNetworkEvents.length === 0
          ? '<div class="panel-empty">No recent failed or 4xx/5xx requests</div>'
          : problemNetworkEvents.map((event: any) => `
              <div class="diagnostics-item ${event.status === 'failed' || (typeof event.statusCode === 'number' && event.statusCode >= 500) ? 'error' : 'warn'}">
                <div class="diagnostics-item-head">
                  <span class="diagnostics-badge">${escapeHtml(String(event.method || 'GET'))} ${escapeHtml(String(event.statusCode ?? (event.status || 'unknown')))}${typeof event.durationMs === 'number' ? ` · ${formatNetworkDuration(event.durationMs)}` : ''}</span>
                  <span class="diagnostics-meta">${escapeHtml(String(event.resourceType || 'unknown'))}</span>
                </div>
                <div class="diagnostics-url">${escapeHtml(String(event.url || ''))}</div>
                ${event.error ? `<div class="diagnostics-message">${escapeHtml(String(event.error))}</div>` : ''}
                ${typeof event.responseSize === 'number' ? `<div class="diagnostics-message">Response size: ${escapeHtml(String(event.responseSize))} bytes${event.fromCache ? ' (cached)' : ''}</div>` : ''}
                ${typeof event.fromCache === 'boolean' && event.fromCache ? '<div class="diagnostics-message">Response served from cache</div>' : ''}
              </div>
            `).join('')}
      </div>
      <div class="diagnostics-block">
        <div class="diagnostics-title">Slow Requests (>= 750ms)</div>
        ${slowNetworkEvents.length === 0
          ? '<div class="panel-empty">No slow requests</div>'
          : slowNetworkEvents.map((event: any) => `
              <div class="diagnostics-item ${event.status === 'failed' ? 'error' : ''}">
                <div class="diagnostics-item-head">
                  <span class="diagnostics-badge">${escapeHtml(String(event.method || 'GET'))} ${escapeHtml(formatNetworkDuration(event.durationMs))}</span>
                  <span class="diagnostics-meta">${escapeHtml(String((event.statusCode ?? event.status) || 'unknown'))}</span>
                </div>
                <div class="diagnostics-meta">${escapeHtml(event.fromCache ? 'cached' : 'network')} · ${escapeHtml(String(event.resourceType || 'unknown'))}</div>
                <div class="diagnostics-url">${escapeHtml(String(event.url || ''))}</div>
              </div>
              `).join('')}
      </div>
    `;
    } catch {
      dropdownContent.innerHTML = '<div class="panel-empty">Diagnostics currently unavailable.</div>';
    }
  } else if (panel === 'extensions') {
    dropdownContent.innerHTML = bs.extensions.map(e => `
      <div class="ext-item">
        <span class="ext-name">${escapeHtml(e.name)}</span>
        <span class="ext-version">v${escapeHtml(e.version)}</span>
        <button class="item-action" data-remove-extension="${e.id}">&#x2715;</button>
      </div>
    `).join('') + `
      <div class="ext-load-row">
        <input type="text" class="ext-load-input" id="extPathInput" placeholder="Extension path...">
        <button class="ext-load-btn" id="btnLoadExt">Load</button>
      </div>
    `;
    if (bs.extensions.length === 0) {
      dropdownContent.insertAdjacentHTML('afterbegin', '<div class="panel-empty">No extensions loaded</div>');
    }
  } else if (panel === 'settings') {
    const s = bs.settings;
    dropdownContent.innerHTML = `
      <div class="settings-group">
        <div class="settings-label">General</div>
        <div class="settings-row"><label>Homepage</label><input type="text" id="settingsHomepage" value="${escapeHtml(s.homepage)}" style="width:200px"></div>
        <div class="settings-row"><label>Search Engine</label><select id="settingsSearchEngine">
          <option value="google" ${s.searchEngine === 'google' ? 'selected' : ''}>Google</option>
          <option value="duckduckgo" ${s.searchEngine === 'duckduckgo' ? 'selected' : ''}>DuckDuckGo</option>
          <option value="bing" ${s.searchEngine === 'bing' ? 'selected' : ''}>Bing</option>
        </select></div>
        <div class="settings-row"><label>Default Zoom</label><span>${Math.round(s.defaultZoom * 100)}%</span></div>
        <div class="settings-row settings-actions-row"><button class="ext-load-btn" id="btnOpenHeatmapTab">Open Heatmap</button></div>
      </div>
      <div class="settings-group">
        <div class="settings-label">Content</div>
        <div class="settings-row"><label>Mode</label><select id="settingsContentMode">
          <option value="strict-clean" ${s.contentMode === 'strict-clean' ? 'selected' : ''}>Strict clean (Recommended)</option>
          <option value="compatibility" ${s.contentMode === 'compatibility' ? 'selected' : ''}>Compatibility</option>
        </select></div>
        <div class="settings-row"><label>JavaScript</label><button class="settings-toggle ${s.javascript ? 'on' : ''}" data-setting="javascript"></button></div>
        <div class="settings-row"><label>Images</label><button class="settings-toggle ${s.images ? 'on' : ''}" data-setting="images"></button></div>
        <div class="settings-row"><label>Pop-ups</label><button class="settings-toggle ${s.popups ? 'on' : ''}" data-setting="popups"></button></div>
      </div>
      <div class="settings-group">
        <div class="settings-label">Auth & Sessions</div>
        <div class="settings-row"><label>Import Chrome Sessions On Start</label><button class="settings-toggle ${s.importChromeCookies ? 'on' : ''}" data-setting="importChromeCookies"></button></div>
        <div class="settings-row settings-row-stack"><label>Google Auth Compatibility</label><span class="settings-note">${lastAuthDiagnostics?.googleAuthCompatibilityActive ? 'Active' : 'Off'}</span></div>
        <div class="settings-row settings-row-stack"><label>Active UA</label><span class="settings-note">${lastAuthDiagnostics ? (lastAuthDiagnostics.activeTabHasElectronUA ? 'Contains Electron token' : 'Chromium-style') : 'Loading...'}</span></div>
        <div class="settings-row settings-row-stack"><label>Cookies In Session</label><span class="settings-note">${lastAuthDiagnostics ? `${lastAuthDiagnostics.totalCookies} total, ${lastAuthDiagnostics.googleCookieCount} Google-family` : 'Loading...'}</span></div>
        <div class="settings-row settings-row-stack"><label>Last Google CookieMismatch</label><span class="settings-note">${formatNullableTime(lastAuthDiagnostics?.lastGoogleCookieMismatchAt ?? null)}</span></div>
        <div class="settings-row settings-actions-row">
          <button class="ext-load-btn" id="btnRefreshAuthDiagnostics">Refresh Diagnostics</button>
          <button class="ext-load-btn" id="btnReimportCookies">Reimport Chrome Sessions</button>
          <button class="ext-load-btn" id="btnClearGoogleAuthState">Clear Google Auth State</button>
        </div>
      </div>
      <div class="settings-group">
        <div class="settings-label">Data</div>
        <div class="settings-row"><button class="ext-load-btn" id="btnClearHistory">Clear History</button><button class="ext-load-btn" id="btnClearData">Clear All Data</button></div>
      </div>
    `;
  }
}

// Delegated click handler for panel actions
dropdownContent.addEventListener('click', (e: Event) => {
  const target = e.target as HTMLElement;

  // Navigate to URL
  const navItem = target.closest('[data-nav-url]') as HTMLElement | null;
  if (navItem && !target.hasAttribute('data-remove-bookmark')) {
    workspaceAPI?.actions.submit({ target: 'browser', kind: 'browser.navigate', payload: { url: navItem.dataset.navUrl! } });
    closePanel();
    return;
  }

  // Remove bookmark
  const rmBm = target.getAttribute('data-remove-bookmark');
  if (rmBm) { workspaceAPI?.browser.removeBookmark(rmBm); return; }

  // Cancel download
  const cancelDl = target.getAttribute('data-cancel-download');
  if (cancelDl) { workspaceAPI?.browser.cancelDownload(cancelDl); return; }

  // Remove extension
  const rmExt = target.getAttribute('data-remove-extension');
  if (rmExt) { workspaceAPI?.browser.removeExtension(rmExt); return; }

  // Load extension
  if (target.id === 'btnLoadExt') {
    const input = document.getElementById('extPathInput') as HTMLInputElement;
    if (input && input.value.trim()) {
      workspaceAPI?.browser.loadExtension(input.value.trim());
      input.value = '';
    }
    return;
  }

  if (target.id === 'btnRecorderRefreshSources') {
    void loadRecorderSources(true);
    return;
  }

  if (target.id === 'btnRecorderStart') {
    void startRecorderSession();
    return;
  }

  if (target.id === 'btnRecorderStop') {
    void stopRecorderSession();
    return;
  }

  if (target.id === 'btnRecorderSelectAll') {
    recorderState.selectedSourceIds = new Set(recorderState.sources.map((source) => source.id));
    if (activePanel === 'recorder') renderPanel('recorder');
    return;
  }

  if (target.id === 'btnRecorderClearAll') {
    recorderState.selectedSourceIds = new Set<string>();
    if (activePanel === 'recorder') renderPanel('recorder');
    return;
  }

  // Settings toggles
  const settingKey = target.getAttribute('data-setting');
  if (settingKey && lastBrowserState) {
    const current = (lastBrowserState.settings as any)[settingKey];
    workspaceAPI?.browser.updateSettings({ [settingKey]: !current });
    return;
  }

  // Clear buttons
  if (target.id === 'btnClearHistory') { workspaceAPI?.browser.clearHistory(); return; }
  if (target.id === 'btnClearData') { workspaceAPI?.browser.clearData(); return; }
  if (target.id === 'btnOpenHeatmapTab') { openHeatmapTab(); return; }
  if (target.id === 'btnRefreshDiagnostics') {
    void refreshBrowserDiagnostics().then(() => {
      if (activePanel === 'diagnostics') renderPanel('diagnostics');
    });
    return;
  }
  if (target.id === 'btnClearCurrentSiteData') {
    const origin = lastBrowserState?.navigation?.url || '';
    void workspaceAPI?.browser.clearSiteData(origin).then((result) => {
      void workspaceAPI?.addLog('info', 'browser', `Cleared current site data for ${result.origin} (${result.cookiesCleared} cookies removed)`);
      return refreshBrowserDiagnostics();
    }).then(() => {
      if (activePanel === 'diagnostics') renderPanel('diagnostics');
    });
    return;
  }
  if (target.id === 'btnRefreshAuthDiagnostics') {
    void refreshAuthDiagnostics().then(() => {
      if (activePanel === 'settings') renderPanel('settings');
    });
    return;
  }
  if (target.id === 'btnReimportCookies') {
    void workspaceAPI?.browser.reimportCookies().then((result) => {
      void workspaceAPI?.addLog('info', 'browser', `Chrome session import completed: ${result.imported} imported, ${result.failed} failed`);
      return refreshAuthDiagnostics();
    }).then(() => {
      if (activePanel === 'settings') renderPanel('settings');
    });
    return;
  }
  if (target.id === 'btnClearGoogleAuthState') {
    void workspaceAPI?.browser.clearGoogleAuthState().then((result) => {
      void workspaceAPI?.addLog('info', 'browser', `Cleared ${result.cleared} Google-family cookies from the app session`);
      return refreshAuthDiagnostics();
    }).then(() => {
      if (activePanel === 'settings') renderPanel('settings');
    });
    return;
  }
});

// Settings text inputs
dropdownContent.addEventListener('change', (e: Event) => {
  const target = e.target as HTMLElement;
  if (target.id === 'settingsHomepage') {
    workspaceAPI?.browser.updateSettings({ homepage: (target as HTMLInputElement).value });
  }
  if (target.id === 'settingsSearchEngine') {
    workspaceAPI?.browser.updateSettings({ searchEngine: (target as HTMLSelectElement).value as any });
  }
  if (target.id === 'settingsContentMode') {
    workspaceAPI?.browser.updateSettings({ contentMode: (target as HTMLSelectElement).value as 'strict-clean' | 'compatibility' });
  }

  const recorderCheckbox = target.closest('[data-recorder-source-id]') as HTMLInputElement | null;
  if (recorderCheckbox) {
    const sourceId = recorderCheckbox.getAttribute('data-recorder-source-id') || '';
    if (sourceId) {
      if (recorderCheckbox.checked) recorderState.selectedSourceIds.add(sourceId);
      else recorderState.selectedSourceIds.delete(sourceId);
      if (activePanel === 'recorder') renderPanel('recorder');
    }
  }
});

// ─── Browser State Updates ──────────────────────────────────────────────────
function updateBrowserState(state: BrowserState): void {
  lastBrowserState = state;
  setExecutionBrowserAttached(state.hostWindowRole === 'execution');
  renderTabs(
    state.tabs,
    state.activeTabId,
    state.splitLeftTabId,
    state.splitRightTabId,
  );

  const nav = state.navigation;
  browserSurfaceArea.classList.remove('split-active-left', 'split-active-right');
  if (state.splitLeftTabId && state.splitRightTabId) {
    if (state.activeTabId === state.splitLeftTabId) {
      browserSurfaceArea.classList.add('split-active-left');
    } else if (state.activeTabId === state.splitRightTabId) {
      browserSurfaceArea.classList.add('split-active-right');
    }
  }
  if (document.activeElement !== addressInput) addressInput.value = nav.url;
  btnBack.disabled = !nav.canGoBack;
  btnForward.disabled = !nav.canGoForward;

  if (nav.isLoading) {
    btnReload.style.display = 'none'; btnStop.style.display = '';
  } else {
    btnReload.style.display = ''; btnStop.style.display = 'none';
  }

  // Zoom
  const activeTab = state.tabs.find(t => t.id === state.activeTabId);
  const zoom = activeTab ? activeTab.zoomLevel : 1;
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;

  // Bookmark indicator
  const isBookmarked = state.bookmarks.some(b => b.url === nav.url);
  btnBookmark.textContent = isBookmarked ? '\u2605' : '\u2606';
  btnBookmark.title = isBookmarked ? 'Bookmarked' : 'Bookmark this page';

  // Only downloads needs live repaint from browser state churn.
  if (activePanel === 'downloads') renderPanel(activePanel);
}

workspaceAPI?.browser.onNavUpdate((nav: BrowserNavigationState) => {
  if (!lastBrowserState) return;
  lastBrowserState.navigation = nav;
  if (document.activeElement !== addressInput) addressInput.value = nav.url;
  btnBack.disabled = !nav.canGoBack;
  btnForward.disabled = !nav.canGoForward;
  if (nav.isLoading) { btnReload.style.display = 'none'; btnStop.style.display = ''; }
  else { btnReload.style.display = ''; btnStop.style.display = 'none'; }
});

workspaceAPI?.browser.onStateUpdate((state: BrowserState) => { updateBrowserState(state); });

// ─── State Sync ────────────────────────────────────────────────────────────
function renderState(state: any): void {
  const attached = Boolean(state.browser?.layout?.executionAttached ?? browserAttachedToExecution);
  if (attached !== browserAttachedToExecution) setExecutionBrowserAttached(attached);
}
workspaceAPI?.onStateUpdate((state: any) => renderState(state));

// ─── Keyboard Shortcuts ────────────────────────────────────────────────────
document.addEventListener('keydown', (e: KeyboardEvent) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === 'l') { e.preventDefault(); addressInput.focus(); addressInput.select(); }
  if (mod && e.key === 't') { e.preventDefault(); workspaceAPI?.actions.submit({ target: 'browser', kind: 'browser.create-tab', payload: {} }); }
  if (mod && e.key === 'w') { e.preventDefault(); if (lastBrowserState) workspaceAPI?.actions.submit({ target: 'browser', kind: 'browser.close-tab', payload: { tabId: lastBrowserState.activeTabId } }); }
  if (mod && e.key === 'f') { e.preventDefault(); showFindBar(); }
  if (mod && e.key === '=') { e.preventDefault(); workspaceAPI?.browser.zoomIn(); }
  if (mod && e.key === '-') { e.preventDefault(); workspaceAPI?.browser.zoomOut(); }
  if (mod && e.key === '0') { e.preventDefault(); workspaceAPI?.browser.zoomReset(); }
  if (mod && e.key === 'd') { e.preventDefault(); if (lastBrowserState) workspaceAPI?.browser.addBookmark(lastBrowserState.navigation.url, lastBrowserState.navigation.title); }
  if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); workspaceAPI?.actions.submit({ target: 'browser', kind: 'browser.back', payload: {} }); }
  if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); workspaceAPI?.actions.submit({ target: 'browser', kind: 'browser.forward', payload: {} }); }
  if (e.key === 'F5') { e.preventDefault(); workspaceAPI?.actions.submit({ target: 'browser', kind: 'browser.reload', payload: {} }); }
  if (e.key === 'F12') { e.preventDefault(); workspaceAPI?.browser.toggleDevTools(); }
  if (e.key === 'Escape') { if (findBar.style.display !== 'none') hideFindBar(); if (activePanel) closePanel(); }
});

// ─── Init ───────────────────────────────────────────────────────────────────
function initBrowserBoundsObserver(): void {
  new ResizeObserver(() => reportBrowserBounds()).observe(browserSurfaceArea);
  window.addEventListener('resize', () => reportBrowserBounds());
}

async function init(): Promise<void> {
  if (!workspaceAPI) {
    console.error('[execution] workspaceAPI is not available; browser controls are disabled.');
    return;
  }
  initBrowserBoundsObserver();
  const state = await workspaceAPI.getState();
  renderState(state);
  const bs = await workspaceAPI.browser.getState();
  updateBrowserState(bs);
  requestAnimationFrame(() => { reportBrowserBounds(); });
  workspaceAPI.addLog('info', 'system', 'Execution window initialized');
}
init().catch((error: unknown) => {
  console.error('[execution] Failed to initialize execution renderer:', error);
});
