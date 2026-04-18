"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLiveRunCard = getLiveRunCard;
exports.hasLiveRunCard = hasLiveRunCard;
exports.createLiveRunCard = createLiveRunCard;
exports.markCancelling = markCancelling;
exports.appendToken = appendToken;
exports.appendThought = appendThought;
exports.migrateBufferedOutputToThoughts = migrateBufferedOutputToThoughts;
exports.appendToolActivity = appendToolActivity;
exports.appendToolStatus = appendToolStatus;
exports.appendCodexItemProgress = appendCodexItemProgress;
exports.replaceWithResult = replaceWithResult;
exports.replaceWithError = replaceWithError;
const utils_js_1 = require("../shared/utils.js");
const process_disclosure_js_1 = require("./process-disclosure.js");
const liveRunCards = new Map();
const INITIAL_LIVE_STATUS_TEXT = 'Thinking...';
function getLiveRunCard(taskId) {
    return liveRunCards.get(taskId) ?? null;
}
function hasLiveRunCard(taskId) {
    return liveRunCards.has(taskId);
}
// ─── Card Creation ──────────────────────────────────────────────────────────
function createLiveRunCard(taskId, _provider, container, callbacks, _prompt) {
    container.querySelector('.cc-chat-empty')?.remove();
    const root = document.createElement('div');
    root.className = 'chat-msg chat-msg-model chat-msg-live';
    root.dataset.taskId = taskId;
    root.innerHTML =
        `<div class="chat-msg-text chat-live-status-text">${(0, utils_js_1.escapeHtml)(INITIAL_LIVE_STATUS_TEXT)}</div>` +
            `<div class="chat-live-panel chat-live-panel-empty">` +
            `<div class="chat-stream"></div>` +
            `</div>`;
    container.appendChild(root);
    const card = {
        root,
        panel: root.querySelector('.chat-live-panel'),
        stream: root.querySelector('.chat-stream'),
        output: root.querySelector('.chat-msg-text'),
        response: null,
        cancelling: false,
        activeToolEl: null,
        lastThoughtEl: null,
        typingQueue: [],
        typingTimer: null,
        activeThoughtEl: null,
        deferredToolEvents: [],
        tokenBuffer: '',
        tokenVisibleLength: 0,
        tokenTypingTimer: null,
        pendingFinalResult: null,
        pendingErrorText: null,
        callbacks,
    };
    liveRunCards.set(taskId, card);
    syncLivePanelScroll(card);
    return card;
}
// ─── Cancel / Stopping ──────────────────────────────────────────────────────
function markCancelling(taskId) {
    const card = liveRunCards.get(taskId);
    if (!card || card.cancelling)
        return;
    card.cancelling = true;
    // Stop the typewriter — freeze visible output where it is
    if (card.tokenTypingTimer !== null) {
        window.cancelAnimationFrame(card.tokenTypingTimer);
        card.tokenTypingTimer = null;
    }
    // Clear the streaming cursor class
    card.output.classList.remove('chat-msg-streaming');
    card.response?.classList.remove('chat-msg-streaming');
    // Stop any active shimmer tool line
    if (card.activeToolEl) {
        card.activeToolEl.className = 'chat-tool-line chat-tool-done';
        const textEl = card.activeToolEl.querySelector('.tool-text');
        if (textEl)
            textEl.className = 'tool-text';
        card.activeToolEl = null;
    }
    clearWaitingShimmer(card);
    // Add a "stopped" indicator line in the stream
    const stoppedEl = document.createElement('div');
    stoppedEl.className = 'chat-tool-line chat-cancelling-note';
    stoppedEl.textContent = 'Stopped';
    card.stream.appendChild(stoppedEl);
    syncLivePanelScroll(card);
    // Mark root so CSS can dim/settle the card
    card.root.classList.add('chat-msg-cancelling');
}
// ─── Token Streaming ────────────────────────────────────────────────────────
function appendToken(taskId, text) {
    const card = liveRunCards.get(taskId);
    if (!card || card.cancelling)
        return;
    if (!text)
        return;
    card.tokenBuffer += text;
    card.root.classList.toggle('chat-msg-live-has-output', card.tokenBuffer.trim().length > 0);
    const renderTarget = getStreamingRenderTarget(card);
    card.tokenVisibleLength = card.tokenBuffer.length;
    renderTarget.className = 'chat-msg-text chat-markdown chat-msg-streaming';
    renderTarget.innerHTML = card.callbacks.renderMarkdown(card.tokenBuffer);
    card.callbacks.updateLastAgentResponseText(card.tokenBuffer);
    syncLivePanelScroll(card);
    flushPendingIfReady(taskId, card);
}
function flushPendingIfReady(taskId, card) {
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
function splitIntoSentences(text) {
    const normalized = text.replace(/\r\n/g, '\n').trim();
    if (!normalized)
        return [];
    const lines = normalized.split('\n').map(l => l.trim()).filter(Boolean);
    const chunks = [];
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
                    }
                    else {
                        current = candidate;
                    }
                }
                if (current)
                    chunks.push(current);
            }
            else {
                chunks.push(line);
            }
            continue;
        }
        for (const s of sentences) {
            const trimmed = s.trim();
            if (trimmed)
                chunks.push(trimmed);
        }
    }
    return chunks;
}
function clearWaitingShimmer(card) {
    if (card.lastThoughtEl) {
        card.lastThoughtEl.classList.remove('chat-thought-waiting');
    }
}
function syncLivePanelScroll(card) {
    if (!card.panel.isConnected)
        return;
    card.panel.scrollTop = card.panel.scrollHeight;
}
function ensureLivePanelVisible(card) {
    card.panel.classList.remove('chat-live-panel-empty');
}
function clearInitialLiveStatus(card) {
    if (card.tokenBuffer.length > 0)
        return;
    if (!card.output.classList.contains('chat-live-status-text'))
        return;
    card.output.textContent = '';
}
function hasRenderedProcess(card) {
    if (card.stream.childElementCount > 0)
        return true;
    return Boolean(card.panel.querySelector('.chat-live-process-details'));
}
function retractLiveProcess(card) {
    const existing = card.panel.querySelector('.chat-live-process-details');
    if (existing) {
        existing.open = false;
        card.panel.classList.add('chat-live-panel-retracted');
        card.panel.classList.remove('chat-live-panel-empty');
        return;
    }
    if (!card.stream.parentNode || card.stream.childElementCount === 0)
        return;
    const details = document.createElement('details');
    details.className = 'chat-process-details chat-live-process-details';
    details.open = false;
    const summary = document.createElement('summary');
    summary.className = 'chat-process-summary chat-live-process-summary';
    summary.textContent = getProcessSummaryLabel(card);
    details.appendChild(summary);
    const inner = document.createElement('div');
    inner.className = 'chat-process-inner chat-live-process-inner';
    inner.appendChild(card.stream);
    details.appendChild(inner);
    card.panel.appendChild(details);
    card.panel.classList.add('chat-live-panel-retracted');
    card.panel.classList.remove('chat-live-panel-empty');
}
function ensureResponseSlot(card) {
    if (card.response?.isConnected)
        return card.response;
    const response = document.createElement('div');
    response.className = 'chat-msg-text';
    response.dataset.liveRole = 'response';
    card.panel.insertAdjacentElement('afterend', response);
    card.response = response;
    return response;
}
function getStreamingRenderTarget(card) {
    if (hasRenderedProcess(card)) {
        retractLiveProcess(card);
        return ensureResponseSlot(card);
    }
    clearInitialLiveStatus(card);
    return card.output;
}
function getProcessSummaryLabel(card) {
    const toolCount = card.stream.querySelectorAll('.chat-tool-line').length;
    return (0, process_disclosure_js_1.getProcessSummaryLabel)(toolCount);
}
const NEUTRAL_LIVE_STATUS_TEXT = 'Working...';
function isUserFacingLiveStatus(text) {
    const trimmed = text.trim();
    if (!trimmed)
        return false;
    if (trimmed.endsWith('?'))
        return true;
    const lower = trimmed.toLowerCase();
    if (/(^|\b)(need|needs|choose|confirm|select|pick|provide|enter|paste|upload|share|tell me|let me know|which|what|where|when)(\b|$)/.test(lower)) {
        return true;
    }
    if (/(^|\b)(blocked|cannot|can't|unable|missing|permission|permissions|sign in|login|log in|authenticate|approval required)(\b|$)/.test(lower)) {
        return true;
    }
    return false;
}
function normalizeLiveStatusText(text) {
    return isUserFacingLiveStatus(text) ? text.trim() : NEUTRAL_LIVE_STATUS_TEXT;
}
function appendThought(taskId, text) {
    const card = liveRunCards.get(taskId);
    if (!card || card.cancelling)
        return;
    if (card.tokenBuffer.length > 0)
        return;
    const trimmed = text.trim();
    if (!trimmed)
        return;
    // Skip raw tool transcripts
    if (/^\+?\s*tool\b/i.test(trimmed) || /^tool (result|call):/i.test(trimmed))
        return;
    // Skip internal sections
    if (/^##\s*(Critique Summary|Observation|Inference)\b/.test(trimmed))
        return;
    const chunks = splitIntoSentences(trimmed);
    const normalizedChunks = chunks.length > 0 ? chunks : [trimmed];
    ensureLivePanelVisible(card);
    clearInitialLiveStatus(card);
    card.typingQueue.push(...normalizedChunks);
    if (card.typingTimer !== null)
        return;
    typeNextChunk(card, taskId);
}
function migrateBufferedOutputToThoughts(taskId) {
    const card = liveRunCards.get(taskId);
    if (!card || card.cancelling)
        return;
    const text = card.tokenBuffer.trim();
    if (!text)
        return;
    card.tokenBuffer = '';
    card.tokenVisibleLength = 0;
    card.root.classList.remove('chat-msg-live-has-output');
    card.output.className = 'chat-msg-text chat-live-status-text';
    card.output.textContent = '';
    card.callbacks.updateLastAgentResponseText('');
    appendThought(taskId, text);
}
function typeNextChunk(card, taskId) {
    clearWaitingShimmer(card);
    while (card.typingQueue.length > 0) {
        const next = card.typingQueue.shift();
        if (!next)
            continue;
        const el = document.createElement('div');
        el.className = 'chat-thought-line';
        el.innerHTML = (0, utils_js_1.escapeHtml)(next)
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
        const event = card.deferredToolEvents.shift();
        renderToolLine(card, taskId, event.kind, event.text);
    }
    syncLivePanelScroll(card);
    card.callbacks.scheduleChatScrollToBottom(false, 1);
}
// ─── Tool Lines (indented, shimmer when active, solid when done) ────────────
function renderToolLine(card, taskId, kind, text) {
    clearWaitingShimmer(card);
    ensureLivePanelVisible(card);
    clearInitialLiveStatus(card);
    if (kind === 'start') {
        // Create a new active tool line with shimmer
        const el = document.createElement('div');
        el.className = 'chat-tool-line chat-tool-active';
        el.innerHTML =
            `<span class="tool-dot"></span>` +
                `<span class="tool-text tool-text-shimmer">${(0, utils_js_1.escapeHtml)(text)}</span>`;
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
    }
    else {
        // No active line to update — create a completed line directly
        const el = document.createElement('div');
        el.className = 'chat-tool-line chat-tool-done';
        el.innerHTML =
            `<span class="tool-dot"></span>` +
                `<span class="tool-text">${(0, utils_js_1.escapeHtml)(text)}</span>`;
        card.stream.appendChild(el);
    }
    syncLivePanelScroll(card);
    card.callbacks.scheduleChatScrollToBottom(false, 1);
}
function appendToolActivity(taskId, kind, text) {
    const card = liveRunCards.get(taskId);
    if (!card)
        return;
    // Map old call/result to new start/done
    const newKind = kind === 'call' ? 'start' : 'done';
    renderToolLine(card, taskId, newKind, text);
}
function appendToolStatus(taskId, status) {
    const card = liveRunCards.get(taskId);
    if (!card || card.cancelling)
        return;
    if (status.startsWith('tool-start:')) {
        const text = status.slice('tool-start:'.length);
        renderToolLine(card, taskId, 'start', text);
        return;
    }
    if (status.startsWith('tool-done:')) {
        const text = status.slice('tool-done:'.length);
        renderToolLine(card, taskId, 'done', text);
        return;
    }
    if (status.startsWith('tool-progress:')) {
        const text = status.slice('tool-progress:'.length);
        if (card.activeToolEl) {
            const textEl = card.activeToolEl.querySelector('.tool-text');
            if (textEl) {
                textEl.className = 'tool-text tool-text-shimmer';
                textEl.textContent = text;
            }
            syncLivePanelScroll(card);
            card.callbacks.scheduleChatScrollToBottom(false, 1);
            return;
        }
        renderToolLine(card, taskId, 'start', text);
        return;
    }
    // Any other status text → treat as a thought
    appendThought(taskId, status);
}
// ─── Codex Item Progress (compatibility) ────────────────────────────────────
function summarizeUnknownForUi(value, max = 100) {
    if (value == null)
        return 'done';
    if (typeof value === 'string') {
        const t = value.trim();
        return t.length > max ? `${t.slice(0, max - 3)}...` : t;
    }
    try {
        const s = JSON.stringify(value);
        return s.length > max ? `${s.slice(0, max - 3)}...` : s;
    }
    catch {
        return String(value).slice(0, max);
    }
}
function appendCodexItemProgress(taskId, progressData, item) {
    if (!item)
        return;
    if (item.type === 'agent_message')
        return;
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
        }
        else if (completed) {
            const detail = item.exit_code == null ? 'done' : (item.exit_code === 0 ? 'done' : `exit ${item.exit_code}`);
            appendToolStatus(taskId, `tool-done:Run ${item.command} ... ${detail}`);
        }
        else if (failed) {
            appendToolStatus(taskId, `tool-done:Run ${item.command} ... failed`);
        }
        return;
    }
    if (item.type === 'file_change' && completed) {
        const detail = item.changes.map((change) => `${change.kind} ${change.path}`).join(', ') || 'updated files';
        appendToolStatus(taskId, `tool-done:File change ... ${detail}`);
    }
    else if (item.type === 'file_change' && failed) {
        appendToolStatus(taskId, `tool-done:File change ... error`);
    }
}
// ─── Final Result / Error ───────────────────────────────────────────────────
function collapseStreamIntoDisclosure(card) {
    const liveDetails = card.panel.querySelector('.chat-live-process-details');
    if (liveDetails) {
        liveDetails.classList.remove('chat-live-process-details');
        liveDetails.open = false;
        const summary = liveDetails.querySelector('.chat-live-process-summary');
        summary?.classList.remove('chat-live-process-summary');
        const inner = liveDetails.querySelector('.chat-live-process-inner');
        inner?.classList.remove('chat-live-process-inner');
        const anchor = card.response ?? card.output;
        const anchorParent = anchor.parentNode;
        if (anchorParent) {
            anchor.insertAdjacentElement('beforebegin', liveDetails);
        }
        else {
            card.panel.parentNode?.appendChild(liveDetails);
        }
        return;
    }
    const streamEl = card.stream;
    if (!streamEl.parentNode)
        return;
    const children = Array.from(streamEl.children);
    if (children.length === 0) {
        streamEl.remove();
        return;
    }
    const toolCount = children.filter(el => el.classList.contains('chat-tool-line')).length;
    const { details, inner } = (0, process_disclosure_js_1.createProcessDisclosureShell)(toolCount);
    inner.appendChild(streamEl);
    const anchor = card.response ?? card.output;
    const anchorParent = anchor.parentNode;
    if (anchorParent) {
        anchor.insertAdjacentElement('beforebegin', details);
    }
    else {
        streamEl.parentNode.appendChild(details);
    }
}
function releaseLivePanel(card) {
    const panel = card.panel;
    const parent = panel.parentNode;
    if (!parent)
        return;
    while (panel.firstChild) {
        parent.insertBefore(panel.firstChild, panel);
    }
    panel.remove();
}
function flushFinalResult(taskId, result, _provider) {
    const card = liveRunCards.get(taskId);
    if (!card)
        return;
    clearWaitingShimmer(card);
    const renderTarget = card.response ?? card.output;
    if (result.success) {
        const finalOutput = String(result.output || '');
        if (finalOutput && finalOutput !== card.tokenBuffer) {
            renderTarget.className = 'chat-msg-text chat-markdown';
            renderTarget.innerHTML = card.callbacks.renderMarkdown(finalOutput);
        }
        else {
            renderTarget.className = 'chat-msg-text chat-markdown';
            if (!finalOutput) {
                renderTarget.innerHTML = '';
            }
        }
        if (finalOutput) {
            card.callbacks.updateLastAgentResponseText(finalOutput);
        }
    }
    else {
        renderTarget.className = 'chat-msg-error';
        const errorText = result.error || 'Unknown error';
        renderTarget.textContent = errorText;
        card.callbacks.updateLastAgentResponseText(String(errorText));
    }
    // Remove the prompt line and collapse stream into disclosure
    collapseStreamIntoDisclosure(card);
    releaseLivePanel(card);
    card.root.classList.remove('chat-msg-live');
    card.root.classList.remove('chat-msg-live-has-output');
    card.root.classList.add('chat-msg-done');
    card.callbacks.scheduleChatScrollToBottom(false, 6);
}
function replaceWithResult(taskId, result, provider) {
    const card = liveRunCards.get(taskId);
    if (!card)
        return;
    if (card.tokenVisibleLength < card.tokenBuffer.length) {
        card.pendingFinalResult = { result, provider };
        return;
    }
    flushFinalResult(taskId, result, provider);
}
function flushError(taskId, error) {
    const card = liveRunCards.get(taskId);
    if (!card)
        return;
    card.output.className = 'chat-msg-error';
    card.output.textContent = error;
    card.callbacks.updateLastAgentResponseText(String(error));
    releaseLivePanel(card);
    card.root.classList.remove('chat-msg-live');
    card.root.classList.remove('chat-msg-live-has-output');
    card.root.classList.add('chat-msg-done');
    card.callbacks.scheduleChatScrollToBottom(false, 6);
}
function replaceWithError(taskId, error) {
    const card = liveRunCards.get(taskId);
    if (!card)
        return;
    if (card.tokenVisibleLength < card.tokenBuffer.length) {
        card.pendingErrorText = error;
        return;
    }
    flushError(taskId, error);
}
//# sourceMappingURL=live-run.js.map