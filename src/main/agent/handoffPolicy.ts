import {
  GEMINI_PROVIDER_ID,
  HAIKU_PROVIDER_ID,
  PRIMARY_PROVIDER_ID,
  type AgentTaskProfileOverride,
  type ProviderId,
} from '../../shared/types/model';
import {
  providerSupportsPrompt,
  type ProviderRoutingCapabilities,
} from './providerRouting';

// ═══════════════════════════════════════════════════════════════════════════
// Handoff Policy — decides when a failed invocation should re-enter with a
// different provider, and which provider should receive the handoff.
//
// Pure module. No side effects. Consumed by AgentModelService.invoke to drive
// the automatic orchestration loop.
// ═══════════════════════════════════════════════════════════════════════════

export type HandoffReason =
  | 'context_overflow'
  | 'provider_unavailable'
  | 'repeated_tool_failure'
  | 'model_refusal';

export type HandoffIneligibilityReason =
  | 'task_cancelled'
  | 'attempt_budget_exhausted'
  | 'error_not_handoff_eligible'
  | 'no_eligible_target';

export type HandoffDecision =
  | { kind: 'none'; reasonNotEligible: HandoffIneligibilityReason }
  | { kind: 'escalate'; to: ProviderId; reason: HandoffReason };

export type HandoffPolicyInput = {
  prompt: string;
  failure: {
    providerId: ProviderId;
    errorMessage: string;
    cancelled: boolean;
  };
  availableProviders: Iterable<ProviderId>;
  excludeProviders?: Iterable<ProviderId>;
  taskProfile?: AgentTaskProfileOverride;
  capabilities?: ProviderRoutingCapabilities;
  attempts: number;
  maxAttempts?: number;
};

export const HANDOFF_MAX_ATTEMPTS_DEFAULT = 2;

// Context-length / prompt-too-large signals across Codex, Anthropic, Gemini.
// We avoid \b anchors around `context_length` because `_` is a word
// character in JavaScript regex, so \b does not fire between them — match
// bare substrings but keep each phrase specific enough to avoid false
// positives (e.g. `context prompt` must not classify).
const CONTEXT_OVERFLOW_PATTERNS: RegExp[] = [
  /context[-_\s]?length/i,
  /context[-_\s]?window/i,
  /prompt is too long/i,
  /too many (?:input )?tokens/i,
  /maximum (?:input|prompt|context) (?:length|tokens|size)/i,
  /exceed(?:ed|s)? (?:the )?(?:token|context) (?:limit|window|length)/i,
  /input is too large/i,
];

// Transport / auth / upstream failures that suggest the provider itself is
// the problem, not the prompt.
const PROVIDER_UNAVAILABLE_PATTERNS: RegExp[] = [
  /\b(?:ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNRESET)\b/,
  /\bsocket hang up\b/i,
  /\bfetch failed\b/i,
  /\b(?:401|403|407|429|500|502|503|504)\b/,
  /\brate[- ]?limit(?:ed|ing)?\b/i,
  /\bunauthorized\b/i,
  /\bauthentication (?:failed|error)\b/i,
  /\bservice unavailable\b/i,
  /\bbad gateway\b/i,
  /\bgateway timeout\b/i,
  /\bupstream (?:error|connect error)\b/i,
];

const REPEATED_TOOL_FAILURE_PATTERNS: RegExp[] = [
  /\btool[-\s]?turn[-\s]?(?:limit|budget|cap) (?:exceeded|exhausted|reached)\b/i,
  /\bmax(?:imum)? tool turns\b/i,
  /\btool loop detected\b/i,
];

const MODEL_REFUSAL_PATTERNS: RegExp[] = [
  /\bmodel refused (?:the )?(?:task|request)\b/i,
  /\brefusal: /i,
];

export function decideHandoff(input: HandoffPolicyInput): HandoffDecision {
  const maxAttempts = input.maxAttempts ?? HANDOFF_MAX_ATTEMPTS_DEFAULT;

  if (input.failure.cancelled) {
    return { kind: 'none', reasonNotEligible: 'task_cancelled' };
  }
  if (input.attempts >= maxAttempts) {
    return { kind: 'none', reasonNotEligible: 'attempt_budget_exhausted' };
  }

  const reason = classifyFailure(input.failure.errorMessage);
  if (!reason) {
    return { kind: 'none', reasonNotEligible: 'error_not_handoff_eligible' };
  }

  const excluded = new Set<ProviderId>([
    input.failure.providerId,
    ...(input.excludeProviders ? Array.from(input.excludeProviders) : []),
  ]);

  const eligible: ProviderId[] = [];
  for (const provider of input.availableProviders) {
    if (excluded.has(provider)) continue;
    if (!providerSupportsPrompt(provider, input.prompt, input.taskProfile, input.capabilities)) continue;
    eligible.push(provider);
  }

  if (eligible.length === 0) {
    return { kind: 'none', reasonNotEligible: 'no_eligible_target' };
  }

  const target = pickHandoffTarget(reason, eligible);
  return { kind: 'escalate', to: target, reason };
}

export function classifyFailure(errorMessage: string | null | undefined): HandoffReason | null {
  const normalized = (errorMessage ?? '').trim();
  if (!normalized) return null;
  if (CONTEXT_OVERFLOW_PATTERNS.some((pattern) => pattern.test(normalized))) return 'context_overflow';
  if (REPEATED_TOOL_FAILURE_PATTERNS.some((pattern) => pattern.test(normalized))) return 'repeated_tool_failure';
  if (PROVIDER_UNAVAILABLE_PATTERNS.some((pattern) => pattern.test(normalized))) return 'provider_unavailable';
  if (MODEL_REFUSAL_PATTERNS.some((pattern) => pattern.test(normalized))) return 'model_refusal';
  return null;
}

function pickHandoffTarget(reason: HandoffReason, eligible: ProviderId[]): ProviderId {
  // Context overflow and tool-loop breakout prefer the provider with the
  // largest effective context (Codex / Primary via app-server streaming).
  // Transport failures fall back through the same default ladder as normal
  // routing, skipping the failed provider.
  const preferredOrder: ProviderId[] = reason === 'context_overflow' || reason === 'repeated_tool_failure'
    ? [PRIMARY_PROVIDER_ID, GEMINI_PROVIDER_ID, HAIKU_PROVIDER_ID]
    : [PRIMARY_PROVIDER_ID, HAIKU_PROVIDER_ID, GEMINI_PROVIDER_ID];

  const eligibleSet = new Set(eligible);
  for (const providerId of preferredOrder) {
    if (eligibleSet.has(providerId)) return providerId;
  }
  return eligible[0];
}
