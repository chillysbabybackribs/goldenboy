import type { AgentTaskKind, ProviderId } from '../../shared/types/model';
import { HAIKU_PROVIDER_ID, PRIMARY_PROVIDER_ID } from '../../shared/types/model';

export const NO_MATERIAL_RESEARCH_UPDATE = 'NO_MATERIAL_UPDATE';

export function shouldRunBackgroundResearchSynthesis(input: {
  prompt: string;
  taskKind: AgentTaskKind;
  primaryProviderId: ProviderId;
  synthesisProviderAvailable: boolean;
}): boolean {
  if (input.taskKind !== 'research') return false;
  if (input.primaryProviderId !== HAIKU_PROVIDER_ID) return false;
  if (!input.synthesisProviderAvailable) return false;
  return looksLikeComplexResearchPrompt(input.prompt);
}

export function looksLikeComplexResearchPrompt(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const comparisonIntent = /\b(compare|comparison|vs\.?|versus|best|better|recommend|recommendation|choose|choice|options|trade-?offs?|pros and cons)\b/.test(normalized);
  const investigationIntent = /\b(investigate|analysis|analyze|deep dive|landscape|evaluate|assessment|assess|summarize.*sources|synthesize)\b/.test(normalized);
  const multiFacetIntent = /\b(pricing|reliability|security|compliance|performance|features?)\b/.test(normalized)
    && /\b(and|along with|as well as|across)\b/.test(normalized);
  const longPrompt = normalized.trim().length >= 140;
  return comparisonIntent || investigationIntent || multiFacetIntent || longPrompt;
}

export function buildBackgroundResearchSynthesisTask(options?: {
  groundedEvidenceReasoning?: boolean;
}): string {
  const instructions = [
    `Refine the existing browser-grounded answer using only the provided context.`,
    `Do not use tools, do not ask follow-up questions, and do not introduce facts that are not present in the provided browser evidence.`,
    `If the fast answer is already sufficient and you cannot materially improve it, reply with exactly ${NO_MATERIAL_RESEARCH_UPDATE}.`,
    `Otherwise, return a tighter final answer that improves synthesis, comparison, or clarity while preserving the same factual limits.`,
  ];

  if (options?.groundedEvidenceReasoning) {
    instructions.push(
      'Preserve the grounded evidence reasoning signals in the provided context.',
      'High-confidence claims may be stated directly, medium-confidence claims should stay lightly qualified, and low-confidence or single-source claims must remain clearly labeled.',
      'If the context shows conflicting evidence, present the disagreement explicitly and do not merge it into one resolved statement.',
    );
  }

  return instructions.join(' ');
}

export function buildBackgroundResearchSynthesisContext(input: {
  prompt: string;
  fastAnswer: string;
  threadSummary: string | null;
  evidenceTranscript: string;
  groundedResearchContext?: string | null;
}): string {
  const sections = [
    '## Original Request',
    input.prompt.trim(),
    '',
    '## Fast Browser Answer',
    input.fastAnswer.trim(),
  ];

  if (input.threadSummary?.trim()) {
    sections.push('', '## Thread Summary', input.threadSummary.trim());
  }

  if (input.groundedResearchContext?.trim()) {
    sections.push('', '## Grounded Evidence Reasoning', input.groundedResearchContext.trim());
  }

  sections.push('', '## Browser Evidence Transcript', input.evidenceTranscript.trim());
  return sections.join('\n');
}

export function formatBackgroundResearchSynthesis(output: string): string {
  const trimmed = output.trim();
  if (!trimmed || trimmed === NO_MATERIAL_RESEARCH_UPDATE) return trimmed;
  return `Refined synthesis:\n\n${trimmed}`;
}

export function backgroundResearchSynthesisProviderId(): ProviderId {
  return PRIMARY_PROVIDER_ID;
}
