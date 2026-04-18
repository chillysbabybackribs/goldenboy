"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const invocationContextPolicy_1 = require("./invocationContextPolicy");
(0, vitest_1.describe)('invocationContextPolicy', () => {
    (0, vitest_1.it)('keeps fresh standalone prompts lightweight', () => {
        (0, vitest_1.expect)((0, invocationContextPolicy_1.looksLikeContextDependentPrompt)('Audit the Codex runtime for prompt overhead.')).toBe(false);
        (0, vitest_1.expect)((0, invocationContextPolicy_1.shouldIncludeConversationContext)({
            prompt: 'Audit the Codex runtime for prompt overhead.',
            hasPriorConversation: true,
            isContinuation: false,
        })).toBe(false);
        (0, vitest_1.expect)((0, invocationContextPolicy_1.shouldIncludeTaskMemoryContext)({
            prompt: 'Audit the Codex runtime for prompt overhead.',
            taskKind: 'implementation',
            hasPriorTaskMemory: true,
            isContinuation: false,
            lastInvocationFailed: false,
        })).toBe(false);
    });
    (0, vitest_1.it)('keeps continuation-style prompts contextual', () => {
        (0, vitest_1.expect)((0, invocationContextPolicy_1.looksLikeContextDependentPrompt)('Use the current artifact and update it.')).toBe(true);
        (0, vitest_1.expect)((0, invocationContextPolicy_1.looksLikeContextDependentPrompt)('Focus only on B.')).toBe(true);
        (0, vitest_1.expect)((0, invocationContextPolicy_1.looksLikeContextDependentPrompt)('Remove section 3.')).toBe(true);
        (0, vitest_1.expect)((0, invocationContextPolicy_1.shouldIncludeConversationContext)({
            prompt: 'Use the current artifact and update it.',
            hasPriorConversation: true,
            isContinuation: false,
        })).toBe(true);
        (0, vitest_1.expect)((0, invocationContextPolicy_1.shouldIncludeTaskMemoryContext)({
            prompt: 'continue from the last failure',
            taskKind: 'debug',
            hasPriorTaskMemory: true,
            isContinuation: true,
            lastInvocationFailed: true,
        })).toBe(true);
    });
    (0, vitest_1.it)('only includes artifact context when the prompt is artifact-aware', () => {
        (0, vitest_1.expect)((0, invocationContextPolicy_1.shouldIncludeArtifactContext)({
            prompt: 'summarize the weekly research note',
            taskKind: 'general',
            hasArtifacts: true,
        })).toBe(true);
        (0, vitest_1.expect)((0, invocationContextPolicy_1.shouldIncludeArtifactContext)({
            prompt: 'Audit the Codex runtime for prompt overhead.',
            taskKind: 'general',
            hasArtifacts: true,
        })).toBe(false);
    });
    (0, vitest_1.it)('uses smaller budgets for lightweight task kinds', () => {
        (0, vitest_1.expect)((0, invocationContextPolicy_1.contextPromptBudgetForTaskKind)('general')).toBe(2_500);
        (0, vitest_1.expect)((0, invocationContextPolicy_1.contextPromptBudgetForTaskKind)('implementation')).toBe(3_000);
        (0, vitest_1.expect)((0, invocationContextPolicy_1.contextPromptBudgetForTaskKind)('research')).toBe(4_000);
    });
});
//# sourceMappingURL=invocationContextPolicy.test.js.map