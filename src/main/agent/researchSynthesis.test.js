"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const researchSynthesis_1 = require("./researchSynthesis");
(0, vitest_1.describe)('research synthesis helpers', () => {
    (0, vitest_1.it)('detects complex research prompts and ignores simple lookups', () => {
        (0, vitest_1.expect)((0, researchSynthesis_1.looksLikeComplexResearchPrompt)('Compare Vercel vs Cloudflare across pricing, reliability, and compliance.'))
            .toBe(true);
        (0, vitest_1.expect)((0, researchSynthesis_1.looksLikeComplexResearchPrompt)('Investigate the current browser agent landscape and recommend an approach.'))
            .toBe(true);
        (0, vitest_1.expect)((0, researchSynthesis_1.looksLikeComplexResearchPrompt)('Search for the latest Electron release notes.'))
            .toBe(false);
    });
    (0, vitest_1.it)('only schedules background synthesis for Haiku-led research tasks when a stronger provider is available', () => {
        (0, vitest_1.expect)((0, researchSynthesis_1.shouldRunBackgroundResearchSynthesis)({
            prompt: 'Compare two browser automation vendors across pricing and reliability.',
            taskKind: 'research',
            primaryProviderId: 'haiku',
            synthesisProviderAvailable: true,
        })).toBe(true);
        (0, vitest_1.expect)((0, researchSynthesis_1.shouldRunBackgroundResearchSynthesis)({
            prompt: 'Search for the latest Electron release notes.',
            taskKind: 'research',
            primaryProviderId: 'haiku',
            synthesisProviderAvailable: true,
        })).toBe(false);
        (0, vitest_1.expect)((0, researchSynthesis_1.shouldRunBackgroundResearchSynthesis)({
            prompt: 'Compare two browser automation vendors across pricing and reliability.',
            taskKind: 'research',
            primaryProviderId: 'gpt-5.4',
            synthesisProviderAvailable: true,
        })).toBe(false);
    });
    (0, vitest_1.it)('builds constrained synthesis prompts and formats published output', () => {
        (0, vitest_1.expect)((0, researchSynthesis_1.buildBackgroundResearchSynthesisTask)()).toContain(researchSynthesis_1.NO_MATERIAL_RESEARCH_UPDATE);
        (0, vitest_1.expect)((0, researchSynthesis_1.buildBackgroundResearchSynthesisTask)({
            groundedEvidenceReasoning: true,
        })).toContain('Preserve the grounded evidence reasoning signals');
        const context = (0, researchSynthesis_1.buildBackgroundResearchSynthesisContext)({
            prompt: 'Compare A vs B.',
            fastAnswer: 'Fast answer.',
            threadSummary: 'Summary.',
            groundedResearchContext: 'Validated claim: A is supported by two sources. Conflict: B vs C.',
            evidenceTranscript: '[tool] browser.research_search result...',
        });
        (0, vitest_1.expect)(context).toContain('## Original Request');
        (0, vitest_1.expect)(context).toContain('## Fast Browser Answer');
        (0, vitest_1.expect)(context).toContain('## Grounded Evidence Reasoning');
        (0, vitest_1.expect)(context).toContain('## Browser Evidence Transcript');
        (0, vitest_1.expect)((0, researchSynthesis_1.formatBackgroundResearchSynthesis)('Sharper final answer.'))
            .toBe('Refined synthesis:\n\nSharper final answer.');
        (0, vitest_1.expect)((0, researchSynthesis_1.formatBackgroundResearchSynthesis)(researchSynthesis_1.NO_MATERIAL_RESEARCH_UPDATE))
            .toBe(researchSynthesis_1.NO_MATERIAL_RESEARCH_UPDATE);
    });
});
//# sourceMappingURL=researchSynthesis.test.js.map