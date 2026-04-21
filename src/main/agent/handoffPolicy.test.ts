import { describe, expect, it } from 'vitest';
import {
  GEMINI_PROVIDER_ID,
  HAIKU_PROVIDER_ID,
  PRIMARY_PROVIDER_ID,
} from '../../shared/types/model';
import {
  classifyFailure,
  decideHandoff,
  HANDOFF_MAX_ATTEMPTS_DEFAULT,
} from './handoffPolicy';

const ALL_AVAILABLE = [PRIMARY_PROVIDER_ID, HAIKU_PROVIDER_ID, GEMINI_PROVIDER_ID];

const CAPABILITIES_ALL = {
  [PRIMARY_PROVIDER_ID]: { supportsV2ToolRuntime: true },
  [HAIKU_PROVIDER_ID]: { supportsV2ToolRuntime: true },
  [GEMINI_PROVIDER_ID]: { supportsV2ToolRuntime: true },
} as const;

describe('classifyFailure', () => {
  it('recognizes context-overflow error messages from each provider family', () => {
    expect(classifyFailure('prompt is too long: 250000 > 200000 tokens')).toBe('context_overflow');
    expect(classifyFailure("Request failed: context_length_exceeded")).toBe('context_overflow');
    expect(classifyFailure('This model has a maximum context length of 200000 tokens')).toBe('context_overflow');
    expect(classifyFailure('Error: exceeded the token limit for this request')).toBe('context_overflow');
    expect(classifyFailure('input is too large for the configured context window')).toBe('context_overflow');
  });

  it('recognizes transport / auth failures as provider_unavailable', () => {
    expect(classifyFailure('fetch failed')).toBe('provider_unavailable');
    expect(classifyFailure('ECONNREFUSED 127.0.0.1:4312')).toBe('provider_unavailable');
    expect(classifyFailure('HTTP 503 Service Unavailable')).toBe('provider_unavailable');
    expect(classifyFailure('rate limited — retry after 30s')).toBe('provider_unavailable');
    expect(classifyFailure('socket hang up')).toBe('provider_unavailable');
    expect(classifyFailure('authentication failed: invalid API key')).toBe('provider_unavailable');
  });

  it('recognizes repeated-tool-failure signals', () => {
    expect(classifyFailure('max tool turns reached without completion')).toBe('repeated_tool_failure');
    expect(classifyFailure('Tool-turn budget exhausted')).toBe('repeated_tool_failure');
    expect(classifyFailure('tool loop detected after 12 iterations')).toBe('repeated_tool_failure');
  });

  it('recognizes explicit model refusal signals', () => {
    expect(classifyFailure('Refusal: cannot comply with this request')).toBe('model_refusal');
    expect(classifyFailure('model refused the task')).toBe('model_refusal');
  });

  it('returns null for unrecognized errors and empty input', () => {
    expect(classifyFailure('')).toBeNull();
    expect(classifyFailure(null)).toBeNull();
    expect(classifyFailure(undefined)).toBeNull();
    expect(classifyFailure('some unrelated runtime assertion blew up')).toBeNull();
    // "context prompt" is a legitimate substring in unrelated errors and must not classify.
    expect(classifyFailure('failed to assemble context prompt')).toBeNull();
  });
});

describe('decideHandoff — guardrails', () => {
  it('never hands off a user cancellation', () => {
    const decision = decideHandoff({
      prompt: 'summarize this long document',
      failure: { providerId: HAIKU_PROVIDER_ID, errorMessage: 'prompt is too long', cancelled: true },
      availableProviders: ALL_AVAILABLE,
      capabilities: CAPABILITIES_ALL,
      attempts: 1,
    });
    expect(decision).toEqual({ kind: 'none', reasonNotEligible: 'task_cancelled' });
  });

  it('stops after HANDOFF_MAX_ATTEMPTS_DEFAULT attempts', () => {
    const decision = decideHandoff({
      prompt: 'summarize this long document',
      failure: { providerId: HAIKU_PROVIDER_ID, errorMessage: 'prompt is too long', cancelled: false },
      availableProviders: ALL_AVAILABLE,
      capabilities: CAPABILITIES_ALL,
      attempts: HANDOFF_MAX_ATTEMPTS_DEFAULT,
    });
    expect(decision).toEqual({ kind: 'none', reasonNotEligible: 'attempt_budget_exhausted' });
  });

  it('declines to hand off when the error is not handoff-eligible', () => {
    const decision = decideHandoff({
      prompt: 'anything',
      failure: { providerId: HAIKU_PROVIDER_ID, errorMessage: 'TypeError: x is not a function', cancelled: false },
      availableProviders: ALL_AVAILABLE,
      capabilities: CAPABILITIES_ALL,
      attempts: 1,
    });
    expect(decision).toEqual({ kind: 'none', reasonNotEligible: 'error_not_handoff_eligible' });
  });

  it('returns no_eligible_target when only the failed provider is available', () => {
    const decision = decideHandoff({
      prompt: 'anything',
      failure: { providerId: HAIKU_PROVIDER_ID, errorMessage: 'prompt is too long', cancelled: false },
      availableProviders: [HAIKU_PROVIDER_ID],
      capabilities: CAPABILITIES_ALL,
      attempts: 1,
    });
    expect(decision).toEqual({ kind: 'none', reasonNotEligible: 'no_eligible_target' });
  });

  it('excludes providers from excludeProviders in addition to the failed provider', () => {
    const decision = decideHandoff({
      prompt: 'anything',
      failure: { providerId: HAIKU_PROVIDER_ID, errorMessage: 'prompt is too long', cancelled: false },
      availableProviders: ALL_AVAILABLE,
      excludeProviders: [PRIMARY_PROVIDER_ID],
      capabilities: CAPABILITIES_ALL,
      attempts: 1,
    });
    expect(decision).toEqual({ kind: 'escalate', to: GEMINI_PROVIDER_ID, reason: 'context_overflow' });
  });

  it('filters out providers that do not support the task capability', () => {
    const decision = decideHandoff({
      prompt: 'Plan a repo-wide migration strategy',
      failure: { providerId: HAIKU_PROVIDER_ID, errorMessage: 'prompt is too long', cancelled: false },
      availableProviders: [HAIKU_PROVIDER_ID, GEMINI_PROVIDER_ID],
      capabilities: {
        [HAIKU_PROVIDER_ID]: { supportsV2ToolRuntime: true },
        [GEMINI_PROVIDER_ID]: { supportsV2ToolRuntime: false },
      },
      attempts: 1,
    });
    expect(decision).toEqual({ kind: 'none', reasonNotEligible: 'no_eligible_target' });
  });
});

