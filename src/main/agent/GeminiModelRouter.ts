import { DEFAULT_GEMINI_CONFIG } from '../../shared/types/model';
import { buildTaskProfile } from './taskProfile';

function envValue(key: string): string | null {
  const value = process.env[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

type GeminiRouterStrategy = 'balanced' | 'cheap' | 'quality';

export type GeminiModelRoute = {
  modelId: string;
  reason: string;
  thinkingBudget: number | null;
};

function routerStrategy(): GeminiRouterStrategy {
  const configured = envValue('GEMINI_ROUTER_STRATEGY');
  return configured === 'cheap' || configured === 'quality' || configured === 'balanced'
    ? configured
    : 'balanced';
}

function complexitySignals(task: string): number {
  const prompt = task.toLowerCase();
  let score = 0;
  if (/\b(investigate|debug|diagnose|root cause|trace|regression)\b/.test(prompt)) score += 2;
  if (/\b(review|audit|critique|risks|edge cases)\b/.test(prompt)) score += 2;
  if (/\b(plan|strategy|migration|rollout|architecture|decompose|orchestrate)\b/.test(prompt)) score += 2;
  if (/\b(compare|tradeoff|synthesize|summarize across|cross-cutting)\b/.test(prompt)) score += 1;
  if (/\b(multiple files|repo-wide|codebase-wide|end-to-end|several modules)\b/.test(prompt)) score += 1;
  return score;
}

function expectedToolDensity(input: {
  profileKind: ReturnType<typeof buildTaskProfile>['kind'];
  task: string;
  canUseTools?: boolean;
}): number {
  if (!input.canUseTools) return 0;
  const prompt = input.task.toLowerCase();
  let score = 0;

  if (input.profileKind === 'research' || input.profileKind === 'browser-automation') score += 2;
  if (input.profileKind === 'debug' || input.profileKind === 'review') score += 1;
  if (/\b(search|research|browse|navigate|inspect|verify|compare|audit|triage)\b/.test(prompt)) score += 1;
  if (/\b(step by step|end-to-end|across|multiple|several|all)\b/.test(prompt)) score += 1;

  return Math.min(score, 3);
}

function validationSensitivity(input: {
  profileKind: ReturnType<typeof buildTaskProfile>['kind'];
  task: string;
  canUseTools?: boolean;
}): number {
  const prompt = input.task.toLowerCase();
  let score = 0;

  if (input.profileKind === 'review' || input.profileKind === 'debug') score += 1;
  if (input.canUseTools && (input.profileKind === 'research' || input.profileKind === 'browser-automation')) score += 1;
  if (/\b(validate|verification|verify|deterministic|constraint|regression|root cause|risk)\b/.test(prompt)) score += 1;

  return Math.min(score, 2);
}

export function routeGeminiModel(input: {
  task: string;
  contextPrompt?: string | null;
  hasAttachments?: boolean;
  canUseTools?: boolean;
}): GeminiModelRoute {
  const profile = buildTaskProfile(input.task);
  const combinedLength = `${input.contextPrompt || ''}\n${input.task}`.trim().length;
  const strategy = routerStrategy();

  const complexModelId = envValue('GEMINI_MODEL_COMPLEX') || DEFAULT_GEMINI_CONFIG.complexModelId;
  const defaultModelId = envValue('GEMINI_MODEL_DEFAULT') || DEFAULT_GEMINI_CONFIG.defaultModelId;
  const fastModelId = envValue('GEMINI_MODEL_FAST') || DEFAULT_GEMINI_CONFIG.fastModelId;
  const liteModelId = envValue('GEMINI_MODEL_LITE') || DEFAULT_GEMINI_CONFIG.liteModelId;
  const complexThinkingBudget = DEFAULT_GEMINI_CONFIG.complexThinkingBudget;
  const defaultThinkingBudget = DEFAULT_GEMINI_CONFIG.defaultThinkingBudget;
  const fastThinkingBudget = DEFAULT_GEMINI_CONFIG.fastThinkingBudget;

  let complexity = 0;
  switch (profile.kind) {
    case 'orchestration':
      complexity += 4;
      break;
    case 'review':
    case 'debug':
      complexity += 3;
      break;
    case 'research':
      complexity += 2;
      break;
    case 'implementation':
      complexity += 1;
      break;
    case 'browser-automation':
      complexity += 1;
      break;
    default:
      break;
  }

  if (input.canUseTools) complexity += 1;
  if (input.hasAttachments) complexity += 1;
  if (combinedLength >= 2400) complexity += 2;
  else if (combinedLength >= 1200) complexity += 1;
  complexity += complexitySignals(input.task);
  complexity += expectedToolDensity({
    profileKind: profile.kind,
    task: input.task,
    canUseTools: input.canUseTools,
  });
  complexity += validationSensitivity({
    profileKind: profile.kind,
    task: input.task,
    canUseTools: input.canUseTools,
  });

  if (!input.hasAttachments && !input.canUseTools && profile.kind === 'general' && combinedLength <= 240) {
    return { modelId: liteModelId, reason: 'short-general-task', thinkingBudget: null };
  }

  if (strategy === 'cheap') {
    if (complexity >= 6) return { modelId: complexModelId, reason: 'cheap-high-complexity', thinkingBudget: complexThinkingBudget };
    if (complexity >= 3) return { modelId: defaultModelId, reason: 'cheap-standard', thinkingBudget: defaultThinkingBudget };
    if (combinedLength <= 500) return { modelId: liteModelId, reason: 'cheap-lite', thinkingBudget: null };
    return { modelId: fastModelId, reason: 'cheap-fast', thinkingBudget: fastThinkingBudget };
  }

  if (strategy === 'quality') {
    if (complexity >= 4) return { modelId: complexModelId, reason: 'quality-high-complexity', thinkingBudget: complexThinkingBudget };
    if (complexity >= 2) return { modelId: defaultModelId, reason: 'quality-standard', thinkingBudget: defaultThinkingBudget };
    if (combinedLength <= 300) return { modelId: liteModelId, reason: 'quality-lite', thinkingBudget: null };
    return { modelId: fastModelId, reason: 'quality-fast', thinkingBudget: fastThinkingBudget };
  }

  if (complexity >= 5) return { modelId: complexModelId, reason: 'balanced-high-complexity', thinkingBudget: complexThinkingBudget };
  if (complexity >= 2) return { modelId: defaultModelId, reason: 'balanced-standard', thinkingBudget: defaultThinkingBudget };
  if (combinedLength <= 300) return { modelId: liteModelId, reason: 'balanced-lite', thinkingBudget: null };
  return { modelId: fastModelId, reason: 'balanced-fast', thinkingBudget: fastThinkingBudget };
}
