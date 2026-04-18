"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.looksLikeContextDependentPrompt = looksLikeContextDependentPrompt;
exports.shouldIncludeConversationContext = shouldIncludeConversationContext;
exports.shouldIncludeTaskMemoryContext = shouldIncludeTaskMemoryContext;
exports.shouldIncludeArtifactContext = shouldIncludeArtifactContext;
exports.contextPromptBudgetForTaskKind = contextPromptBudgetForTaskKind;
const CONTEXT_REFERENCE_RE = /\b(this|that|it|same|again|above|below|previous|prior|last|current|selected|active|open|existing)\b/i;
const ARTIFACT_REFERENCE_RE = /\b(artifact|artifacts|note|notes|report|reports|document|documents|sheet|sheets|csv|markdown|html)\b/i;
function looksLikeContextDependentPrompt(prompt) {
    const trimmed = prompt.trim();
    if (!trimmed)
        return false;
    return CONTEXT_REFERENCE_RE.test(trimmed)
        || (trimmed.length <= 80 && /\b(use|update|fix|open|close|read|review|edit|append|replace|summarize|focus|convert|add|remove|delete)\b/i.test(trimmed));
}
function shouldIncludeConversationContext(input) {
    return input.hasPriorConversation
        && (input.isContinuation || looksLikeContextDependentPrompt(input.prompt));
}
function shouldIncludeTaskMemoryContext(input) {
    if (!input.hasPriorTaskMemory)
        return false;
    if (input.lastInvocationFailed || input.isContinuation || looksLikeContextDependentPrompt(input.prompt))
        return true;
    return input.taskKind === 'debug' || input.taskKind === 'review' || input.taskKind === 'orchestration';
}
function shouldIncludeArtifactContext(input) {
    if (!input.hasArtifacts)
        return false;
    if (ARTIFACT_REFERENCE_RE.test(input.prompt) || looksLikeContextDependentPrompt(input.prompt))
        return true;
    return input.taskKind === 'implementation';
}
function contextPromptBudgetForTaskKind(taskKind) {
    switch (taskKind) {
        case 'research':
            return 4_000;
        case 'debug':
        case 'review':
        case 'orchestration':
            return 3_500;
        case 'implementation':
            return 3_000;
        default:
            return 2_500;
    }
}
//# sourceMappingURL=invocationContextPolicy.js.map