import { describe, expect, it } from 'vitest';
import {
  decideBrowserExecution,
  finalizeBrowserExecutionDecision,
} from './browserExecutionPolicy';

describe('browserExecutionPolicy', () => {
  it('prefers deterministic execution when strong preflight evidence exists', () => {
    const decision = decideBrowserExecution({
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

    expect(decision).toEqual(expect.objectContaining({
      selectedMode: 'deterministic_execute',
      confidence: 'high',
      fallbackMode: 'heuristic_execute',
    }));
  });

  it('aborts strict replay when preflight target validation is weak', () => {
    const decision = decideBrowserExecution({
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

    expect(decision).toEqual(expect.objectContaining({
      selectedMode: 'abort',
      fallbackMode: null,
    }));
  });

  it('falls back from replay to heuristic execution in best-effort mode', () => {
    const decision = decideBrowserExecution({
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

    expect(decision.selectedMode).toBe('heuristic_execute');
    const result = finalizeBrowserExecutionDecision(decision, {
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

    expect(result).toEqual({
      selectedMode: 'heuristic_execute',
      attemptedModes: ['deterministic_replay', 'heuristic_execute'],
      fallbackUsed: true,
      finalStatus: 'completed',
      summary: 'Executed via heuristic_execute',
    });
  });
});
