"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.looksLikeLocalCodeTask = exports.looksLikeDelegationTask = exports.looksLikeBrowserSearchTask = exports.looksLikeReviewTask = exports.looksLikeResearchTask = exports.looksLikeOrchestrationTask = exports.looksLikeImplementationTask = exports.looksLikeDebugTask = exports.looksLikeBrowserAutomationTask = void 0;
exports.scopeForPrompt = scopeForPrompt;
exports.withBrowserSearchDirective = withBrowserSearchDirective;
const taskProfile_1 = require("./taskProfile");
Object.defineProperty(exports, "looksLikeBrowserAutomationTask", { enumerable: true, get: function () { return taskProfile_1.looksLikeBrowserAutomationTask; } });
Object.defineProperty(exports, "looksLikeDebugTask", { enumerable: true, get: function () { return taskProfile_1.looksLikeDebugTask; } });
Object.defineProperty(exports, "looksLikeImplementationTask", { enumerable: true, get: function () { return taskProfile_1.looksLikeImplementationTask; } });
Object.defineProperty(exports, "looksLikeOrchestrationTask", { enumerable: true, get: function () { return taskProfile_1.looksLikeOrchestrationTask; } });
Object.defineProperty(exports, "looksLikeResearchTask", { enumerable: true, get: function () { return taskProfile_1.looksLikeResearchTask; } });
Object.defineProperty(exports, "looksLikeReviewTask", { enumerable: true, get: function () { return taskProfile_1.looksLikeReviewTask; } });
Object.defineProperty(exports, "looksLikeBrowserSearchTask", { enumerable: true, get: function () { return taskProfile_1.looksLikeBrowserSearchTask; } });
Object.defineProperty(exports, "looksLikeDelegationTask", { enumerable: true, get: function () { return taskProfile_1.looksLikeDelegationTask; } });
Object.defineProperty(exports, "looksLikeLocalCodeTask", { enumerable: true, get: function () { return taskProfile_1.looksLikeLocalCodeTask; } });
function scopeForPrompt(prompt, overrides) {
    const profile = (0, taskProfile_1.buildTaskProfile)(prompt, overrides);
    return {
        skillNames: [...profile.skillNames],
        allowedTools: profile.allowedTools,
        canSpawnSubagents: profile.canSpawnSubagents,
        maxToolTurns: profile.maxToolTurns,
    };
}
function withBrowserSearchDirective(prompt, overrides) {
    return (0, taskProfile_1.withBrowserSearchDirective)(prompt, overrides);
}
//# sourceMappingURL=runtimeScope.js.map