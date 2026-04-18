import { describe, expect, it } from 'vitest';
import {
  buildBackgroundResearchSynthesisContext,
  buildBackgroundResearchSynthesisTask,
  formatBackgroundResearchSynthesis,
  looksLikeComplexResearchPrompt,
  NO_MATERIAL_RESEARCH_UPDATE,
  shouldRunBackgroundResearchSynthesis,
} from './researchSynthesis';

describe('research synthesis helpers', () => {
  it('detects complex research prompts and ignores simple lookups', () => {
    expect(looksLikeComplexResearchPrompt('Compare Vercel vs Cloudflare across pricing, reliability, and compliance.'))
      .toBe(true);
    expect(looksLikeComplexResearchPrompt('Investigate the current browser agent landscape and recommend an approach.'))
      .toBe(true);
    expect(looksLikeComplexResearchPrompt('Search for the latest Electron release notes.'))
      .toBe(false);
  });

  it('only schedules background synthesis for Haiku-led research tasks when a stronger provider is available', () => {
    expect(shouldRunBackgroundResearchSynthesis({
      prompt: 'Compare two browser automation vendors across pricing and reliability.',
      taskKind: 'research',
      primaryProviderId: 'haiku',
      synthesisProviderAvailable: true,
    })).toBe(true);

    expect(shouldRunBackgroundResearchSynthesis({
      prompt: 'Search for the latest Electron release notes.',
      taskKind: 'research',
      primaryProviderId: 'haiku',
      synthesisProviderAvailable: true,
    })).toBe(false);

    expect(shouldRunBackgroundResearchSynthesis({
      prompt: 'Compare two browser automation vendors across pricing and reliability.',
      taskKind: 'research',
      primaryProviderId: 'gpt-5.4',
      synthesisProviderAvailable: true,
    })).toBe(false);
  });

  it('builds constrained synthesis prompts and formats published output', () => {
    expect(buildBackgroundResearchSynthesisTask()).toContain(NO_MATERIAL_RESEARCH_UPDATE);
    expect(buildBackgroundResearchSynthesisTask({
      groundedEvidenceReasoning: true,
    })).toContain('Preserve the grounded evidence reasoning signals');

    const context = buildBackgroundResearchSynthesisContext({
      prompt: 'Compare A vs B.',
      fastAnswer: 'Fast answer.',
      threadSummary: 'Summary.',
      groundedResearchContext: 'Validated claim: A is supported by two sources. Conflict: B vs C.',
      evidenceTranscript: '[tool] browser.research_search result...',
    });
    expect(context).toContain('## Original Request');
    expect(context).toContain('## Fast Browser Answer');
    expect(context).toContain('## Grounded Evidence Reasoning');
    expect(context).toContain('## Browser Evidence Transcript');

    expect(formatBackgroundResearchSynthesis('Sharper final answer.'))
      .toBe('Refined synthesis:\n\nSharper final answer.');
    expect(formatBackgroundResearchSynthesis(NO_MATERIAL_RESEARCH_UPDATE))
      .toBe(NO_MATERIAL_RESEARCH_UPDATE);
  });
});
