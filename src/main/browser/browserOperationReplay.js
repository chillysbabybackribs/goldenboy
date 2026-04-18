"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.replayBrowserOperation = replayBrowserOperation;
const browserContextManager_1 = require("./browserContextManager");
const browserOperationLedger_1 = require("./browserOperationLedger");
const browserDeterministicExecution_1 = require("./browserDeterministicExecution");
const browserOperationReplayStore_1 = require("./browserOperationReplayStore");
const browserOperations_1 = require("./browserOperations");
function coerceReplayKind(kind) {
    return kind;
}
async function replayBrowserOperation(request) {
    const source = browserOperationReplayStore_1.browserOperationReplayStore.get(request.sourceOperationId);
    if (!source) {
        throw new Error(`Replay source operation not found: ${request.sourceOperationId}`);
    }
    if (!(0, browserDeterministicExecution_1.isReplaySupportedOperation)(source.kind)) {
        throw new Error(`Replay is not supported for ${source.kind}`);
    }
    const contextId = request.contextId ?? source.context?.contextId ?? null;
    const browserContext = browserContextManager_1.browserContextManager.resolveContext(contextId);
    const validationMode = (0, browserDeterministicExecution_1.resolveReplayValidationMode)(request.validationMode);
    const strictness = (0, browserDeterministicExecution_1.resolveReplayStrictness)(request.strictness);
    const preflight = validationMode === 'none'
        ? { validation: null, resolvedSelector: null }
        : await (0, browserDeterministicExecution_1.validateReplayPreflight)(browserContext.service, source.targetDescriptor);
    const payload = { ...source.payload };
    if ((source.kind === 'browser.click' || source.kind === 'browser.type') && preflight.resolvedSelector) {
        payload.selector = preflight.resolvedSelector;
    }
    const result = await (0, browserOperations_1.executeBrowserOperation)({
        kind: coerceReplayKind(source.kind),
        payload: payload,
        context: {
            ...(source.context || {}),
            contextId: browserContext.id,
        },
        meta: {
            replayOfOperationId: source.operationId,
            targetDescriptor: source.targetDescriptor,
            validationMode,
            strictness,
            preflightValidation: preflight.validation,
        },
    });
    return {
        replayedOperationId: (0, browserOperationLedger_1.getRecentBrowserOperationLedgerEntries)(1)[0]?.operationId || null,
        sourceOperationId: source.operationId,
        validation: preflight.validation,
        result,
    };
}
//# sourceMappingURL=browserOperationReplay.js.map