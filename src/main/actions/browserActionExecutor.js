"use strict";
// ═══════════════════════════════════════════════════════════════════════════
// Browser Action Executor — Surface-action adapter onto the authoritative
// browser operation layer.
// ═══════════════════════════════════════════════════════════════════════════
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeBrowserAction = executeBrowserAction;
const browserOperations_1 = require("../browser/browserOperations");
function mapOriginToSource(origin) {
    switch (origin) {
        case 'command-center':
            return 'ui';
        case 'model':
            return 'agent';
        default:
            return 'other';
    }
}
async function executeBrowserAction(kind, payload, context) {
    if (!kind.startsWith('browser.')) {
        throw new Error(`Unknown browser action kind: ${kind}`);
    }
    return (0, browserOperations_1.executeBrowserOperation)({
        kind: kind,
        payload,
        context: {
            taskId: context?.taskId ?? null,
            contextId: context?.contextId ?? null,
            source: mapOriginToSource(context?.origin),
        },
    });
}
//# sourceMappingURL=browserActionExecutor.js.map