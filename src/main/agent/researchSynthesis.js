"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NO_MATERIAL_RESEARCH_UPDATE = void 0;
exports.shouldRunBackgroundResearchSynthesis = shouldRunBackgroundResearchSynthesis;
exports.looksLikeComplexResearchPrompt = looksLikeComplexResearchPrompt;
exports.buildBackgroundResearchSynthesisTask = buildBackgroundResearchSynthesisTask;
exports.buildBackgroundResearchSynthesisContext = buildBackgroundResearchSynthesisContext;
exports.formatBackgroundResearchSynthesis = formatBackgroundResearchSynthesis;
exports.backgroundResearchSynthesisProviderId = backgroundResearchSynthesisProviderId;
const model_1 = require("../../shared/types/model");
exports.NO_MATERIAL_RESEARCH_UPDATE = 'NO_MATERIAL_UPDATE';
function shouldRunBackgroundResearchSynthesis(input) {
    if (input.taskKind !== 'research')
        return false;
    if (input.primaryProviderId !== model_1.HAIKU_PROVIDER_ID)
        return false;
    if (!input.synthesisProviderAvailable)
        return false;
    return looksLikeComplexResearchPrompt(input.prompt);
}
function looksLikeComplexResearchPrompt(prompt) {
    const normalized = prompt.toLowerCase();
    const comparisonIntent = /\b(compare|comparison|vs\.?|versus|best|better|recommend|recommendation|choose|choice|options|trade-?offs?|pros and cons)\b/.test(normalized);
    const investigationIntent = /\b(investigate|analysis|analyze|deep dive|landscape|evaluate|assessment|assess|summarize.*sources|synthesize)\b/.test(normalized);
    const multiFacetIntent = /\b(pricing|reliability|security|compliance|performance|features?)\b/.test(normalized)
        && /\b(and|along with|as well as|across)\b/.test(normalized);
    const longPrompt = normalized.trim().length >= 140;
    return comparisonIntent || investigationIntent || multiFacetIntent || longPrompt;
}
function buildBackgroundResearchSynthesisTask(options) {
    const instructions = [
        `Refine the existing browser-grounded answer using only the provided context.`,
        `Do not use tools, do not ask follow-up questions, and do not introduce facts that are not present in the provided browser evidence.`,
        `If the fast answer is already sufficient and you cannot materially improve it, reply with exactly ${exports.NO_MATERIAL_RESEARCH_UPDATE}.`,
        `Otherwise, return a tighter final answer that improves synthesis, comparison, or clarity while preserving the same factual limits.`,
    ];
    if (options?.groundedEvidenceReasoning) {
        instructions.push('Preserve the grounded evidence reasoning signals in the provided context.', 'High-confidence claims may be stated directly, medium-confidence claims should stay lightly qualified, and low-confidence or single-source claims must remain clearly labeled.', 'If the context shows conflicting evidence, present the disagreement explicitly and do not merge it into one resolved statement.');
    }
    return instructions.join(' ');
}
function buildBackgroundResearchSynthesisContext(input) {
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
function formatBackgroundResearchSynthesis(output) {
    const trimmed = output.trim();
    if (!trimmed || trimmed === exports.NO_MATERIAL_RESEARCH_UPDATE)
        return trimmed;
    return `Refined synthesis:\n\n${trimmed}`;
}
function backgroundResearchSynthesisProviderId() {
    return model_1.PRIMARY_PROVIDER_ID;
}
//# sourceMappingURL=researchSynthesis.js.map