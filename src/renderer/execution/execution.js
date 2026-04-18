"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const utils_js_1 = require("../shared/utils.js");
const workspaceAPI = window.workspaceAPI;
// ─── DOM ────────────────────────────────────────────────────────────────────
const browserPane = document.getElementById('browserPane');
const tabBar = document.getElementById('tabBar');
const tabList = document.getElementById('tabList');
const tabScrollLeft = document.getElementById('tabScrollLeft');
const tabScrollRight = document.getElementById('tabScrollRight');
const btnTabOverflow = document.getElementById('btnTabOverflow');
const tabOverflowDropdown = document.getElementById('tabOverflowDropdown');
const btnNewTab = document.getElementById('btnNewTab');
const tabContextMenu = document.getElementById('tabContextMenu');
const addressInput = document.getElementById('addressInput');
const btnBack = document.getElementById('btnBack');
const btnForward = document.getElementById('btnForward');
const btnReload = document.getElementById('btnReload');
const btnStop = document.getElementById('btnStop');
const btnBookmark = document.getElementById('btnBookmark');
const btnZoomIn = document.getElementById('btnZoomIn');
const btnZoomOut = document.getElementById('btnZoomOut');
const zoomLabel = document.getElementById('zoomLabel');
const btnDevTools = document.getElementById('btnDevTools');
const btnMenu = document.getElementById('btnMenu');
const findBar = document.getElementById('findBar');
const findInput = document.getElementById('findInput');
const findCount = document.getElementById('findCount');
const btnFindPrev = document.getElementById('btnFindPrev');
const btnFindNext = document.getElementById('btnFindNext');
const btnFindClose = document.getElementById('btnFindClose');
const dropdownPanel = document.getElementById('dropdownPanel');
const dropdownContent = document.getElementById('dropdownContent');
const browserSurfaceArea = document.getElementById('browserSurfaceArea');
const terminalPane = document.getElementById('terminalPane');
const splitter = document.getElementById('splitter');
const terminalStatus = document.getElementById('terminalStatus');
const terminalMeta = document.getElementById('terminalMeta');
const termCollapseBtn = document.getElementById('termCollapseBtn');
const termRestartBtn = document.getElementById('termRestartBtn');
const terminalContainer = document.getElementById('terminalContainer');
const connectionDot = document.getElementById('connectionDot');
const connectionLabel = document.getElementById('connectionLabel');
const termSizeLabel = document.getElementById('termSizeLabel');
const splitLabel = document.getElementById('splitLabel');
// ─── State ──────────────────────────────────────────────────────────────────
let term = null;
window.__term = () => term;
let fitAddon = null;
let resizeTimer = null;
let boundsTimer = null;
let currentRatio = 0.5;
let splitMeasureAttempts = 0;
const DEFAULT_TERMINAL_COLLAPSED = true;
let terminalCollapsed = DEFAULT_TERMINAL_COLLAPSED;
let isDragging = false;
let activePanel = null;
let lastBrowserState = null;
let lastAuthDiagnostics = null;
let activeContextTabId = '';
let lastDiagnosticsData = {
    consoleEvents: [],
    networkEvents: [],
    capturedAt: null,
};
// CSP blocks inline `onerror` handlers, so favicon failures are handled here.
document.addEventListener('error', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLImageElement))
        return;
    if (!target.matches('.tab-favicon, .overflow-tab-favicon, .item-favicon'))
        return;
    target.style.display = 'none';
}, true);
function formatNetworkDuration(ms) {
    if (typeof ms !== 'number' || !Number.isFinite(ms))
        return 'Unknown';
    if (ms < 1000)
        return `${Math.round(ms)} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
}
async function refreshAuthDiagnostics() {
    if (!workspaceAPI) {
        lastAuthDiagnostics = null;
        return;
    }
    try {
        lastAuthDiagnostics = await workspaceAPI.browser.getAuthDiagnostics();
    }
    catch {
        lastAuthDiagnostics = null;
    }
}
async function refreshBrowserDiagnostics() {
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
    }
    catch {
        lastDiagnosticsData = { consoleEvents: [], networkEvents: [], capturedAt: Date.now() };
    }
}
// ─── Browser Bounds ─────────────────────────────────────────────────────────
function reportBrowserBounds() {
    if (boundsTimer)
        clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
        if (!workspaceAPI)
            return;
        const rect = browserSurfaceArea.getBoundingClientRect();
        workspaceAPI.browser.reportBounds({
            x: Math.round(rect.left), y: Math.round(rect.top),
            width: Math.round(rect.width), height: Math.round(rect.height),
        });
        boundsTimer = null;
    }, 50);
}
// ─── Tabs ───────────────────────────────────────────────────────────────────
function getTabsDataRenderKey(tabs) {
    return tabs.map((tab) => [
        tab.id,
        tab.navigation?.title || '',
        tab.navigation?.url || '',
        tab.navigation?.favicon || '',
        tab.status || '',
    ].join('|')).join('||');
}
function getTabsSelectionRenderKey(activeTabId, splitLeftTabId, splitRightTabId) {
    return `${activeTabId}::${splitLeftTabId || ''}::${splitRightTabId || ''}`;
}
function updateTabSelectionClasses(activeTabId, splitLeftTabId, splitRightTabId, shouldPlayShimmer) {
    const tabElements = tabList.querySelectorAll('.browser-tab');
    for (const node of tabElements) {
        const tabEl = node;
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
function renderTabs(tabs, activeTabId, splitLeftTabId, splitRightTabId) {
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
                ? `<img class="tab-favicon" src="${(0, utils_js_1.escapeHtml)(tab.navigation.favicon)}">`
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
        <span class="tab-title">${(0, utils_js_1.escapeHtml)(title.substring(0, 40))}</span>
        <button class="tab-close" data-close-tab="${tab.id}">&#x2715;</button>
      </div>`;
        }).join('');
        lastRenderedTabsDataKey = tabsDataKey;
        lastRenderedTabCount = tabs.length;
    }
    else if (shouldUpdateSelection) {
        updateTabSelectionClasses(activeTabId, splitLeftTabId, splitRightTabId, shouldPlayShimmer);
    }
    if (shouldUpdateSelection) {
        lastRenderedTabsSelectionKey = selectionKey;
        lastRenderedActiveTabId = activeTabId;
        lastShimmeredTabId = activeTabId;
    }
    const needsLayoutPass = shouldRender || shouldScrollActiveTab || btnNewTab.parentElement !== tabList;
    const shouldRefreshOverflowDropdown = overflowOpen && (shouldRender || shouldUpdateSelection);
    if (!needsLayoutPass && !shouldRefreshOverflowDropdown)
        return;
    requestAnimationFrame(() => {
        if (btnNewTab.parentElement !== tabList) {
            btnNewTab.style.display = 'inline-flex';
            tabList.append(btnNewTab);
        }
        if (shouldScrollActiveTab) {
            const activeTab = tabList.querySelector(`[data-tab-id="${activeTabId}"]`);
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
tabList.addEventListener('click', (e) => {
    const target = e.target;
    const closeId = target.getAttribute('data-close-tab') || target.closest('[data-close-tab]')?.getAttribute('data-close-tab');
    if (closeId) {
        e.stopPropagation();
        workspaceAPI?.actions.submit({ target: 'browser', kind: 'browser.close-tab', payload: { tabId: closeId } });
        return;
    }
    const tabEl = target.closest('.browser-tab');
    if (tabEl)
        workspaceAPI?.actions.submit({ target: 'browser', kind: 'browser.activate-tab', payload: { tabId: tabEl.dataset.tabId } });
});
function hideTabContextMenu() {
    tabContextMenu.style.display = 'none';
    tabContextMenu.classList.remove('open');
    activeContextTabId = '';
    requestAnimationFrame(() => reportBrowserBounds());
}
function showTabContextMenu(x, y, tabId) {
    activeContextTabId = tabId;
    const rect = tabBar.getBoundingClientRect();
    tabContextMenu.style.left = `${Math.max(0, x - rect.left)}px`;
    tabContextMenu.style.top = `${Math.max(0, y - rect.top)}px`;
    tabContextMenu.style.display = 'flex';
    tabContextMenu.classList.add('open');
    requestAnimationFrame(() => reportBrowserBounds());
}
tabList.addEventListener('contextmenu', (e) => {
    const target = e.target;
    const tabEl = target.closest('.browser-tab');
    if (!tabEl) {
        hideTabContextMenu();
        return;
    }
    e.preventDefault();
    const tabId = tabEl.dataset.tabId;
    if (!tabId)
        return;
    showTabContextMenu(e.clientX, e.clientY, tabId);
});
btnNewTab.addEventListener('click', () => workspaceAPI?.actions.submit({ target: 'browser', kind: 'browser.create-tab', payload: {} }));
tabContextMenu.addEventListener('click', (e) => {
    const target = e.target;
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
let cachedTabsForOverflow = [];
let cachedActiveTabId = '';
let lastRenderedTabsDataKey = '';
let lastRenderedTabsSelectionKey = '';
let lastRenderedActiveTabId = '';
let lastRenderedTabCount = 0;
function updateTabOverflow() {
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
function renderTabOverflowDropdown() {
    if (cachedTabsForOverflow.length === 0) {
        tabOverflowDropdown.innerHTML = '<div class="tab-overflow-empty">No tabs</div>';
        return;
    }
    tabOverflowDropdown.innerHTML = cachedTabsForOverflow.map(tab => {
        const isActive = tab.id === cachedActiveTabId;
        const title = tab.navigation?.title || tab.navigation?.url || 'New Tab';
        const shortTitle = title.length > 40 ? title.substring(0, 40) + '...' : title;
        const faviconHtml = tab.navigation?.favicon
            ? `<img class="overflow-tab-favicon" src="${(0, utils_js_1.escapeHtml)(tab.navigation.favicon)}">`
            : '<span class="overflow-tab-dot"></span>';
        return `<div class="overflow-tab-item ${isActive ? 'active' : ''}" data-overflow-tab="${tab.id}">
      ${faviconHtml}
      <span class="overflow-tab-title">${(0, utils_js_1.escapeHtml)(shortTitle)}</span>
      <span class="overflow-tab-id">${(0, utils_js_1.escapeHtml)(tab.id.slice(-8))}</span>
    </div>`;
    }).join('');
}
let overflowOpen = false;
let lastShimmeredTabId = '';
function setOverflowOpen(open) {
    overflowOpen = open;
    tabOverflowDropdown.style.display = open ? '' : 'none';
    btnTabOverflow.classList.toggle('active', open);
    if (open) {
        renderTabOverflowDropdown();
        // Notify bounds changed since panel pushes content down
        requestAnimationFrame(() => reportBrowserBounds());
    }
    else {
        requestAnimationFrame(() => reportBrowserBounds());
    }
}
btnTabOverflow.addEventListener('click', (e) => {
    e.stopPropagation();
    setOverflowOpen(!overflowOpen);
});
tabOverflowDropdown.addEventListener('click', (e) => {
    const target = e.target;
    const item = target.closest('[data-overflow-tab]');
    if (item) {
        const tabId = item.getAttribute('data-overflow-tab');
        workspaceAPI?.actions.submit({ target: 'browser', kind: 'browser.activate-tab', payload: { tabId } });
        setOverflowOpen(false);
        // Scroll the activated tab into view
        requestAnimationFrame(() => {
            const tabEl = tabList.querySelector(`[data-tab-id="${tabId}"]`);
            if (tabEl)
                tabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
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
addressInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const url = addressInput.value.trim();
        if (url) {
            workspaceAPI?.actions.submit({ target: 'browser', kind: 'browser.navigate', payload: { url } });
            addressInput.blur();
        }
    }
});
addressInput.addEventListener('focus', () => requestAnimationFrame(() => addressInput.select()));
// Bookmark
btnBookmark.addEventListener('click', () => {
    if (!lastBrowserState)
        return;
    const nav = lastBrowserState.navigation;
    if (nav.url)
        workspaceAPI?.browser.addBookmark(nav.url, nav.title || nav.url);
});
// Zoom
btnZoomIn.addEventListener('click', () => workspaceAPI?.browser.zoomIn());
btnZoomOut.addEventListener('click', () => workspaceAPI?.browser.zoomOut());
zoomLabel.addEventListener('click', () => workspaceAPI?.browser.zoomReset());
// DevTools
btnDevTools.addEventListener('click', () => workspaceAPI?.browser.toggleDevTools());
// ─── Find Bar ───────────────────────────────────────────────────────────────
function showFindBar() {
    findBar.style.display = 'flex';
    findInput.focus();
    reportBrowserBounds();
}
function hideFindBar() {
    findBar.style.display = 'none';
    workspaceAPI?.browser.stopFind();
    findInput.value = '';
    findCount.textContent = '0/0';
    reportBrowserBounds();
}
findInput.addEventListener('input', () => {
    const q = findInput.value;
    if (q)
        workspaceAPI?.browser.findInPage(q);
    else
        workspaceAPI?.browser.stopFind();
});
findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.shiftKey ? workspaceAPI?.browser.findPrevious() : workspaceAPI?.browser.findNext();
    }
    if (e.key === 'Escape')
        hideFindBar();
});
btnFindNext.addEventListener('click', () => workspaceAPI?.browser.findNext());
btnFindPrev.addEventListener('click', () => workspaceAPI?.browser.findPrevious());
btnFindClose.addEventListener('click', () => hideFindBar());
workspaceAPI?.browser.onFindUpdate((find) => {
    findCount.textContent = `${find.activeMatch}/${find.totalMatches}`;
});
// ─── Menu / Dropdown Panel ──────────────────────────────────────────────────
btnMenu.addEventListener('click', () => {
    if (dropdownPanel.style.display === 'none') {
        openPanel('history');
    }
    else {
        closePanel();
    }
});
function openPanel(panel) {
    activePanel = panel;
    dropdownPanel.style.display = 'flex';
    // Update tab active state
    dropdownPanel.querySelectorAll('.dropdown-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.panel === panel);
    });
    if (panel === 'settings') {
        dropdownContent.innerHTML = '<div class="panel-empty">Loading settings...</div>';
        void refreshAuthDiagnostics().then(() => {
            if (activePanel === 'settings')
                renderPanel('settings');
        });
    }
    else if (panel === 'diagnostics') {
        dropdownContent.innerHTML = '<div class="panel-empty">Loading diagnostics...</div>';
        void refreshBrowserDiagnostics().then(() => {
            if (activePanel === 'diagnostics')
                renderPanel('diagnostics');
        });
    }
    else {
        renderPanel(panel);
    }
    reportBrowserBounds();
}
function closePanel() {
    activePanel = null;
    dropdownPanel.style.display = 'none';
    reportBrowserBounds();
}
dropdownPanel.querySelector('.dropdown-tabs').addEventListener('click', (e) => {
    const target = e.target;
    if (target.dataset.panel)
        openPanel(target.dataset.panel);
});
function renderPanel(panel) {
    if (!lastBrowserState) {
        dropdownContent.innerHTML = '<div class="panel-empty">Loading...</div>';
        return;
    }
    const bs = lastBrowserState;
    if (panel === 'history') {
        const items = [...bs.history].reverse().slice(0, 100);
        if (items.length === 0) {
            dropdownContent.innerHTML = '<div class="panel-empty">No history</div>';
            return;
        }
        dropdownContent.innerHTML = items.map(h => `
      <div class="panel-item" data-nav-url="${(0, utils_js_1.escapeHtml)(h.url)}">
        ${h.favicon ? `<img class="item-favicon" src="${(0, utils_js_1.escapeHtml)(h.favicon)}">` : '<span class="item-favicon"></span>'}
        <span class="item-title">${(0, utils_js_1.escapeHtml)(h.title)}</span>
        <span class="item-time">${(0, utils_js_1.formatDate)(h.visitedAt)} ${(0, utils_js_1.formatTimeShort)(h.visitedAt)}</span>
      </div>
    `).join('');
    }
    else if (panel === 'bookmarks') {
        if (bs.bookmarks.length === 0) {
            dropdownContent.innerHTML = '<div class="panel-empty">No bookmarks</div>';
            return;
        }
        dropdownContent.innerHTML = bs.bookmarks.map(b => `
      <div class="panel-item" data-nav-url="${(0, utils_js_1.escapeHtml)(b.url)}">
        ${b.favicon ? `<img class="item-favicon" src="${(0, utils_js_1.escapeHtml)(b.favicon)}">` : '<span class="item-favicon"></span>'}
        <span class="item-title">${(0, utils_js_1.escapeHtml)(b.title)}</span>
        <span class="item-url">${(0, utils_js_1.escapeHtml)(b.url)}</span>
        <button class="item-action" data-remove-bookmark="${b.id}">&#x2715;</button>
      </div>
    `).join('');
    }
    else if (panel === 'downloads') {
        const all = [...bs.activeDownloads, ...bs.completedDownloads];
        if (all.length === 0) {
            dropdownContent.innerHTML = '<div class="panel-empty">No downloads</div>';
            return;
        }
        dropdownContent.innerHTML = all.map(d => {
            const pct = d.totalBytes > 0 ? Math.round((d.receivedBytes / d.totalBytes) * 100) : 0;
            const sizeStr = d.totalBytes > 0 ? `${(d.receivedBytes / 1048576).toFixed(1)} / ${(d.totalBytes / 1048576).toFixed(1)} MB` : '';
            return `<div class="panel-item">
        <span class="item-title">${(0, utils_js_1.escapeHtml)(d.filename)}</span>
        ${d.state === 'progressing' ? `<div class="panel-dl-progress"><div class="panel-dl-progress-fill" style="width:${pct}%"></div></div><span class="item-time">${pct}%</span>` : `<span class="item-time">${d.state}</span>`}
        ${d.state === 'progressing' ? `<button class="item-action" data-cancel-download="${d.id}">&#x2715;</button>` : ''}
        <span class="item-url">${sizeStr}</span>
      </div>`;
        }).join('');
    }
    else if (panel === 'diagnostics') {
        try {
            const nav = bs.navigation;
            const consoleEvents = [...(lastDiagnosticsData.consoleEvents || [])]
                .filter((event) => ['error', 'warn'].includes(String(event?.level)))
                .slice(-20)
                .reverse();
            const problemNetworkEvents = [...(lastDiagnosticsData.networkEvents || [])]
                .filter((event) => String(event?.status) === 'failed' || (typeof event?.statusCode === 'number' && event.statusCode >= 400))
                .slice(-20)
                .reverse();
            const slowNetworkEvents = [...(lastDiagnosticsData.networkEvents || [])]
                .filter((event) => typeof event?.durationMs === 'number' && event.durationMs >= 750)
                .slice(-20)
                .reverse();
            const capturedLabel = lastDiagnosticsData.capturedAt ? `${(0, utils_js_1.formatDate)(lastDiagnosticsData.capturedAt)} ${(0, utils_js_1.formatTimeShort)(lastDiagnosticsData.capturedAt)}` : 'Not yet captured';
            dropdownContent.innerHTML = `
      <div class="diagnostics-block">
        <div class="diagnostics-title">Active Page</div>
        <div class="diagnostics-summary">${(0, utils_js_1.escapeHtml)(nav.url || 'No active page')}</div>
        <div class="settings-actions-row">
          <button class="ext-load-btn" id="btnRefreshDiagnostics">Refresh Diagnostics</button>
          <button class="ext-load-btn" id="btnClearCurrentSiteData" ${nav.url ? '' : 'disabled'}>Clear Current Site Data</button>
        </div>
        <div class="diagnostics-summary">Snapshot: ${(0, utils_js_1.escapeHtml)(capturedLabel)}</div>
      </div>
      <div class="diagnostics-block">
        <div class="diagnostics-title">Console Warnings / Errors</div>
        ${consoleEvents.length === 0
                ? '<div class="panel-empty">No recent console warnings or errors</div>'
                : consoleEvents.map((event) => `
              <div class="diagnostics-item ${(0, utils_js_1.escapeHtml)(String(event.level || ''))}">
                <div class="diagnostics-item-head">
                  <span class="diagnostics-badge">${(0, utils_js_1.escapeHtml)(String(event.level || 'log'))}</span>
                  <span class="diagnostics-meta">${(0, utils_js_1.escapeHtml)(event.sourceId || 'inline')} : ${(0, utils_js_1.escapeHtml)(String(event.lineNumber ?? 0))}</span>
                </div>
                <div class="diagnostics-message">${(0, utils_js_1.escapeHtml)(String(event.message || ''))}</div>
              </div>
            `).join('')}
      </div>
      <div class="diagnostics-block">
        <div class="diagnostics-title">Failed / Problem Requests</div>
        ${problemNetworkEvents.length === 0
                ? '<div class="panel-empty">No recent failed or 4xx/5xx requests</div>'
                : problemNetworkEvents.map((event) => `
              <div class="diagnostics-item ${event.status === 'failed' || (typeof event.statusCode === 'number' && event.statusCode >= 500) ? 'error' : 'warn'}">
                <div class="diagnostics-item-head">
                  <span class="diagnostics-badge">${(0, utils_js_1.escapeHtml)(String(event.method || 'GET'))} ${(0, utils_js_1.escapeHtml)(String(event.statusCode ?? (event.status || 'unknown')))}${typeof event.durationMs === 'number' ? ` · ${formatNetworkDuration(event.durationMs)}` : ''}</span>
                  <span class="diagnostics-meta">${(0, utils_js_1.escapeHtml)(String(event.resourceType || 'unknown'))}</span>
                </div>
                <div class="diagnostics-url">${(0, utils_js_1.escapeHtml)(String(event.url || ''))}</div>
                ${event.error ? `<div class="diagnostics-message">${(0, utils_js_1.escapeHtml)(String(event.error))}</div>` : ''}
                ${typeof event.responseSize === 'number' ? `<div class="diagnostics-message">Response size: ${(0, utils_js_1.escapeHtml)(String(event.responseSize))} bytes${event.fromCache ? ' (cached)' : ''}</div>` : ''}
                ${typeof event.fromCache === 'boolean' && event.fromCache ? '<div class="diagnostics-message">Response served from cache</div>' : ''}
              </div>
            `).join('')}
      </div>
      <div class="diagnostics-block">
        <div class="diagnostics-title">Slow Requests (>= 750ms)</div>
        ${slowNetworkEvents.length === 0
                ? '<div class="panel-empty">No slow requests</div>'
                : slowNetworkEvents.map((event) => `
              <div class="diagnostics-item ${event.status === 'failed' ? 'error' : ''}">
                <div class="diagnostics-item-head">
                  <span class="diagnostics-badge">${(0, utils_js_1.escapeHtml)(String(event.method || 'GET'))} ${(0, utils_js_1.escapeHtml)(formatNetworkDuration(event.durationMs))}</span>
                  <span class="diagnostics-meta">${(0, utils_js_1.escapeHtml)(String((event.statusCode ?? event.status) || 'unknown'))}</span>
                </div>
                <div class="diagnostics-meta">${(0, utils_js_1.escapeHtml)(event.fromCache ? 'cached' : 'network')} · ${(0, utils_js_1.escapeHtml)(String(event.resourceType || 'unknown'))}</div>
                <div class="diagnostics-url">${(0, utils_js_1.escapeHtml)(String(event.url || ''))}</div>
              </div>
              `).join('')}
      </div>
    `;
        }
        catch {
            dropdownContent.innerHTML = '<div class="panel-empty">Diagnostics currently unavailable.</div>';
        }
    }
    else if (panel === 'extensions') {
        dropdownContent.innerHTML = bs.extensions.map(e => `
      <div class="ext-item">
        <span class="ext-name">${(0, utils_js_1.escapeHtml)(e.name)}</span>
        <span class="ext-version">v${(0, utils_js_1.escapeHtml)(e.version)}</span>
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
    }
    else if (panel === 'settings') {
        const s = bs.settings;
        dropdownContent.innerHTML = `
      <div class="settings-group">
        <div class="settings-label">General</div>
        <div class="settings-row"><label>Homepage</label><input type="text" id="settingsHomepage" value="${(0, utils_js_1.escapeHtml)(s.homepage)}" style="width:200px"></div>
        <div class="settings-row"><label>Search Engine</label><select id="settingsSearchEngine">
          <option value="google" ${s.searchEngine === 'google' ? 'selected' : ''}>Google</option>
          <option value="duckduckgo" ${s.searchEngine === 'duckduckgo' ? 'selected' : ''}>DuckDuckGo</option>
          <option value="bing" ${s.searchEngine === 'bing' ? 'selected' : ''}>Bing</option>
        </select></div>
        <div class="settings-row"><label>Default Zoom</label><span>${Math.round(s.defaultZoom * 100)}%</span></div>
      </div>
      <div class="settings-group">
        <div class="settings-label">Content</div>
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
        <div class="settings-row settings-row-stack"><label>Last Google CookieMismatch</label><span class="settings-note">${(0, utils_js_1.formatNullableTime)(lastAuthDiagnostics?.lastGoogleCookieMismatchAt ?? null)}</span></div>
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
dropdownContent.addEventListener('click', (e) => {
    const target = e.target;
    // Navigate to URL
    const navItem = target.closest('[data-nav-url]');
    if (navItem && !target.hasAttribute('data-remove-bookmark')) {
        workspaceAPI?.actions.submit({ target: 'browser', kind: 'browser.navigate', payload: { url: navItem.dataset.navUrl } });
        closePanel();
        return;
    }
    // Remove bookmark
    const rmBm = target.getAttribute('data-remove-bookmark');
    if (rmBm) {
        workspaceAPI?.browser.removeBookmark(rmBm);
        return;
    }
    // Cancel download
    const cancelDl = target.getAttribute('data-cancel-download');
    if (cancelDl) {
        workspaceAPI?.browser.cancelDownload(cancelDl);
        return;
    }
    // Remove extension
    const rmExt = target.getAttribute('data-remove-extension');
    if (rmExt) {
        workspaceAPI?.browser.removeExtension(rmExt);
        return;
    }
    // Load extension
    if (target.id === 'btnLoadExt') {
        const input = document.getElementById('extPathInput');
        if (input && input.value.trim()) {
            workspaceAPI?.browser.loadExtension(input.value.trim());
            input.value = '';
        }
        return;
    }
    // Settings toggles
    const settingKey = target.getAttribute('data-setting');
    if (settingKey && lastBrowserState) {
        const current = lastBrowserState.settings[settingKey];
        workspaceAPI?.browser.updateSettings({ [settingKey]: !current });
        return;
    }
    // Clear buttons
    if (target.id === 'btnClearHistory') {
        workspaceAPI?.browser.clearHistory();
        return;
    }
    if (target.id === 'btnClearData') {
        workspaceAPI?.browser.clearData();
        return;
    }
    if (target.id === 'btnRefreshDiagnostics') {
        void refreshBrowserDiagnostics().then(() => {
            if (activePanel === 'diagnostics')
                renderPanel('diagnostics');
        });
        return;
    }
    if (target.id === 'btnClearCurrentSiteData') {
        const origin = lastBrowserState?.navigation?.url || '';
        void workspaceAPI?.browser.clearSiteData(origin).then((result) => {
            void workspaceAPI?.addLog('info', 'browser', `Cleared current site data for ${result.origin} (${result.cookiesCleared} cookies removed)`);
            return refreshBrowserDiagnostics();
        }).then(() => {
            if (activePanel === 'diagnostics')
                renderPanel('diagnostics');
        });
        return;
    }
    if (target.id === 'btnRefreshAuthDiagnostics') {
        void refreshAuthDiagnostics().then(() => {
            if (activePanel === 'settings')
                renderPanel('settings');
        });
        return;
    }
    if (target.id === 'btnReimportCookies') {
        void workspaceAPI?.browser.reimportCookies().then((result) => {
            void workspaceAPI?.addLog('info', 'browser', `Chrome session import completed: ${result.imported} imported, ${result.failed} failed`);
            return refreshAuthDiagnostics();
        }).then(() => {
            if (activePanel === 'settings')
                renderPanel('settings');
        });
        return;
    }
    if (target.id === 'btnClearGoogleAuthState') {
        void workspaceAPI?.browser.clearGoogleAuthState().then((result) => {
            void workspaceAPI?.addLog('info', 'browser', `Cleared ${result.cleared} Google-family cookies from the app session`);
            return refreshAuthDiagnostics();
        }).then(() => {
            if (activePanel === 'settings')
                renderPanel('settings');
        });
        return;
    }
});
// Settings text inputs
dropdownContent.addEventListener('change', (e) => {
    const target = e.target;
    if (target.id === 'settingsHomepage') {
        workspaceAPI?.browser.updateSettings({ homepage: target.value });
    }
    if (target.id === 'settingsSearchEngine') {
        workspaceAPI?.browser.updateSettings({ searchEngine: target.value });
    }
});
// ─── Browser State Updates ──────────────────────────────────────────────────
function updateBrowserState(state) {
    lastBrowserState = state;
    renderTabs(state.tabs, state.activeTabId, state.splitLeftTabId, state.splitRightTabId);
    const nav = state.navigation;
    browserSurfaceArea.classList.remove('split-active-left', 'split-active-right');
    if (state.splitLeftTabId && state.splitRightTabId) {
        if (state.activeTabId === state.splitLeftTabId) {
            browserSurfaceArea.classList.add('split-active-left');
        }
        else if (state.activeTabId === state.splitRightTabId) {
            browserSurfaceArea.classList.add('split-active-right');
        }
    }
    if (document.activeElement !== addressInput)
        addressInput.value = nav.url;
    btnBack.disabled = !nav.canGoBack;
    btnForward.disabled = !nav.canGoForward;
    if (nav.isLoading) {
        btnReload.style.display = 'none';
        btnStop.style.display = '';
    }
    else {
        btnReload.style.display = '';
        btnStop.style.display = 'none';
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
    if (activePanel === 'downloads')
        renderPanel(activePanel);
}
workspaceAPI?.browser.onNavUpdate((nav) => {
    if (!lastBrowserState)
        return;
    lastBrowserState.navigation = nav;
    if (document.activeElement !== addressInput)
        addressInput.value = nav.url;
    btnBack.disabled = !nav.canGoBack;
    btnForward.disabled = !nav.canGoForward;
    if (nav.isLoading) {
        btnReload.style.display = 'none';
        btnStop.style.display = '';
    }
    else {
        btnReload.style.display = '';
        btnStop.style.display = 'none';
    }
});
workspaceAPI?.browser.onStateUpdate((state) => { updateBrowserState(state); });
// ─── Split Management ──────────────────────────────────────────────────────
function applySplitRatio(ratio) {
    currentRatio = Math.max(0.15, Math.min(0.85, ratio));
    const shell = browserPane.parentElement;
    const shellWidth = Math.max(1, Math.round(shell.getBoundingClientRect().width || document.documentElement.clientWidth || window.innerWidth));
    if (!Number.isFinite(shellWidth) || shellWidth <= 1) {
        splitMeasureAttempts += 1;
        if (splitMeasureAttempts < 20) {
            requestAnimationFrame(() => applySplitRatio(ratio));
        }
        return;
    }
    splitMeasureAttempts = 0;
    if (terminalCollapsed) {
        applyTerminalCollapsedLayout();
        return;
    }
    const totalWidth = shellWidth - splitter.getBoundingClientRect().width;
    const browserWidth = Math.round(totalWidth * currentRatio);
    const terminalWidth = totalWidth - browserWidth;
    browserPane.style.width = `${browserWidth}px`;
    terminalPane.style.width = `${terminalWidth}px`;
    splitLabel.textContent = `Split: ${Math.round(currentRatio * 100)}/${Math.round((1 - currentRatio) * 100)}`;
    requestAnimationFrame(() => { scheduleFit(); reportBrowserBounds(); });
}
function applyTerminalCollapsedLayout() {
    const shell = browserPane.parentElement;
    const totalWidth = Math.max(1, Math.round(shell.getBoundingClientRect().width || document.documentElement.clientWidth || window.innerWidth));
    if (!Number.isFinite(totalWidth) || totalWidth <= 1) {
        splitMeasureAttempts += 1;
        if (splitMeasureAttempts < 20) {
            requestAnimationFrame(() => applyTerminalCollapsedLayout());
        }
        return;
    }
    splitMeasureAttempts = 0;
    const terminalWidth = 42;
    browserPane.style.width = `${Math.max(0, Math.round(totalWidth - terminalWidth))}px`;
    terminalPane.style.width = `${terminalWidth}px`;
    splitLabel.textContent = 'Terminal collapsed';
    requestAnimationFrame(() => reportBrowserBounds());
}
function setTerminalCollapsed(collapsed) {
    terminalCollapsed = collapsed;
    const shell = browserPane.parentElement;
    shell.classList.toggle('terminal-collapsed', collapsed);
    terminalPane.classList.toggle('collapsed', collapsed);
    termCollapseBtn.setAttribute('aria-expanded', String(!collapsed));
    termCollapseBtn.setAttribute('aria-label', collapsed ? 'Expand terminal' : 'Collapse terminal');
    termCollapseBtn.setAttribute('title', collapsed ? 'Expand terminal' : 'Collapse terminal');
    if (collapsed) {
        applyTerminalCollapsedLayout();
        return;
    }
    applySplitRatio(currentRatio);
    requestAnimationFrame(() => fitTerminal());
}
window.addEventListener('resize', () => applySplitRatio(currentRatio));
function initSplitter() {
    let startX = 0, startRatio = 0, shellWidth = 0;
    const onMouseMove = (e) => { if (!isDragging)
        return; applySplitRatio(startRatio + (e.clientX - startX) / shellWidth); };
    const onMouseUp = () => { if (!isDragging)
        return; isDragging = false; splitter.classList.remove('active'); document.body.style.cursor = ''; document.body.style.userSelect = ''; document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp); workspaceAPI?.setSplitRatio(currentRatio); fitTerminal(); };
    splitter.addEventListener('mousedown', (e) => { if (terminalCollapsed)
        return; e.preventDefault(); isDragging = true; startX = e.clientX; startRatio = currentRatio; shellWidth = browserPane.parentElement.getBoundingClientRect().width - splitter.getBoundingClientRect().width; splitter.classList.add('active'); document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; document.addEventListener('mousemove', onMouseMove); document.addEventListener('mouseup', onMouseUp); });
}
// ─── Terminal ──────────────────────────────────────────────────────────────
function initTerminal() {
    term = new Terminal({
        theme: { background: '#000000', foreground: '#ededed', cursor: '#ffffff', cursorAccent: '#000000', selectionBackground: 'rgba(255,255,255,0.12)', selectionForeground: '#ffffff', black: '#000000', red: '#ee4444', green: '#00d47b', yellow: '#ff9500', blue: '#3b82f6', magenta: '#a78bfa', cyan: '#22d3ee', white: '#ededed', brightBlack: '#555555', brightRed: '#ff6b6b', brightGreen: '#34d399', brightYellow: '#fbbf24', brightBlue: '#60a5fa', brightMagenta: '#c4b5fd', brightCyan: '#67e8f9', brightWhite: '#ffffff' },
        fontFamily: "'Geist Mono', 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
        fontSize: 13, lineHeight: 1.35, cursorBlink: true, cursorStyle: 'bar', allowTransparency: false, scrollback: 50000,
    });
    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalContainer);
    term.onData((data) => {
        workspaceAPI?.terminal.write(data);
    });
    let totalBytes = 0;
    let totalChunks = 0;
    workspaceAPI?.terminal.onOutput((data) => {
        totalBytes += data.length;
        totalChunks++;
        term.write(data);
    });
    window.__termStats = () => {
        const s = { totalBytes, totalChunks, bufferLines: term.buffer.normal.length, baseY: term.buffer.normal.baseY, viewportY: term.buffer.normal.viewportY, cols: term.cols, rows: term.rows };
        console.log('[TERM STATS]', JSON.stringify(s));
        return s;
    };
    workspaceAPI?.terminal.onStatus((session) => updateTerminalMeta(session));
    workspaceAPI?.terminal.onExit((exitCode) => { terminalStatus.textContent = `Exited (${exitCode})`; connectionDot.className = 'status-dot error'; connectionLabel.textContent = 'Disconnected'; });
    new ResizeObserver(() => scheduleFit()).observe(terminalContainer);
}
function scheduleFit() { if (terminalCollapsed)
    return; if (resizeTimer)
    clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { fitTerminal(); resizeTimer = null; }, isDragging ? 16 : 80); }
function getTerminalDimensions() {
    if (!fitAddon || !term)
        return null;
    try {
        const dims = fitAddon.proposeDimensions();
        if (dims && dims.cols > 0 && dims.rows > 0)
            return { cols: dims.cols, rows: dims.rows };
    }
    catch { }
    return null;
}
function fitTerminal() {
    if (terminalCollapsed)
        return;
    if (!fitAddon || !term)
        return;
    try {
        fitAddon.fit();
        const dims = getTerminalDimensions();
        if (dims) {
            workspaceAPI?.terminal.resize(dims.cols, dims.rows);
            termSizeLabel.textContent = `${dims.cols}x${dims.rows}`;
        }
    }
    catch { }
}
function updateTerminalMeta(session) {
    const m = { idle: 'Idle', starting: 'Starting', running: 'Running', exited: 'Exited', error: 'Error' };
    terminalStatus.textContent = m[session.status] || session.status;
    const p = [];
    if (session.shell)
        p.push(session.shell.split('/').pop() || session.shell);
    if (session.pid)
        p.push(`PID ${session.pid}`);
    p.push('ephemeral PTY');
    terminalMeta.textContent = p.join(' | ');
    if (session.status === 'running') {
        connectionDot.className = 'status-dot done';
        connectionLabel.textContent = session.restored ? 'Reconnected' : 'Connected';
    }
}
termRestartBtn.addEventListener('click', async () => { termRestartBtn.disabled = true; try {
    await workspaceAPI?.actions.submit({ target: 'terminal', kind: 'terminal.restart', payload: {} });
    term?.clear();
}
finally {
    termRestartBtn.disabled = false;
} });
termCollapseBtn.addEventListener('click', () => setTerminalCollapsed(!terminalCollapsed));
// ─── State Sync ────────────────────────────────────────────────────────────
function renderState(state) {
    if (state.terminalSession?.session)
        updateTerminalMeta(state.terminalSession.session);
    if (state.executionSplit) {
        const r = state.executionSplit.ratio;
        if (!isDragging && Math.abs(r - currentRatio) > 0.01)
            applySplitRatio(r);
    }
}
workspaceAPI?.onStateUpdate((state) => renderState(state));
// ─── Keyboard Shortcuts ────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 'l') {
        e.preventDefault();
        addressInput.focus();
        addressInput.select();
    }
    if (mod && e.key === 't') {
        e.preventDefault();
        workspaceAPI?.actions.submit({ target: 'browser', kind: 'browser.create-tab', payload: {} });
    }
    if (mod && e.key === 'w') {
        e.preventDefault();
        if (lastBrowserState)
            workspaceAPI?.actions.submit({ target: 'browser', kind: 'browser.close-tab', payload: { tabId: lastBrowserState.activeTabId } });
    }
    if (mod && e.key === 'f') {
        e.preventDefault();
        showFindBar();
    }
    if (mod && e.key === '=') {
        e.preventDefault();
        workspaceAPI?.browser.zoomIn();
    }
    if (mod && e.key === '-') {
        e.preventDefault();
        workspaceAPI?.browser.zoomOut();
    }
    if (mod && e.key === '0') {
        e.preventDefault();
        workspaceAPI?.browser.zoomReset();
    }
    if (mod && e.key === 'd') {
        e.preventDefault();
        if (lastBrowserState)
            workspaceAPI?.browser.addBookmark(lastBrowserState.navigation.url, lastBrowserState.navigation.title);
    }
    if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        workspaceAPI?.actions.submit({ target: 'browser', kind: 'browser.back', payload: {} });
    }
    if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        workspaceAPI?.actions.submit({ target: 'browser', kind: 'browser.forward', payload: {} });
    }
    if (e.key === 'F5') {
        e.preventDefault();
        workspaceAPI?.actions.submit({ target: 'browser', kind: 'browser.reload', payload: {} });
    }
    if (e.key === 'F12') {
        e.preventDefault();
        workspaceAPI?.browser.toggleDevTools();
    }
    if (e.key === 'Escape') {
        if (findBar.style.display !== 'none')
            hideFindBar();
        if (activePanel)
            closePanel();
    }
});
// ─── Init ───────────────────────────────────────────────────────────────────
function initBrowserBoundsObserver() {
    new ResizeObserver(() => reportBrowserBounds()).observe(browserSurfaceArea);
    window.addEventListener('resize', () => reportBrowserBounds());
}
async function init() {
    if (!workspaceAPI) {
        console.error('[execution] workspaceAPI is not available; browser controls are disabled.');
        return;
    }
    initSplitter();
    initTerminal();
    initBrowserBoundsObserver();
    const state = await workspaceAPI.getState();
    setTerminalCollapsed(DEFAULT_TERMINAL_COLLAPSED);
    if (state.executionSplit)
        applySplitRatio(state.executionSplit.ratio);
    else
        applySplitRatio(0.5);
    renderState(state);
    const bs = await workspaceAPI.browser.getState();
    updateBrowserState(bs);
    requestAnimationFrame(() => { reportBrowserBounds(); fitTerminal(); });
    fitTerminal();
    const dims = getTerminalDimensions();
    const existing = await workspaceAPI.terminal.getSession();
    if (existing && existing.status === 'running') {
        updateTerminalMeta(existing);
        if (dims)
            workspaceAPI.terminal.resize(dims.cols, dims.rows);
        if (existing.restored) {
            connectionDot.className = 'status-dot done';
            connectionLabel.textContent = 'Reconnected';
        }
    }
    else {
        const s = await workspaceAPI.terminal.startSession(dims?.cols ?? undefined, dims?.rows ?? undefined);
        updateTerminalMeta(s);
    }
    fitTerminal();
    workspaceAPI.addLog('info', 'system', 'Execution window initialized');
}
init().catch((error) => {
    console.error('[execution] Failed to initialize execution renderer:', error);
});
//# sourceMappingURL=execution.js.map