describe('decideHandoff — target selection', () => {
  it('escalates context-overflow failures to Primary (largest context)', () => {
    const decision = decideHandoff({
      prompt: 'summarize this very long document',
      failure: { providerId: HAIKU_PROVIDER_ID, errorMessage: 'prompt is too long', cancelled: false },
      availableProviders: ALL_AVAILABLE,
      capabilities: CAPABILITIES_ALL,
      attempts: 1,
    });
    expect(decision).toEqual({ kind: 'escalate', to: PRIMARY_PROVIDER_ID, reason: 'context_overflow' });
  });

  it('escalates context-overflow from Primary to next-largest eligible provider', () => {
    const decision = decideHandoff({
      prompt: 'summarize this very long document',
      failure: { providerId: PRIMARY_PROVIDER_ID, errorMessage: 'context_length_exceeded', cancelled: false },
      availableProviders: ALL_AVAILABLE,
      capabilities: CAPABILITIES_ALL,
      attempts: 1,
    });
    expect(decision).toEqual({ kind: 'escalate', to: GEMINI_PROVIDER_ID, reason: 'context_overflow' });
  });

  it('escalates transport failures from Haiku to Primary', () => {
    const decision = decideHandoff({
      prompt: 'run a tool sequence',
      failure: { providerId: HAIKU_PROVIDER_ID, errorMessage: 'fetch failed', cancelled: false },
      availableProviders: ALL_AVAILABLE,
      capabilities: CAPABILITIES_ALL,
      attempts: 1,
    });
    expect(decision).toEqual({ kind: 'escalate', to: PRIMARY_PROVIDER_ID, reason: 'provider_unavailable' });
  });

  it('escalates transport failures from Primary to Haiku as next in the default ladder', () => {
    const decision = decideHandoff({
      prompt: 'run a tool sequence',
      failure: { providerId: PRIMARY_PROVIDER_ID, errorMessage: 'HTTP 503 Service Unavailable', cancelled: false },
      availableProviders: ALL_AVAILABLE,
      capabilities: CAPABILITIES_ALL,
      attempts: 1,
    });
    expect(decision).toEqual({ kind: 'escalate', to: HAIKU_PROVIDER_ID, reason: 'provider_unavailable' });
  });

  it('escalates repeated-tool-failure up the capability ladder', () => {
    const decision = decideHandoff({
      prompt: 'automate these browser steps',
      failure: { providerId: HAIKU_PROVIDER_ID, errorMessage: 'max tool turns reached', cancelled: false },
      availableProviders: ALL_AVAILABLE,
      capabilities: CAPABILITIES_ALL,
      attempts: 1,
    });
    expect(decision).toEqual({ kind: 'escalate', to: PRIMARY_PROVIDER_ID, reason: 'repeated_tool_failure' });
  });

  it('respects an explicit taskProfile override when filtering capable providers', () => {
    const decision = decideHandoff({
      prompt: 'any prompt — kind comes from override',
      failure: { providerId: HAIKU_PROVIDER_ID, errorMessage: 'prompt is too long', cancelled: false },
      availableProviders: [HAIKU_PROVIDER_ID, GEMINI_PROVIDER_ID],
      taskProfile: { kind: 'orchestration' },
      capabilities: {
        [HAIKU_PROVIDER_ID]: { supportsV2ToolRuntime: true },
        [GEMINI_PROVIDER_ID]: { supportsV2ToolRuntime: false },
      },
      attempts: 1,
    });
    expect(decision).toEqual({ kind: 'none', reasonNotEligible: 'no_eligible_target' });
  });
});
