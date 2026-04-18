"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProcessSummaryLabel = getProcessSummaryLabel;
exports.createProcessDisclosureShell = createProcessDisclosureShell;
exports.createProcessDisclosure = createProcessDisclosure;
const utils_js_1 = require("../shared/utils.js");
function getProcessSummaryLabel(toolCount) {
    return toolCount > 0 ? `${toolCount} tool${toolCount === 1 ? '' : 's'} used` : 'Show process';
}
function createProcessDisclosureShell(toolCount, options = {}) {
    const details = document.createElement('details');
    details.className = options.detailsClassName ?? 'chat-process-details';
    details.open = options.open ?? false;
    const summary = document.createElement('summary');
    summary.className = options.summaryClassName ?? 'chat-process-summary';
    summary.textContent = getProcessSummaryLabel(toolCount);
    details.appendChild(summary);
    const inner = document.createElement('div');
    inner.className = options.innerClassName ?? 'chat-process-inner';
    details.appendChild(inner);
    return { details, inner };
}
function createProcessDisclosure(entries, options = {}) {
    const normalized = entries
        .map((entry) => ({
        kind: entry.kind,
        text: entry.text.trim(),
    }))
        .filter((entry) => entry.text.length > 0);
    if (normalized.length === 0)
        return null;
    const toolCount = normalized.filter((entry) => entry.kind === 'tool').length;
    const { details, inner } = createProcessDisclosureShell(toolCount, options);
    for (const entry of normalized) {
        const line = document.createElement('div');
        if (entry.kind === 'tool') {
            line.className = 'chat-tool-line chat-tool-done';
            line.innerHTML = `<span class="tool-dot"></span><span class="tool-text">${(0, utils_js_1.escapeHtml)(entry.text)}</span>`;
        }
        else {
            line.className = 'chat-thought-line';
            line.textContent = entry.text;
        }
        inner.appendChild(line);
    }
    return details;
}
//# sourceMappingURL=process-disclosure.js.map