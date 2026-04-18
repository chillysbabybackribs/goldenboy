"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const utils_js_1 = require("../shared/utils.js");
const model_js_1 = require("../../shared/types/model.js");
const live_run_js_1 = require("./live-run.js");
const process_disclosure_js_1 = require("./process-disclosure.js");
const getWorkspaceAPI = () => window.workspaceAPI;
const getModelAPI = () => getWorkspaceAPI()?.model ?? null;
const getAttachmentAPI = () => getWorkspaceAPI()?.attachments ?? null;
// ─── DOM ────────────────────────────────────────────────────────────────────
const taskSummary = document.getElementById('taskSummary');
const modelLabel = document.getElementById('modelLabel');
const taskCount = document.getElementById('taskCount');
const commandShell = document.querySelector('.cc-shell');
const logStream = document.getElementById('logStream');
const logsCopyBtn = document.getElementById('logsCopyBtn');
const logsClearBtn = document.getElementById('logsClearBtn');
const logsBtn = document.getElementById('logsBtn');
const logsOverlay = document.getElementById('logsOverlay');
const logsCloseBtn = document.getElementById('logsCloseBtn');
// Chat
const chatThread = document.getElementById('chatThread');
const chatInner = document.getElementById('chatInner');
const chatEmptyState = document.getElementById('chatEmptyState');
const turnNav = document.getElementById('turnNav');
const turnNavMeta = document.getElementById('turnNavMeta');
const turnPrevBtn = document.getElementById('turnPrevBtn');
const turnNextBtn = document.getElementById('turnNextBtn');
const turnReuseBtn = document.getElementById('turnReuseBtn');
const chatScrollTopBtn = document.getElementById('chatScrollTopBtn');
const chatScrollBottomBtn = document.getElementById('chatScrollBottomBtn');
const chatInput = document.getElementById('chatInput');
const chatNewBtn = document.getElementById('chatNewBtn');
const chatCopyLastBtn = document.getElementById('chatCopyLastBtn');
const modelBtnPrimary = document.getElementById('modelBtnPrimary');
const modelBtnHaiku = document.getElementById('modelBtnHaiku');
const chatZoomOutBtn = document.getElementById('chatZoomOutBtn');
const chatZoomResetBtn = document.getElementById('chatZoomResetBtn');
const chatZoomInBtn = document.getElementById('chatZoomInBtn');
// History
const chatHistoryBtn = document.getElementById('chatHistoryBtn');
const historyOverlay = document.getElementById('historyOverlay');
const historyList = document.getElementById('historyList');
const historyNewBtn = document.getElementById('historyNewBtn');
const historyCloseBtn = document.getElementById('historyCloseBtn');
const artifactSidebar = document.getElementById('artifactSidebar');
const artifactSidebarToggle = document.getElementById('artifactSidebarToggle');
const artifactList = document.getElementById('artifactList');
const activeArtifactCard = document.getElementById('activeArtifactCard');
const activeArtifactEmpty = document.getElementById('activeArtifactEmpty');
const activeArtifactBody = document.getElementById('activeArtifactBody');
const activeArtifactTitle = document.getElementById('activeArtifactTitle');
const activeArtifactFormat = document.getElementById('activeArtifactFormat');
const activeArtifactMeta = document.getElementById('activeArtifactMeta');
const activeArtifactOpenBtn = document.getElementById('activeArtifactOpenBtn');
const activeArtifactDeleteBtn = document.getElementById('activeArtifactDeleteBtn');
// Token usage — displayed in status bar
const tokenStatusLabel = document.getElementById('tokenStatusLabel');
// Stop
const chatStopBtn = document.getElementById('chatStopBtn');
// Attachments
const attachDocBtn = document.getElementById('attachDocBtn');
const attachImgBtn = document.getElementById('attachImgBtn');
const attachPreview = document.getElementById('attachPreview');
const attachPreviewList = document.getElementById('attachPreviewList');
const docFileInput = document.getElementById('docFileInput');
const imgFileInput = document.getElementById('imgFileInput');
const SELECTABLE_OWNERS = [model_js_1.PRIMARY_PROVIDER_ID, model_js_1.HAIKU_PROVIDER_ID];
const SELECTED_OWNER_STORAGE_KEY = 'command-center-selected-owner';
const OWNER_LABELS = {
    [model_js_1.PRIMARY_PROVIDER_ID]: 'Codex',
    [model_js_1.HAIKU_PROVIDER_ID]: 'Haiku 4.5',
};
function getOwnerDisplayLabel(owner) {
    return OWNER_LABELS[owner].toLowerCase();
}
let selectedOwner = model_js_1.PRIMARY_PROVIDER_ID;
let chatCounter = 0;
let renderedTaskMemoryKey = null;
let currentRenderedTaskId = null;
let chatAutoPinned = true;
let chatScrollRaf = null;
let chatScrollFramesRemaining = 0;
let suppressChatScrollEvent = false;
let suppressNextChatScrollActivation = false;
let chatScrollControlsActivated = false;
let chatScrollControlsDimmed = false;
let chatScrollControlsIdleTimer = null;
let lastAgentResponseText = '';
let chatCopyFeedbackTimer = null;
let chatZoom = 1;
let runningTaskId = null;
let historyOpen = false;
let renderedTurns = [];
let selectedTurnIndex = -1;
let artifactSidebarCollapsed = false;
const CHAT_ZOOM_STORAGE_KEY = 'command-center-chat-zoom';
const CHAT_ZOOM_BASELINE = 1.6;
const CHAT_ZOOM_DEFAULT = CHAT_ZOOM_BASELINE;
const CHAT_ZOOM_MIN = 0.8;
const CHAT_ZOOM_MAX = 2.6;
const CHAT_ZOOM_STEP = 0.16;
const ARTIFACT_SIDEBAR_COLLAPSED_STORAGE_KEY = 'command-center-artifact-sidebar-collapsed';
function isSelectableOwner(value) {
    return SELECTABLE_OWNERS.includes(value);
}
function isExplicitSelectableOwner(value) {
    return value === model_js_1.PRIMARY_PROVIDER_ID || value === model_js_1.HAIKU_PROVIDER_ID;
}
function getProviderRuntime(state, owner) {
    return state?.providers?.[owner] ?? null;
}
function getLastState() {
    return window.__lastState ?? null;
}
function canSelectOwner(state, owner) {
    const runtime = getProviderRuntime(state, owner);
    if (!runtime)
        return false;
    return runtime.status !== 'unavailable' && runtime.status !== 'error';
}
function getStoredSelectedOwner() {
    try {
        const stored = window.localStorage.getItem(SELECTED_OWNER_STORAGE_KEY);
        if (stored && isSelectableOwner(stored))
            return stored;
    }
    catch {
        // Ignore storage failures in restricted renderer environments.
    }
    return model_js_1.PRIMARY_PROVIDER_ID;
}
function persistSelectedOwner() {
    try {
        window.localStorage.setItem(SELECTED_OWNER_STORAGE_KEY, selectedOwner);
    }
    catch {
        // Ignore storage failures in restricted renderer environments.
    }
}
function getFallbackSelectableOwner(state, preferredOwner = model_js_1.PRIMARY_PROVIDER_ID) {
    if (canSelectOwner(state, preferredOwner))
        return preferredOwner;
    return SELECTABLE_OWNERS.find((owner) => canSelectOwner(state, owner)) ?? preferredOwner;
}
function normalizeSelectedOwner(nextOwner, state) {
    return canSelectOwner(state, nextOwner) ? nextOwner : getFallbackSelectableOwner(state, nextOwner);
}
function setSelectedOwner(nextOwner, state = window.__lastState) {
    selectedOwner = normalizeSelectedOwner(nextOwner, state);
    persistSelectedOwner();
    syncModelToggleState(state);
}
function getModelBtn(owner) {
    return owner === model_js_1.PRIMARY_PROVIDER_ID ? modelBtnPrimary : modelBtnHaiku;
}
function syncModelToggleState(state = window.__lastState) {
    const busy = Boolean(runningTaskId);
    for (const owner of [model_js_1.PRIMARY_PROVIDER_ID, model_js_1.HAIKU_PROVIDER_ID]) {
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
function initializeModelToggle() {
    selectedOwner = getStoredSelectedOwner();
    for (const owner of [model_js_1.PRIMARY_PROVIDER_ID, model_js_1.HAIKU_PROVIDER_ID]) {
        getModelBtn(owner).addEventListener('click', () => {
            if (runningTaskId)
                return;
            setSelectedOwner(owner, window.__lastState);
        });
    }
    syncModelToggleState();
}
function clampChatZoom(value) {
    return Math.min(CHAT_ZOOM_MAX, Math.max(CHAT_ZOOM_MIN, value));
}
function roundChatZoom(value) {
    return Math.round(value * 100) / 100;
}
function getChatZoomPercent(value) {
    return Math.round((value / CHAT_ZOOM_BASELINE) * 100);
}
function syncChatZoomControls() {
    chatZoomOutBtn.disabled = chatZoom <= CHAT_ZOOM_MIN;
    chatZoomInBtn.disabled = chatZoom >= CHAT_ZOOM_MAX;
    const percent = getChatZoomPercent(chatZoom);
    chatZoomResetBtn.textContent = `${percent}%`;
    chatZoomResetBtn.setAttribute('title', `Reset chat zoom (${percent}%)`);
    chatZoomResetBtn.setAttribute('aria-label', `Reset chat zoom (${percent}%)`);
}
function setChatZoom(nextZoom, persist = true) {
    chatZoom = roundChatZoom(clampChatZoom(nextZoom));
    commandShell.style.setProperty('--cc-chat-zoom', String(chatZoom));
    syncChatZoomControls();
    scheduleChatScrollToBottom(false, 2);
    if (!persist)
        return;
    try {
        window.localStorage.setItem(CHAT_ZOOM_STORAGE_KEY, String(chatZoom));
    }
    catch {
        // Ignore storage failures in restricted renderer environments.
    }
}
function adjustChatZoom(delta) {
    setChatZoom(chatZoom + delta);
}
function resetChatZoom() {
    setChatZoom(CHAT_ZOOM_DEFAULT);
}
function initializeChatZoom() {
    try {
        const stored = window.localStorage.getItem(CHAT_ZOOM_STORAGE_KEY);
        const parsed = stored == null ? NaN : Number.parseFloat(stored);
        if (Number.isFinite(parsed)) {
            setChatZoom(parsed, false);
            return;
        }
    }
    catch {
        // Ignore storage failures in restricted renderer environments.
    }
    setChatZoom(CHAT_ZOOM_DEFAULT, false);
}
function syncArtifactSidebarToggle() {
    artifactSidebar.classList.toggle('collapsed', artifactSidebarCollapsed);
    artifactSidebarToggle.classList.toggle('collapsed', artifactSidebarCollapsed);
    artifactSidebarToggle.setAttribute('aria-expanded', artifactSidebarCollapsed ? 'false' : 'true');
    artifactSidebarToggle.setAttribute('aria-label', artifactSidebarCollapsed ? 'Expand artifact sidebar' : 'Collapse artifact sidebar');
    artifactSidebarToggle.setAttribute('title', artifactSidebarCollapsed ? 'Expand artifact sidebar' : 'Collapse artifact sidebar');
    const icon = artifactSidebarToggle.querySelector('.cc-sidebar-toggle-icon');
    if (icon)
        icon.textContent = artifactSidebarCollapsed ? '⟩' : '⟨';
}
function setArtifactSidebarCollapsed(collapsed, persist = true) {
    artifactSidebarCollapsed = collapsed;
    syncArtifactSidebarToggle();
    if (!persist)
        return;
    try {
        window.localStorage.setItem(ARTIFACT_SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? 'true' : 'false');
    }
    catch {
        // Ignore storage failures in restricted renderer environments.
    }
}
function initializeArtifactSidebar() {
    try {
        const stored = window.localStorage.getItem(ARTIFACT_SIDEBAR_COLLAPSED_STORAGE_KEY);
        if (stored === 'true' || stored === 'false') {
            setArtifactSidebarCollapsed(stored === 'true', false);
            return;
        }
    }
    catch {
        // Ignore storage failures in restricted renderer environments.
    }
    setArtifactSidebarCollapsed(false, false);
}
// ─── Log Rendering ─────────────────────────────────────────────────────────
let lastLogCount = 0;
let logsCopyFeedbackTimer = null;
let logsOpen = false;
function setLogsOpen(open) {
    logsOpen = open;
    logsOverlay.hidden = !open;
    logsBtn.classList.toggle('active', open);
    if (open)
        logStream.scrollTop = logStream.scrollHeight;
}
logsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setLogsOpen(!logsOpen);
});
logsCloseBtn.addEventListener('click', () => setLogsOpen(false));
document.addEventListener('click', (e) => {
    if (logsOpen && !logsOverlay.contains(e.target) && e.target !== logsBtn) {
        setLogsOpen(false);
    }
});
function renderLogs(logs) {
    const newLogs = logs.slice(lastLogCount);
    for (const log of newLogs) {
        const el = document.createElement('div');
        el.className = `log-entry ${log.level}`;
        el.innerHTML = `<span class="log-time">${(0, utils_js_1.formatTime)(log.timestamp)}</span><span class="log-source" data-source="${(0, utils_js_1.escapeHtml)(log.source)}">[${(0, utils_js_1.escapeHtml)(log.source)}]</span><span class="log-message">${(0, utils_js_1.escapeHtml)(log.message)}</span>`;
        logStream.appendChild(el);
    }
    lastLogCount = logs.length;
    logStream.scrollTop = logStream.scrollHeight;
}
async function copyVisibleLogs() {
    const text = logStream.innerText.trim();
    if (!text)
        return;
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
        }
        else {
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
        if (logsCopyFeedbackTimer !== null)
            window.clearTimeout(logsCopyFeedbackTimer);
        logsCopyFeedbackTimer = window.setTimeout(() => {
            logsCopyBtn.classList.remove('copied');
            logsCopyBtn.setAttribute('title', 'Copy visible logs');
            logsCopyBtn.setAttribute('aria-label', 'Copy visible logs');
            logsCopyFeedbackTimer = null;
        }, 1200);
    }
    catch (err) {
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
function isChatNearBottom(threshold = 56) {
    const distanceFromBottom = chatThread.scrollHeight - (chatThread.scrollTop + chatThread.clientHeight);
    return distanceFromBottom <= threshold;
}
function isChatNearTop(threshold = 56) {
    return chatThread.scrollTop <= threshold;
}
function scheduleChatScrollControlsIdle() {
    if (chatScrollControlsIdleTimer !== null)
        window.clearTimeout(chatScrollControlsIdleTimer);
    chatScrollControlsDimmed = false;
    chatThread.classList.remove('cc-chat-scroll-idle');
    chatScrollControlsIdleTimer = window.setTimeout(() => {
        chatScrollControlsDimmed = true;
        chatThread.classList.add('cc-chat-scroll-idle');
    }, 900);
}
function activateChatScrollControls() {
    chatScrollControlsActivated = true;
    scheduleChatScrollControlsIdle();
    updateChatScrollControls();
}
function updateChatScrollControls() {
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
function performChatScrollToBottom() {
    suppressChatScrollEvent = true;
    chatThread.scrollTop = chatThread.scrollHeight;
    queueMicrotask(() => {
        suppressChatScrollEvent = false;
        updateChatScrollControls();
    });
}
function scheduleChatScrollToBottom(force = false, frames = 3) {
    if (!force && !chatAutoPinned)
        return;
    if (force)
        chatAutoPinned = true;
    chatScrollFramesRemaining = Math.max(chatScrollFramesRemaining, frames);
    if (chatScrollRaf !== null)
        return;
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
    if (suppressChatScrollEvent)
        return;
    if (suppressNextChatScrollActivation) {
        suppressNextChatScrollActivation = false;
    }
    else {
        activateChatScrollControls();
    }
    chatAutoPinned = isChatNearBottom();
    updateChatScrollControls();
});
chatThread.addEventListener('wheel', (e) => {
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
chatThread.addEventListener('toggle', (event) => {
    const target = event.target;
    if (!target?.classList.contains('chat-tool-details'))
        return;
    scheduleChatScrollToBottom(true, 6);
}, true);
const chatResizeObserver = new ResizeObserver(() => {
    if (chatEmptyState.parentNode)
        return;
    scheduleChatScrollToBottom(false, 4);
});
chatResizeObserver.observe(chatThread);
const chatMutationObserver = new MutationObserver(() => {
    if (chatEmptyState.parentNode)
        return;
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
// ─── Markdown Rendering ────────────────────────────────────────────────────
function renderInlineMarkdown(text) {
    return (0, utils_js_1.escapeHtml)(text)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');
}
function renderMarkdown(text) {
    // Normalize: convert literal <br> tags and \r\n to newlines before splitting
    const normalized = text
        .replace(/\r\n/g, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .trim();
    const lines = normalized.split('\n');
    const parts = [];
    let paragraph = [];
    let listItems = [];
    let listOrdered = false;
    const flushParagraph = () => {
        if (paragraph.length === 0)
            return;
        parts.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`);
        paragraph = [];
    };
    const flushList = () => {
        if (listItems.length === 0)
            return;
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
            if (listItems.length > 0 && listOrdered)
                flushList();
            flushParagraph();
            listOrdered = false;
            listItems.push(trimmed.slice(2));
            continue;
        }
        const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
        if (orderedMatch) {
            // If we were building an unordered list, flush it first
            if (listItems.length > 0 && !listOrdered)
                flushList();
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
function isInternalPromptText(text) {
    return text.startsWith('Run a critique pass on the current draft answer before finalizing.')
        || text.startsWith('Revise the draft answer using the critique and verification records now stored in task memory.');
}
function isInternalModelText(text) {
    return text.startsWith('## Critique Summary');
}
function shouldShowMemoryEntry(entry) {
    if (entry.kind === 'system' || entry.kind === 'handoff' || entry.kind === 'browser_finding')
        return false;
    if (entry.kind === 'user_prompt')
        return !isInternalPromptText(entry.text);
    if (entry.kind === 'model_result')
        return !isInternalModelText(entry.text);
    return true;
}
function formatAttachmentSize(sizeBytes) {
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0)
        return '0 B';
    if (sizeBytes < 1024)
        return `${sizeBytes} B`;
    if (sizeBytes < 1024 * 1024)
        return `${(sizeBytes / 1024).toFixed(1)} KB`;
    if (sizeBytes < 1024 * 1024 * 1024)
        return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
function createUserTextMessage(text, className = 'chat-msg chat-msg-user') {
    const bubble = document.createElement('div');
    bubble.className = className;
    bubble.textContent = text;
    return bubble;
}
function createUserAttachmentMessage(imageDataUrls, documents) {
    if (imageDataUrls.length === 0 && documents.length === 0)
        return null;
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
            const card = document.createElement('div');
            card.className = 'chat-msg-document';
            const header = document.createElement('div');
            header.className = 'chat-msg-document-header';
            const icon = document.createElement('span');
            icon.className = 'chat-msg-document-icon';
            icon.innerHTML =
                '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M9 1.5H4.5a2 2 0 00-2 2v9a2 2 0 002 2h7a2 2 0 002-2V6L9 1.5z" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 1.5V6h4.5" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            const title = document.createElement('span');
            title.className = 'chat-msg-document-name';
            title.textContent = docAttachment.name;
            header.append(icon, title);
            const meta = document.createElement('div');
            meta.className = 'chat-msg-document-meta';
            const metaParts = [
                docAttachment.mediaType,
                formatAttachmentSize(docAttachment.sizeBytes),
                docAttachment.status,
                typeof docAttachment.chunkCount === 'number' && docAttachment.chunkCount > 0 ? `${docAttachment.chunkCount} chunks` : '',
            ].filter((part) => Boolean(part));
            meta.textContent = metaParts.join(' • ');
            card.append(header, meta);
            if (docAttachment.excerpt?.trim()) {
                const excerpt = document.createElement('div');
                excerpt.className = 'chat-msg-document-excerpt';
                excerpt.textContent = docAttachment.excerpt.trim();
                card.appendChild(excerpt);
            }
            else if (docAttachment.statusDetail?.trim()) {
                const detail = document.createElement('div');
                detail.className = 'chat-msg-document-excerpt';
                detail.textContent = docAttachment.statusDetail.trim();
                card.appendChild(detail);
            }
            docContainer.appendChild(card);
        }
        el.appendChild(docContainer);
    }
    return el;
}
function appendUserAttachmentMessage(imageDataUrls, documents) {
    const el = createUserAttachmentMessage(imageDataUrls, documents);
    if (el)
        chatInner.appendChild(el);
}
function appendUserMessageToContainer(container, text, imageDataUrls = [], documents = [], textClassName = 'chat-msg chat-msg-user') {
    const hasText = Boolean(text.trim());
    if (hasText)
        container.appendChild(createUserTextMessage(text, textClassName));
    const attachmentEl = createUserAttachmentMessage(imageDataUrls, documents);
    if (attachmentEl)
        container.appendChild(attachmentEl);
}
function appendUserMessage(text, imageDataUrls = [], documents = []) {
    if (chatEmptyState.parentNode)
        chatEmptyState.remove();
    appendUserMessageToContainer(chatInner, text, imageDataUrls, documents);
    scheduleChatScrollToBottom(true);
}
function getAttachmentImageDataUrls(attachments) {
    if (!attachments?.length)
        return [];
    return attachments
        .filter((attachment) => attachment.type === 'image')
        .map((attachment) => `data:${attachment.mediaType};base64,${attachment.data}`);
}
function getAttachmentDocumentPreviews(attachments) {
    if (!attachments?.length)
        return [];
    return attachments
        .filter((attachment) => attachment.type === 'document')
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
function getTaskMemoryAttachments(entry) {
    const attachments = Array.isArray(entry.metadata?.attachments)
        ? entry.metadata.attachments
        : [];
    return attachments;
}
function getTaskMemoryProcessEntries(entry) {
    return Array.isArray(entry.metadata?.processEntries)
        ? entry.metadata.processEntries
        : [];
}
function clearChatThread() {
    chatInner.innerHTML = '';
    chatInner.appendChild(chatEmptyState);
    updateLastAgentResponseText('');
    resetTurnNavigator();
}
function updateLastAgentResponseText(nextText) {
    const trimmed = nextText.trim();
    lastAgentResponseText = trimmed;
    const hasResponse = Boolean(trimmed);
    chatCopyLastBtn.toggleAttribute('disabled', !hasResponse);
    chatCopyLastBtn.setAttribute('title', hasResponse ? 'Copy last agent response' : 'No agent response yet');
    chatCopyLastBtn.setAttribute('aria-label', hasResponse ? 'Copy last agent response' : 'No agent response yet');
}
async function copyTextToClipboard(text) {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
        }
        else {
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
    }
    catch (err) {
        return false;
    }
}
function flashChatCopyFeedback(label) {
    chatCopyLastBtn.classList.add('copied');
    chatCopyLastBtn.setAttribute('title', label);
    chatCopyLastBtn.setAttribute('aria-label', label);
    if (chatCopyFeedbackTimer !== null)
        window.clearTimeout(chatCopyFeedbackTimer);
    chatCopyFeedbackTimer = window.setTimeout(() => {
        chatCopyLastBtn.classList.remove('copied');
        chatCopyLastBtn.setAttribute('title', lastAgentResponseText ? 'Copy last agent response' : 'No agent response yet');
        chatCopyLastBtn.setAttribute('aria-label', lastAgentResponseText ? 'Copy last agent response' : 'No agent response yet');
        chatCopyFeedbackTimer = null;
    }, 1200);
}
async function copyLastAgentResponse() {
    const text = lastAgentResponseText.trim();
    if (!text)
        return;
    const copied = await copyTextToClipboard(text);
    if (copied) {
        flashChatCopyFeedback('Copied');
        return;
    }
    getWorkspaceAPI()?.addLog('error', 'system', 'Failed to copy last agent response');
}
function createLiveRunCard(taskId, _provider, prompt, container = chatInner) {
    (0, live_run_js_1.createLiveRunCard)(taskId, _provider, container, {
        renderMarkdown,
        updateLastAgentResponseText,
        scheduleChatScrollToBottom,
        disableChatAutoPin: () => {
            chatAutoPinned = false;
            updateChatScrollControls();
        },
    }, prompt);
}
function appendToken(taskId, text) {
    (0, live_run_js_1.appendToken)(taskId, text);
}
function appendThought(taskId, text) {
    (0, live_run_js_1.appendThought)(taskId, text);
}
function migrateBufferedOutputToThoughts(taskId) {
    (0, live_run_js_1.migrateBufferedOutputToThoughts)(taskId);
}
function appendToolActivity(taskId, kind, text) {
    (0, live_run_js_1.appendToolActivity)(taskId, kind, text);
}
function appendCodexItemProgress(taskId, progressData, item) {
    (0, live_run_js_1.appendCodexItemProgress)(taskId, progressData, item);
}
function replaceWithResult(taskId, result, provider) {
    (0, live_run_js_1.replaceWithResult)(taskId, result, provider);
    renderTaskArtifactLinks(getLastState(), taskId);
}
function replaceWithError(taskId, error) {
    (0, live_run_js_1.replaceWithError)(taskId, error);
}
function createModelResultMessage(text) {
    const el = document.createElement('div');
    el.className = 'chat-msg chat-msg-model chat-msg-done';
    el.innerHTML = `<div class="chat-msg-text chat-markdown">${renderMarkdown(text)}</div>`;
    return el;
}
function createHistoricalProcessDisclosure(entries) {
    return (0, process_disclosure_js_1.createProcessDisclosure)(entries
        .map((entry) => ({
        kind: entry.kind === 'thought' ? 'thought' : 'tool',
        text: typeof entry.text === 'string' ? entry.text.trim() : '',
    }))
        .filter((entry) => entry.text.length > 0));
}
function buildConversationTurns(entries) {
    const turns = [];
    let current = null;
    const pushCurrent = () => {
        if (!current)
            return;
        if (!current.promptEntry && current.resultEntries.length === 0)
            return;
        current.index = turns.length;
        current.responseText = current.resultEntries.map((entry) => entry.text.trim()).filter(Boolean).join('\n\n');
        current.processEntries = current.resultEntries.flatMap((entry) => getTaskMemoryProcessEntries(entry));
        turns.push(current);
        current = null;
    };
    for (const entry of entries) {
        if (!shouldShowMemoryEntry(entry))
            continue;
        if (entry.kind === 'user_prompt') {
            pushCurrent();
            current = {
                index: turns.length,
                promptEntry: entry,
                resultEntries: [],
                promptText: entry.text.trim(),
                responseText: '',
                processEntries: [],
                attachments: getTaskMemoryAttachments(entry),
                createdAt: entry.createdAt,
                anchorEl: null,
            };
            continue;
        }
        if (entry.kind !== 'model_result')
            continue;
        if (!current) {
            current = {
                index: turns.length,
                promptEntry: null,
                resultEntries: [],
                promptText: '',
                responseText: '',
                processEntries: [],
                attachments: [],
                createdAt: entry.createdAt,
                anchorEl: null,
            };
        }
        current.resultEntries.push(entry);
    }
    pushCurrent();
    return turns;
}
function defaultSelectedTurnIndex(turns) {
    if (turns.length === 0)
        return -1;
    return turns.length - 1;
}
function resetTurnNavigator() {
    renderedTurns = [];
    selectedTurnIndex = -1;
    turnNav.hidden = true;
    turnNavMeta.textContent = '';
    turnPrevBtn.disabled = true;
    turnNextBtn.disabled = true;
    turnReuseBtn.disabled = true;
}
function syncRenderedTurnVisibility() {
    for (const turn of renderedTurns) {
        if (!turn.anchorEl)
            continue;
        const isSelected = turn.index === selectedTurnIndex;
        turn.anchorEl.classList.toggle('is-selected', isSelected);
        turn.anchorEl.classList.toggle('chat-turn-hidden', !isSelected);
    }
}
function renderTurnNavigator() {
    if (renderedTurns.length === 0 || selectedTurnIndex < 0 || selectedTurnIndex >= renderedTurns.length) {
        resetTurnNavigator();
        return;
    }
    const turn = renderedTurns[selectedTurnIndex];
    turnNav.hidden = renderedTurns.length <= 1;
    turnNavMeta.textContent = renderedTurns.length > 1
        ? `Turn ${selectedTurnIndex + 1} of ${renderedTurns.length} · ${formatHistoryDate(turn.createdAt)}`
        : '';
    turnPrevBtn.disabled = selectedTurnIndex <= 0;
    turnNextBtn.disabled = selectedTurnIndex >= renderedTurns.length - 1;
    turnReuseBtn.disabled = !turn.promptText.trim();
    syncRenderedTurnVisibility();
}
function selectTurn(index, options = {}) {
    if (index < 0 || index >= renderedTurns.length)
        return;
    selectedTurnIndex = index;
    renderTurnNavigator();
    if (options.scroll) {
        renderedTurns[index].anchorEl?.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
        });
    }
}
function registerRenderedTurn(turn, anchorEl) {
    turn.anchorEl = anchorEl;
    turn.index = renderedTurns.length;
    anchorEl.dataset.turnIndex = String(turn.index);
    renderedTurns.push(turn);
}
function createTurnContainer() {
    if (chatEmptyState.parentNode)
        chatEmptyState.remove();
    const container = document.createElement('div');
    container.className = 'chat-turn';
    chatInner.appendChild(container);
    return container;
}
function renderHistoricalTurn(turn) {
    const container = createTurnContainer();
    if (turn.promptText || turn.attachments.length > 0) {
        appendUserMessageToContainer(container, turn.promptText, getAttachmentImageDataUrls(turn.attachments), getAttachmentDocumentPreviews(turn.attachments), 'chat-msg chat-msg-user chat-msg-user-memory');
    }
    const processDisclosure = createHistoricalProcessDisclosure(turn.processEntries);
    if (processDisclosure) {
        container.appendChild(processDisclosure);
    }
    if (turn.responseText) {
        container.appendChild(createModelResultMessage(turn.responseText));
        updateLastAgentResponseText(turn.responseText);
    }
    registerRenderedTurn(turn, container);
}
function renderConversationTurns(turns, taskId) {
    renderedTurns = [];
    if (turns.length === 0) {
        resetTurnNavigator();
        return;
    }
    const state = getLastState();
    const activeTask = taskId ? findTaskById(state, taskId) : null;
    const isRunning = Boolean(taskId && activeTask?.status === 'running');
    let liveTurn = null;
    let historicalTurns = turns;
    if (isRunning) {
        const candidate = turns[turns.length - 1];
        if (candidate && candidate.resultEntries.length === 0 && candidate.promptEntry) {
            liveTurn = candidate;
            historicalTurns = turns.slice(0, -1);
        }
    }
    for (const turn of historicalTurns) {
        renderHistoricalTurn(turn);
    }
    if (liveTurn && taskId) {
        const container = createTurnContainer();
        if (liveTurn.promptText || liveTurn.attachments.length > 0) {
            appendUserMessageToContainer(container, liveTurn.promptText, getAttachmentImageDataUrls(liveTurn.attachments), getAttachmentDocumentPreviews(liveTurn.attachments), 'chat-msg chat-msg-user chat-msg-user-memory');
        }
        createLiveRunCard(taskId, activeTask?.owner || 'system', undefined, container);
        registerRenderedTurn(liveTurn, container);
    }
    if (renderedTurns.length === 0) {
        resetTurnNavigator();
        return;
    }
    selectedTurnIndex = defaultSelectedTurnIndex(renderedTurns);
    renderTurnNavigator();
}
async function refreshTaskConversation(taskId) {
    if (!taskId) {
        renderedTaskMemoryKey = null;
        clearChatThread();
        renderTaskArtifactLinks(getLastState(), null);
        return;
    }
    const existingCard = (0, live_run_js_1.getLiveRunCard)(taskId);
    if (existingCard?.root.isConnected)
        return;
    const modelApi = getModelAPI();
    if (!modelApi?.getTaskMemory) {
        renderedTaskMemoryKey = `${taskId}:model-disabled`;
        clearChatThread();
        return;
    }
    const memory = await modelApi.getTaskMemory(taskId);
    const memoryKey = `${taskId}:${memory.lastUpdatedAt || 0}:${memory.entries.length}`;
    if (memoryKey === renderedTaskMemoryKey)
        return;
    renderedTaskMemoryKey = memoryKey;
    clearChatThread();
    const state = window.__lastState;
    const turns = buildConversationTurns(memory.entries);
    renderConversationTurns(turns, taskId);
    renderTaskArtifactLinks(state, taskId);
    scheduleChatScrollToBottom(true);
}
// ─── Chat Submission ───────────────────────────────────────────────────────
function getActiveTaskIdFromState() {
    const state = window.__lastState;
    return state?.activeTaskId || null;
}
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = reader.result;
            // Strip the "data:...;base64," prefix
            const base64 = dataUrl.split(',')[1] || '';
            resolve(base64);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}
function getElectronFilePath(file) {
    const candidate = file.path;
    return typeof candidate === 'string' && candidate.trim() ? candidate : undefined;
}
function getImageMediaType(file) {
    const type = file.type.toLowerCase();
    if (type === 'image/png')
        return 'image/png';
    if (type === 'image/gif')
        return 'image/gif';
    if (type === 'image/webp')
        return 'image/webp';
    return 'image/jpeg';
}
async function buildAttachments() {
    const imageFiles = attachedFiles.filter(f => f.type === 'image');
    if (imageFiles.length === 0)
        return [];
    const results = [];
    for (const entry of imageFiles) {
        const data = await fileToBase64(entry.file);
        results.push({
            type: 'image',
            mediaType: getImageMediaType(entry.file),
            data,
            name: entry.file.name,
            path: getElectronFilePath(entry.file),
        });
    }
    return results;
}
function buildDocumentImportRequests() {
    const documentFiles = attachedFiles.filter((entry) => entry.type === 'document');
    if (documentFiles.length === 0)
        return [];
    const missingPathNames = documentFiles
        .filter(({ file }) => !getElectronFilePath(file))
        .map(({ file }) => file.name);
    if (missingPathNames.length > 0) {
        throw new Error(`Document attachments require a local file path. Missing path for: ${missingPathNames.join(', ')}`);
    }
    return documentFiles.map(({ file }) => ({
        path: getElectronFilePath(file),
        name: file.name,
        mediaType: file.type || undefined,
        sizeBytes: file.size,
        lastModifiedMs: file.lastModified,
    }));
}
function buildPendingDocumentPreviews() {
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
async function submitChat() {
    const prompt = chatInput.value.trim();
    const hasImages = attachedFiles.some(f => f.type === 'image');
    const hasDocuments = attachedFiles.some(f => f.type === 'document');
    if (!prompt && !hasImages && !hasDocuments) {
        chatInput.focus();
        return;
    }
    const imageAttachments = await buildAttachments();
    const imageDataUrls = getAttachmentImageDataUrls(imageAttachments);
    const pendingDocumentPreviews = buildPendingDocumentPreviews();
    const modelApi = getModelAPI();
    if (!modelApi?.invoke) {
        const container = createTurnContainer();
        appendUserMessageToContainer(container, prompt, imageDataUrls, pendingDocumentPreviews);
        chatInput.value = '';
        clearAttachments();
        const disabledTaskId = `model-disabled-${chatCounter++}`;
        createLiveRunCard(disabledTaskId, 'system', undefined, container);
        replaceWithError(disabledTaskId, 'Model integration is not enabled in this v2 browser build.');
        getWorkspaceAPI()?.addLog('warn', 'system', 'Model integration is not enabled in this v2 browser build.');
        chatInput.focus();
        return;
    }
    chatCounter++;
    let taskId = getActiveTaskIdFromState();
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
        const titleSource = prompt || pendingDocumentPreviews[0]?.name || imageAttachments[0]?.name || 'Attachment';
        const title = titleSource.length > 48 ? `${titleSource.slice(0, 48)}...` : titleSource;
        const createdTask = await workspaceAPI.createTask(title);
        taskId = createdTask.id;
    }
    const resolvedOwner = owner;
    try {
        let documentAttachments = [];
        if (hasDocuments) {
            const attachmentApi = getAttachmentAPI();
            if (!attachmentApi?.importDocuments) {
                throw new Error('Document attachment import is not available in this build.');
            }
            documentAttachments = await attachmentApi.importDocuments(taskId, buildDocumentImportRequests());
        }
        const pendingAttachments = [...imageAttachments, ...documentAttachments];
        const effectivePrompt = prompt || (documentAttachments.length > 0 ? 'Review the attached document(s).' : prompt);
        const invokeOptions = pendingAttachments.length > 0 || effectivePrompt !== prompt
            ? {
                attachments: pendingAttachments.length > 0 ? pendingAttachments : undefined,
                displayPrompt: prompt,
            }
            : undefined;
        chatInput.value = '';
        const container = createTurnContainer();
        appendUserMessageToContainer(container, prompt, imageDataUrls, documentAttachments);
        const liveTurn = {
            index: renderedTurns.length,
            promptEntry: null,
            resultEntries: [],
            promptText: prompt,
            responseText: '',
            processEntries: [],
            attachments: pendingAttachments,
            createdAt: Date.now(),
            anchorEl: null,
        };
        registerRenderedTurn(liveTurn, container);
        selectTurn(liveTurn.index);
        clearAttachments();
        chatStopBtn.hidden = false;
        runningTaskId = taskId;
        createLiveRunCard(taskId, resolvedOwner, undefined, container);
        const result = await modelApi.invoke(taskId, effectivePrompt, resolvedOwner, invokeOptions);
        replaceWithResult(taskId, result, result?.providerId || resolvedOwner);
    }
    catch (err) {
        const message = err?.message || String(err);
        if (runningTaskId === taskId) {
            replaceWithError(taskId, message);
        }
        else {
            getWorkspaceAPI()?.addLog('error', 'system', `Failed to send chat: ${message}`, taskId);
        }
    }
    finally {
        runningTaskId = null;
        chatStopBtn.hidden = true;
        chatStopBtn.disabled = false;
        chatStopBtn.textContent = 'STOP';
        chatInput.focus();
    }
}
chatStopBtn.addEventListener('click', () => {
    const modelApi = getModelAPI();
    if (runningTaskId && modelApi?.cancel) {
        // Immediately mark the card as cancelling and disable the button
        (0, live_run_js_1.markCancelling)(runningTaskId);
        chatStopBtn.textContent = 'Stopping…';
        chatStopBtn.disabled = true;
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
chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void submitChat();
    }
});
// Idle-state suggestion chips — fill input on click
chatEmptyState.addEventListener('click', (e) => {
    const chip = e.target.closest('.cc-idle-chip');
    if (!chip)
        return;
    const prompt = chip.dataset.prompt;
    if (!prompt)
        return;
    chatInput.value = prompt;
    chatInput.focus();
    autosizeChatInput();
});
// Paste images directly into the textarea
chatInput.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items)
        return;
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
window.addEventListener('keydown', (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey)
        return;
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
function autosizeChatInput() {
    chatInput.style.height = 'auto';
    chatInput.style.height = `${chatInput.scrollHeight}px`;
}
turnPrevBtn.addEventListener('click', () => {
    if (selectedTurnIndex <= 0)
        return;
    selectTurn(selectedTurnIndex - 1, { scroll: true });
});
turnNextBtn.addEventListener('click', () => {
    if (selectedTurnIndex >= renderedTurns.length - 1)
        return;
    selectTurn(selectedTurnIndex + 1, { scroll: true });
});
turnReuseBtn.addEventListener('click', () => {
    if (selectedTurnIndex < 0)
        return;
    const prompt = renderedTurns[selectedTurnIndex]?.promptText?.trim();
    if (!prompt)
        return;
    chatInput.value = prompt;
    autosizeChatInput();
    chatInput.focus();
});
// ─── Chat History ─────────────────────────────────────────────────────────
function formatHistoryDate(timestamp) {
    const d = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1)
        return 'just now';
    if (diffMins < 60)
        return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24)
        return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7)
        return `${diffDays}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function findTaskById(state, taskId) {
    if (!state || !taskId)
        return null;
    return state.tasks.find((task) => task.id === taskId) ?? null;
}
function findArtifactById(state, artifactId) {
    if (!state || !artifactId)
        return null;
    return state.artifacts.find((artifact) => artifact.id === artifactId) ?? null;
}
function getSortedArtifacts(state) {
    if (!state)
        return [];
    return [...state.artifacts].sort((a, b) => b.updatedAt - a.updatedAt);
}
function getTaskArtifacts(state, taskId) {
    const task = findTaskById(state, taskId);
    if (!task)
        return [];
    return task.artifactIds
        .map((artifactId) => findArtifactById(state, artifactId))
        .filter((artifact) => Boolean(artifact));
}
function createArtifactLabel(artifact) {
    return `${artifact.title} (${artifact.format})`;
}
function setHistoryOpen(open) {
    if (open && artifactSidebarCollapsed) {
        setArtifactSidebarCollapsed(false);
    }
    historyOpen = open;
    historyOverlay.hidden = !open;
    chatHistoryBtn.classList.toggle('active', open);
    chatHistoryBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
}
async function selectArtifact(artifactId) {
    const workspaceAPI = getWorkspaceAPI();
    if (!workspaceAPI)
        return;
    try {
        await workspaceAPI.artifacts.setActive(artifactId);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void workspaceAPI.addLog('error', 'system', `Failed to select artifact: ${message}`);
    }
}
async function openArtifactInDocumentWindow(artifactId) {
    const workspaceAPI = getWorkspaceAPI();
    if (!workspaceAPI)
        return;
    const state = getLastState();
    const artifact = findArtifactById(state, artifactId);
    if (!artifact)
        return;
    try {
        await workspaceAPI.document.openArtifact(artifactId);
        await workspaceAPI.addLog('info', 'system', `Opened document window for artifact "${artifact.title}"`, state?.activeTaskId || undefined);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void workspaceAPI.addLog('error', 'system', `Failed to open artifact document window: ${message}`);
    }
}
async function deleteArtifact(artifactId) {
    const workspaceAPI = getWorkspaceAPI();
    if (!workspaceAPI)
        return;
    const state = getLastState();
    const artifact = findArtifactById(state, artifactId);
    if (!artifact)
        return;
    if (!window.confirm(`Delete artifact "${artifact.title}"? This removes its managed file and registry entry.`)) {
        return;
    }
    try {
        await workspaceAPI.artifacts.delete(artifactId, 'user');
        await workspaceAPI.addLog('info', 'system', `Deleted artifact "${artifact.title}"`, state?.activeTaskId || undefined);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void workspaceAPI.addLog('error', 'system', `Failed to delete artifact: ${message}`);
    }
}
function renderActiveArtifact(state) {
    const activeArtifact = findArtifactById(state, state?.activeArtifactId ?? null);
    activeArtifactEmpty.hidden = Boolean(activeArtifact);
    activeArtifactBody.hidden = !activeArtifact;
    activeArtifactCard.classList.toggle('has-active-artifact', Boolean(activeArtifact));
    if (!activeArtifact) {
        activeArtifactTitle.textContent = '';
        activeArtifactFormat.textContent = '';
        activeArtifactMeta.textContent = '';
        activeArtifactOpenBtn.disabled = true;
        activeArtifactDeleteBtn.disabled = true;
        return;
    }
    activeArtifactTitle.textContent = activeArtifact.title;
    activeArtifactFormat.textContent = activeArtifact.format;
    activeArtifactMeta.textContent = `Updated ${formatHistoryDate(activeArtifact.updatedAt)} · ${activeArtifact.status} · active artifact`;
    activeArtifactOpenBtn.disabled = false;
    activeArtifactOpenBtn.textContent = 'Open Window';
    activeArtifactOpenBtn.title = 'Open in Document window';
    activeArtifactOpenBtn.setAttribute('aria-label', `Open ${activeArtifact.title} in Document window`);
    activeArtifactOpenBtn.onclick = () => { void openArtifactInDocumentWindow(activeArtifact.id); };
    activeArtifactDeleteBtn.disabled = false;
    activeArtifactDeleteBtn.textContent = 'Delete';
    activeArtifactDeleteBtn.title = 'Delete artifact';
    activeArtifactDeleteBtn.setAttribute('aria-label', `Delete ${activeArtifact.title}`);
    activeArtifactDeleteBtn.onclick = () => { void deleteArtifact(activeArtifact.id); };
}
function renderArtifactList(state) {
    const artifacts = getSortedArtifacts(state);
    artifactList.innerHTML = '';
    if (artifacts.length === 0) {
        artifactList.innerHTML = '<div class="cc-artifact-empty">No artifacts yet. Artifacts created through tasks will appear here.</div>';
        return;
    }
    for (const artifact of artifacts) {
        const item = document.createElement('div');
        item.className = 'cc-artifact-item' + (artifact.id === state?.activeArtifactId ? ' active' : '');
        item.setAttribute('role', 'button');
        item.tabIndex = 0;
        item.title = artifact.id === state?.activeArtifactId ? 'Selected as active artifact' : 'Select as active artifact';
        const main = document.createElement('div');
        main.className = 'cc-artifact-item-main';
        const titleRow = document.createElement('div');
        titleRow.className = 'cc-artifact-item-title-row';
        if (artifact.id === state?.activeArtifactId) {
            const dot = document.createElement('span');
            dot.className = 'cc-artifact-active-dot';
            titleRow.appendChild(dot);
        }
        const title = document.createElement('span');
        title.className = 'cc-artifact-item-title';
        title.textContent = artifact.title;
        titleRow.appendChild(title);
        const meta = document.createElement('div');
        meta.className = 'cc-artifact-item-meta';
        meta.innerHTML =
            `<span>${(0, utils_js_1.escapeHtml)(artifact.format)}</span>` +
                `<span>${(0, utils_js_1.escapeHtml)(formatHistoryDate(artifact.updatedAt))}</span>` +
                `<span class="cc-artifact-status">${(0, utils_js_1.escapeHtml)(artifact.status)}</span>`;
        main.append(titleRow, meta);
        const actions = document.createElement('div');
        actions.className = 'cc-artifact-item-actions';
        const openBtn = document.createElement('button');
        openBtn.className = 'cc-artifact-open-btn';
        openBtn.type = 'button';
        openBtn.textContent = 'Open Window';
        openBtn.title = 'Open in Document window';
        openBtn.setAttribute('aria-label', `Open ${artifact.title} in Document window`);
        openBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            void openArtifactInDocumentWindow(artifact.id);
        });
        actions.appendChild(openBtn);
        const handleSelect = () => { void selectArtifact(artifact.id); };
        item.addEventListener('click', handleSelect);
        item.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handleSelect();
            }
        });
        item.append(main, actions);
        artifactList.appendChild(item);
    }
}
function renderTaskArtifactLinks(state, taskId) {
    const existing = chatInner.querySelector('.cc-task-artifact-links');
    const linkedArtifacts = getTaskArtifacts(state, taskId);
    if (!taskId || linkedArtifacts.length === 0) {
        existing?.remove();
        return;
    }
    const container = existing ?? document.createElement('div');
    container.className = 'cc-task-artifact-links';
    container.innerHTML = '';
    const label = document.createElement('div');
    label.className = 'cc-task-artifact-links-label';
    label.textContent = 'Task Artifacts';
    const row = document.createElement('div');
    row.className = 'cc-task-artifact-links-row';
    for (const artifact of linkedArtifacts) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'cc-task-artifact-link' + (artifact.id === state?.activeArtifactId ? ' active' : '');
        button.title = createArtifactLabel(artifact);
        button.setAttribute('aria-label', `Select active artifact ${createArtifactLabel(artifact)}`);
        button.addEventListener('click', () => { void selectArtifact(artifact.id); });
        const title = document.createElement('span');
        title.className = 'cc-task-artifact-link-title';
        title.textContent = artifact.title;
        const format = document.createElement('span');
        format.className = 'cc-task-artifact-link-format';
        format.textContent = artifact.format;
        button.append(title, format);
        row.appendChild(button);
    }
    container.append(label, row);
    chatInner.appendChild(container);
}
function renderHistoryPanel(state) {
    const tasks = state?.tasks ?? [];
    const activeId = state?.activeTaskId ?? null;
    historyList.innerHTML = '';
    if (tasks.length === 0) {
        historyList.innerHTML = '<div class="cc-history-empty">No conversations yet.</div>';
        return;
    }
    const sorted = [...tasks].sort((a, b) => b.updatedAt - a.updatedAt);
    for (const task of sorted) {
        const item = document.createElement('div');
        item.className = 'cc-history-item' + (task.id === activeId ? ' active' : '');
        const title = document.createElement('span');
        title.className = 'cc-history-item-title';
        title.textContent = task.title;
        const date = document.createElement('span');
        date.className = 'cc-history-item-date';
        date.textContent = formatHistoryDate(task.updatedAt);
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
            setHistoryOpen(false);
        });
        historyList.appendChild(item);
    }
}
function openHistoryPopup() {
    renderHistoryPanel(getLastState());
    setHistoryOpen(true);
}
function closeHistoryPopup() {
    setHistoryOpen(false);
    chatInput.focus();
}
async function deleteHistoryTask(taskId) {
    const workspaceAPI = getWorkspaceAPI();
    if (!workspaceAPI)
        return;
    try {
        await workspaceAPI.deleteTask(taskId);
        const nextState = await workspaceAPI.getState();
        renderState(nextState);
        if (historyOpen)
            openHistoryPopup();
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void workspaceAPI.addLog('error', 'system', `Failed to delete chat: ${message}`);
    }
}
async function startNewChat() {
    const workspaceAPI = getWorkspaceAPI();
    if (!workspaceAPI)
        return;
    setHistoryOpen(false);
    // Clear active task — will show empty state
    await workspaceAPI.setActiveTask(null);
    currentRenderedTaskId = null;
    renderedTaskMemoryKey = null;
    clearChatThread();
    chatInput.focus();
}
function switchToTask(taskId) {
    const workspaceAPI = getWorkspaceAPI();
    if (!workspaceAPI)
        return;
    void workspaceAPI.setActiveTask(taskId);
    // renderState will pick up the change and call refreshTaskConversation
}
chatHistoryBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!historyOverlay.hidden) {
        closeHistoryPopup();
    }
    else {
        openHistoryPopup();
    }
});
artifactSidebarToggle.addEventListener('click', () => {
    const nextCollapsed = !artifactSidebarCollapsed;
    if (nextCollapsed && historyOpen) {
        setHistoryOpen(false);
    }
    setArtifactSidebarCollapsed(nextCollapsed);
});
historyCloseBtn.addEventListener('click', closeHistoryPopup);
historyNewBtn.addEventListener('click', () => { void startNewChat(); });
chatNewBtn.addEventListener('click', () => { void startNewChat(); });
// Close on Escape
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && logsOpen) {
        e.preventDefault();
        setLogsOpen(false);
        return;
    }
    if (e.key === 'Escape' && historyOpen) {
        e.preventDefault();
        closeHistoryPopup();
    }
});
// ─── Token Usage Display ──────────────────────────────────────────────────
function formatTokenCount(n) {
    if (n < 1000)
        return String(n);
    if (n < 1_000_000)
        return `${(n / 1000).toFixed(1)}k`;
    return `${(n / 1_000_000).toFixed(2)}M`;
}
function updateTokenUsageDisplay(state) {
    const usage = state?.tokenUsage;
    if (!usage)
        return;
    tokenStatusLabel.textContent = `${formatTokenCount(usage.inputTokens)} in / ${formatTokenCount(usage.outputTokens)} out`;
}
// ─── Full State Render ─────────────────────────────────────────────────────
function renderState(state) {
    window.__lastState = state;
    const normalizedOwner = normalizeSelectedOwner(selectedOwner, state);
    if (normalizedOwner !== selectedOwner) {
        selectedOwner = normalizedOwner;
        persistSelectedOwner();
    }
    else {
        selectedOwner = normalizedOwner;
    }
    syncModelToggleState(state);
    const active = state.tasks.find((t) => t.id === state.activeTaskId);
    renderLogs(state.logs);
    renderActiveArtifact(state);
    renderArtifactList(state);
    renderHistoryPanel(state);
    renderTaskArtifactLinks(state, state.activeTaskId);
    taskCount.textContent = `tasks: ${state.tasks.length}`;
    updateTokenUsageDisplay(state);
    taskSummary.hidden = !active;
    taskSummary.textContent = active ? `${active.title} · ${active.status}` : '';
    const activeProviderId = active?.owner && active.owner !== 'user'
        ? active.owner
        : null;
    const footerOwner = activeProviderId && isExplicitSelectableOwner(activeProviderId)
        ? activeProviderId
        : selectedOwner;
    modelLabel.textContent = OWNER_LABELS[footerOwner];
    syncModelToggleState(state);
    const nextTaskId = state.activeTaskId || null;
    if (nextTaskId !== currentRenderedTaskId) {
        currentRenderedTaskId = nextTaskId;
        renderedTaskMemoryKey = null;
        void refreshTaskConversation(nextTaskId);
    }
    else if (!nextTaskId || !(0, live_run_js_1.getLiveRunCard)(nextTaskId)?.root.isConnected) {
        void refreshTaskConversation(nextTaskId);
    }
}
// ─── Live Updates ──────────────────────────────────────────────────────────
const commandWindowAPI = getWorkspaceAPI();
const modelApi = getModelAPI();
if (commandWindowAPI && modelApi?.onProgress) {
    modelApi.onProgress((progress) => {
        const card = progress?.taskId ? (0, live_run_js_1.getLiveRunCard)(progress.taskId) : null;
        if (!card?.root.isConnected)
            return;
        if (progress.type === 'token') {
            appendToken(progress.taskId, String(progress.data || ''));
            return;
        }
        if (progress.type === 'item') {
            appendCodexItemProgress(progress.taskId, String(progress.data || ''), progress.codexItem);
            return;
        }
        if (progress.type === 'status') {
            const text = String(progress.data || '');
            if (text === 'thought-migrate') {
                migrateBufferedOutputToThoughts(progress.taskId);
            }
            else if (text.startsWith('thought:')) {
                appendThought(progress.taskId, text.slice('thought:'.length));
            }
            else if (text.startsWith('tool-start:') || text.startsWith('tool-done:') || text.startsWith('tool-progress:')) {
                (0, live_run_js_1.appendToolStatus)(progress.taskId, text);
            }
            else if (text.startsWith('Calling ')) {
                appendToolActivity(progress.taskId, 'call', text.replace(/^Calling\s+/, '').replace(/\.\.\.$/, ''));
            }
            else if (text.startsWith('Tool result: ')) {
                appendToolActivity(progress.taskId, 'result', text.slice('Tool result: '.length));
            }
            else if (text && !/^Turn completed/.test(text)) {
                appendThought(progress.taskId, text);
            }
        }
    });
}
const attachedFiles = [];
function syncAttachmentPreview() {
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
                `<img src="${entry.previewUrl}" alt="${(0, utils_js_1.escapeHtml)(entry.file.name)}">` +
                    `<span class="cc-preview-name">${(0, utils_js_1.escapeHtml)(entry.file.name)}</span>` +
                    `<button class="cc-preview-remove" data-index="${i}" title="Remove" aria-label="Remove ${(0, utils_js_1.escapeHtml)(entry.file.name)}">&times;</button>`;
        }
        else {
            item.innerHTML =
                `<div class="cc-attach-preview-doc">` +
                    `<svg viewBox="0 0 16 16"><path d="M9 1.5H4.5a2 2 0 00-2 2v9a2 2 0 002 2h7a2 2 0 002-2V6L9 1.5z" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 1.5V6h4.5" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>` +
                    `<span class="cc-preview-doc-name">${(0, utils_js_1.escapeHtml)(entry.file.name)}</span>` +
                    `</div>` +
                    `<button class="cc-preview-remove" data-index="${i}" title="Remove" aria-label="Remove ${(0, utils_js_1.escapeHtml)(entry.file.name)}">&times;</button>`;
        }
        attachPreviewList.appendChild(item);
    }
}
function addFiles(files, type) {
    for (const file of Array.from(files)) {
        const entry = { file, type };
        if (type === 'image') {
            entry.previewUrl = URL.createObjectURL(file);
        }
        attachedFiles.push(entry);
    }
    syncAttachmentPreview();
}
function removeAttachment(index) {
    const removed = attachedFiles.splice(index, 1);
    if (removed[0]?.previewUrl) {
        URL.revokeObjectURL(removed[0].previewUrl);
    }
    syncAttachmentPreview();
}
function clearAttachments() {
    for (const entry of attachedFiles) {
        if (entry.previewUrl)
            URL.revokeObjectURL(entry.previewUrl);
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
attachPreviewList.addEventListener('click', (e) => {
    const target = e.target;
    const removeBtn = target.closest('.cc-preview-remove');
    if (!removeBtn)
        return;
    const idx = parseInt(removeBtn.dataset.index || '', 10);
    if (!isNaN(idx))
        removeAttachment(idx);
});
// ─── Init ──────────────────────────────────────────────────────────────────
setLogsOpen(false);
initializeChatZoom();
initializeModelToggle();
initializeArtifactSidebar();
if (!commandWindowAPI) {
    console.error('[command] workspaceAPI is not available; command controls are disabled.');
}
else {
    commandWindowAPI.onStateUpdate((state) => renderState(state));
    commandWindowAPI.getState().then((state) => {
        renderState(state);
        commandWindowAPI.addLog('info', 'system', 'Command Center initialized');
    }).catch((error) => {
        console.error('[command] Failed to initialize command renderer:', error);
    });
}
//# sourceMappingURL=command.js.map