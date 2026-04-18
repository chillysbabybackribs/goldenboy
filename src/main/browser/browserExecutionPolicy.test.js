"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const browserExecutionPolicy_1 = require("./browserExecutionPolicy");
(0, vitest_1.describe)('browserExecutionPolicy', () => {
    (0, vitest_1.it)('prefers deterministic execution when strong preflight evidence exists', () => {
        const decision = (0, browserExecutionPolicy_1.decideBrowserExecution)({
            kind: 'browser.click',
            supportsDeterministicExecution: true,
            preflightValidation: {
                status: 'matched',
                phase: 'preflight',
                summary: 'Resolved click target',
                evidenceUsed: ['selector'],
                expected: { selector: '#buy-now' },
                observed: { selector: '#buy-now' },
                validatedAt: Date.now(),
            },
        });
        (0, vitest_1.expect)(decision).toEqual(vitest_1.expect.objectContaining({
            selectedMode: 'deterministic_execute',
            confidence: 'high',
            fallbackMode: 'heuristic_execute',
        }));
    });
    (0, vitest_1.it)('aborts strict replay when preflight target validation is weak', () => {
        const decision = (0, browserExecutionPolicy_1.decideBrowserExecution)({
            kind: 'browser.click',
            supportsDeterministicExecution: true,
            replayOfOperationId: 'bop_1',
            strictness: 'strict',
            preflightValidation: {
                status: 'missing',
                phase: 'preflight',
                summary: 'Target element no longer resolves',
                evidenceUsed: ['selector'],
                expected: { selector: '#buy-now' },
                observed: { selector: null },
                validatedAt: Date.now(),
            },
        });
        (0, vitest_1.expect)(decision).toEqual(vitest_1.expect.objectContaining({
            selectedMode: 'abort',
            fallbackMode: null,
        }));
    });
    (0, vitest_1.it)('falls back from replay to heuristic execution in best-effort mode', () => {
        const decision = (0, browserExecutionPolicy_1.decideBrowserExecution)({
            kind: 'browser.click',
            supportsDeterministicExecution: true,
            replayOfOperationId: 'bop_1',
            strictness: 'best-effort',
            preflightValidation: {
                status: 'ambiguous',
                phase: 'preflight',
                summary: 'Target element resolves ambiguously',
                evidenceUsed: ['text'],
                expected: { selector: '#buy-now' },
                observed: { selector: '#candidate' },
                validatedAt: Date.now(),
            },
        });
        (0, vitest_1.expect)(decision.selectedMode).toBe('heuristic_execute');
        const result = (0, browserExecutionPolicy_1.finalizeBrowserExecutionDecision)(decision, {
            finalStatus: 'completed',
            preflightValidation: {
                status: 'ambiguous',
                phase: 'preflight',
                summary: 'Target element resolves ambiguously',
                evidenceUsed: ['text'],
                expected: { selector: '#buy-now' },
                observed: { selector: '#candidate' },
                validatedAt: Date.now(),
            },
        });
        (0, vitest_1.expect)(result).toEqual({
            selectedMode: 'heuristic_execute',
            attemptedModes: ['deterministic_replay', 'heuristic_execute'],
            fallbackUsed: true,
            finalStatus: 'completed',
            summary: 'Executed via heuristic_execute',
        });
    });
});
//# sourceMappingURL=browserExecutionPolicy.test.js.map