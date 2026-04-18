import { browserService } from '../browser/BrowserService';
import { executeBrowserOperation } from '../browser/browserOperations';
import type { SearchResultCandidate, PageEvidence } from '../browser/BrowserPageAnalysis';
import type { AgentTaskKind } from '../../shared/types/model';
import type { AgentToolName } from './AgentTypes';
import type { ArtifactRoutingDecision } from './artifactRouting';
import { taskMemoryStore } from '../models/taskMemoryStore';
import { resolveBrowserInitialSurfaceTools } from './toolPacks';

export const MIN_RESEARCH_DOMAINS = 3;
const MAX_RESEARCH_RESULTS = 10;
const MAX_RESEARCH_PAGES = 6;

export type GroundedResearchSource = {
  url: string;
  domain: string;
  title: string;
};

export type ExtractedResearchData = {
  source: GroundedResearchSource;
  claims: string[];
  metrics: string[];
  definitions: string[];
  timestamps: string[];
};

export type ValidatedResearchClaim = {
  claim: string;
  support: GroundedResearchSource[];
  metrics: string[];
  timestamps: string[];
  verification: 'single-source' | 'multi-source';
  confidenceScore: number;
  confidenceLabel: 'low' | 'medium' | 'high';
  agreementLevel: 'multi_source' | 'single_source' | 'conflicted';
  conflictIds?: string[];
};

export type ResearchConflict = {
  id: string;
  skeleton: string;
  claims: Array<{ claim: string; source: GroundedResearchSource }>;
};

export type ResearchContext = {
  query: string;
  minimumDomainCount: number;
  sources: GroundedResearchSource[];
  extractedData: ExtractedResearchData[];
  validatedClaims: ValidatedResearchClaim[];
  conflicts: ResearchConflict[];
  discardedSources: GroundedResearchSource[];
  verificationLevel: 'generated' | 'grounded' | 'multi-source-verified';
  domainCount: number;
  isSufficient: boolean;
  failureReason: string | null;
};

export type ResearchBrowserAdapter = {
  searchWeb(query: string): Promise<{ searchTabId: string; results: SearchResultCandidate[] }>;
  openPage(url: string): Promise<{ evidence: PageEvidence | null }>;
  restoreSearchTab(tabId: string): Promise<void>;
};

const ARTIFACT_WRITE_TOOL_NAMES: AgentToolName[] = [
  'artifact.create',
  'artifact.replace_content',
  'artifact.append_content',
];
const GROUNDED_RESEARCH_TOOL_NAMES = resolveBrowserInitialSurfaceTools();

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function extractDomain(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function compactLines(values: string[]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const value of values.map(normalizeText).filter(Boolean)) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(value);
  }
  return lines;
}

function splitIntoClaims(summary: string, keyFacts: string[]): string[] {
  const sentences = summary
    .split(/(?<=[.!?])\s+/)
    .map(normalizeText)
    .filter((line) => line.length >= 30 && line.length <= 260);
  return compactLines([...keyFacts, ...sentences]).slice(0, 6);
}

function extractMetrics(values: string[]): string[] {
  const matches = new Set<string>();
  const metricRegex = /\b\d+(?:\.\d+)?(?:%|x|m|k|b)?\b(?:\s*(?:percent|seconds?|minutes?|hours?|days?|weeks?|months?|years?|tokens?|users?|customers?|million|billion|thousand|ms|gb|mb|tb|fps|usd|eur|gbp|points?))?/gi;
  for (const value of values) {
    for (const match of value.match(metricRegex) || []) {
      const normalized = normalizeText(match);
      if (normalized) matches.add(normalized);
    }
  }
  return Array.from(matches).slice(0, 8);
}

function extractDefinitions(values: string[]): string[] {
  return compactLines(
    values.filter((value) => /\b(is|are|refers to|defined as|means)\b/i.test(value)),
  ).slice(0, 4);
}

function normalizeClaimKey(claim: string): string {
  return normalizeText(claim.toLowerCase().replace(/[^\w\s]/g, ' '));
}

function normalizeClaimSkeleton(claim: string): string {
  return normalizeText(
    claim
      .toLowerCase()
      .replace(/\b\d+(?:\.\d+)?(?:%|x|m|k|b)?\b/g, ' ')
      .replace(/[^\w\s]/g, ' '),
  );
}

function numericSignature(claim: string): string {
  return (claim.match(/\b\d+(?:\.\d+)?(?:%|x|m|k|b)?\b/g) || []).join('|');
}

const CONFIDENCE_LABELS = ['low', 'medium', 'high'] as const;

function confidenceScoreForLabel(label: ValidatedResearchClaim['confidenceLabel']): number {
  switch (label) {
    case 'high':
      return 1.0;
    case 'medium':
      return 0.66;
    case 'low':
    default:
      return 0.33;
  }
}

function confidenceLabelForClaim(input: {
  support: GroundedResearchSource[];
  timestamps: string[];
  hasConflict: boolean;
}): ValidatedResearchClaim['confidenceLabel'] {
  const domainCount = new Set(input.support.map((source) => source.domain)).size;
  let rank = domainCount >= 3 ? 2 : domainCount >= 2 ? 1 : 0;
  if (input.timestamps.length > 0) rank = Math.min(rank + 1, 2);
  if (input.hasConflict) rank = Math.max(rank - 1, 0);
  return CONFIDENCE_LABELS[rank];
}

function agreementLevelForClaim(input: {
  support: GroundedResearchSource[];
  hasConflict: boolean;
}): ValidatedResearchClaim['agreementLevel'] {
  if (input.hasConflict) return 'conflicted';
  const domainCount = new Set(input.support.map((source) => source.domain)).size;
  return domainCount >= 2 ? 'multi_source' : 'single_source';
}

function formatClaimEvidenceTag(claim: ValidatedResearchClaim): string {
  const tags = [`${claim.confidenceLabel} confidence`];
  switch (claim.agreementLevel) {
    case 'multi_source':
      tags.push('multi-source');
      break;
    case 'single_source':
      tags.push('single source');
      break;
    case 'conflicted':
      tags.push('conflicting evidence');
      break;
  }
  if (claim.conflictIds?.length) {
    tags.push(`see ${claim.conflictIds.join(', ')}`);
  }
  return tags.join('; ');
}

export function buildExtractedResearchData(
  source: GroundedResearchSource,
  evidence: Pick<PageEvidence, 'summary' | 'keyFacts' | 'dates'>,
): ExtractedResearchData {
  const claims = splitIntoClaims(evidence.summary, evidence.keyFacts);
  const metrics = extractMetrics([evidence.summary, ...evidence.keyFacts]);
  const definitions = extractDefinitions([evidence.summary, ...evidence.keyFacts]);
  return {
    source,
    claims,
    metrics,
    definitions,
    timestamps: compactLines(evidence.dates).slice(0, 6),
  };
}

export function validateExtractedResearchData(
  extractedData: ExtractedResearchData[],
): {
  validatedClaims: ValidatedResearchClaim[];
  conflicts: ResearchConflict[];
  discardedSources: GroundedResearchSource[];
  verificationLevel: ResearchContext['verificationLevel'];
} {
  const grouped = new Map<string, {
    representative: string;
    support: GroundedResearchSource[];
    metrics: Set<string>;
    timestamps: Set<string>;
  }>();
  const skeletonMap = new Map<string, Array<{ claim: string; source: GroundedResearchSource; signature: string }>>();
  const discardedSources: GroundedResearchSource[] = [];

  for (const entry of extractedData) {
    if (entry.claims.length === 0) {
      discardedSources.push(entry.source);
      continue;
    }

    for (const claim of entry.claims) {
      const key = normalizeClaimKey(claim);
      if (!key) continue;
      const group = grouped.get(key) ?? {
        representative: claim,
        support: [],
        metrics: new Set<string>(),
        timestamps: new Set<string>(),
      };
      if (!group.support.some((source) => source.url === entry.source.url)) {
        group.support.push(entry.source);
      }
      for (const metric of entry.metrics) group.metrics.add(metric);
      for (const timestamp of entry.timestamps) group.timestamps.add(timestamp);
      grouped.set(key, group);

      const skeleton = normalizeClaimSkeleton(claim);
      const variants = skeletonMap.get(skeleton) ?? [];
      variants.push({
        claim,
        source: entry.source,
        signature: numericSignature(claim),
      });
      skeletonMap.set(skeleton, variants);
    }
  }

  const conflicts: ResearchConflict[] = [];
  const conflictIdsByClaimKey = new Map<string, Set<string>>();
  const conflictEntries = Array.from(skeletonMap.entries())
    .sort(([left], [right]) => left.localeCompare(right));

  for (const [index, [skeleton, variants]] of conflictEntries.entries()) {
    const uniqueSignatures = Array.from(new Set(variants.map((variant) => variant.signature).filter(Boolean)));
    if (variants.length >= 2 && uniqueSignatures.length >= 2) {
      const conflictId = `conflict-${index + 1}`;
      conflicts.push({
        id: conflictId,
        skeleton,
        claims: variants.map((variant) => ({
          claim: variant.claim,
          source: variant.source,
        })),
      });
      for (const variant of variants) {
        const key = normalizeClaimKey(variant.claim);
        const ids = conflictIdsByClaimKey.get(key) ?? new Set<string>();
        ids.add(conflictId);
        conflictIdsByClaimKey.set(key, ids);
      }
    }
  }

  const validatedClaims: ValidatedResearchClaim[] = Array.from(grouped.entries())
    .map(([key, group]) => {
      const support = group.support.slice().sort((a, b) => a.domain.localeCompare(b.domain));
      const timestamps = Array.from(group.timestamps).sort();
      const conflictIds = Array.from(conflictIdsByClaimKey.get(key) ?? []).sort();
      const confidenceLabel = confidenceLabelForClaim({
        support,
        timestamps,
        hasConflict: conflictIds.length > 0,
      });
      return {
        claim: group.representative,
        support,
        metrics: Array.from(group.metrics).sort(),
        timestamps,
        verification: support.length >= 2 ? 'multi-source' as const : 'single-source' as const,
        confidenceScore: confidenceScoreForLabel(confidenceLabel),
        confidenceLabel,
        agreementLevel: agreementLevelForClaim({
          support,
          hasConflict: conflictIds.length > 0,
        }),
        conflictIds: conflictIds.length > 0 ? conflictIds : undefined,
      };
    })
    .sort((left, right) => {
      if (right.confidenceScore !== left.confidenceScore) return right.confidenceScore - left.confidenceScore;
      if (right.support.length !== left.support.length) return right.support.length - left.support.length;
      return left.claim.localeCompare(right.claim);
    });

  const verificationLevel: ResearchContext['verificationLevel'] = validatedClaims.some((claim) => claim.support.length >= 2)
    ? 'multi-source-verified'
    : validatedClaims.length > 0
      ? 'grounded'
      : 'generated';

  return {
    validatedClaims,
    conflicts,
    discardedSources,
    verificationLevel,
  };
}

export function shouldUseGroundedResearchPipeline(input: {
  prompt: string;
  taskKind: AgentTaskKind;
  artifactDecision: ArtifactRoutingDecision | null;
}): boolean {
  const normalized = input.prompt.toLowerCase();
  if (input.taskKind === 'research') return true;
  if (/\b(research|report|landscape|compare|comparison|latest|trends|trend|analy[sz]e|analysis)\b/.test(normalized)) {
    return true;
  }
  return Boolean(input.artifactDecision?.applies && /\b(report|research|landscape|compare|trends?)\b/.test(normalized));
}

function buildResearchSource(candidate: { url: string; title: string }): GroundedResearchSource | null {
  const domain = extractDomain(candidate.url);
  if (!domain) return null;
  return {
    url: candidate.url,
    domain,
    title: normalizeText(candidate.title) || candidate.url,
  };
}

async function waitForBrowserSettled(timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!browserService.getState().navigation.isLoading) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

function createDefaultResearchBrowserAdapter(): ResearchBrowserAdapter {
  return {
    async searchWeb(query: string) {
      await executeBrowserOperation({ kind: 'browser.search-web', payload: { query } });
      await waitForBrowserSettled();
      const searchTabId = browserService.getState().activeTabId;
      if (!searchTabId) {
        throw new Error('No active browser tab after search.');
      }
      const results = await browserService.extractSearchResults(searchTabId, MAX_RESEARCH_RESULTS);
      return { searchTabId, results };
    },
    async openPage(url: string) {
      const tab = browserService.createTab(url);
      await waitForBrowserSettled();
      const evidence = await browserService.extractPageEvidence(tab.id);
      return { evidence };
    },
    async restoreSearchTab(tabId: string) {
      browserService.activateTab(tabId);
    },
  };
}

export async function runGroundedResearchPipeline(input: {
  prompt: string;
  taskId?: string;
  minDomains?: number;
  browserAdapter?: ResearchBrowserAdapter;
}): Promise<ResearchContext> {
  const minDomains = Math.max(1, input.minDomains ?? MIN_RESEARCH_DOMAINS);
  const adapter = input.browserAdapter ?? createDefaultResearchBrowserAdapter();

  if (!input.browserAdapter && !browserService.isCreated()) {
    return {
      query: input.prompt,
      minimumDomainCount: minDomains,
      sources: [],
      extractedData: [],
      validatedClaims: [],
      conflicts: [],
      discardedSources: [],
      verificationLevel: 'generated',
      domainCount: 0,
      isSufficient: false,
      failureReason: 'Browser surface is not initialized, so grounded research could not run.',
    };
  }

  const { searchTabId, results } = await adapter.searchWeb(input.prompt);
  const extractedData: ExtractedResearchData[] = [];
  const sources: GroundedResearchSource[] = [];
  const seenDomains = new Set<string>();

  const candidateDomains = new Set<string>();
  const uniqueDomainCandidates: SearchResultCandidate[] = [];
  const duplicateDomainCandidates: SearchResultCandidate[] = [];
  for (const result of results) {
    const domain = extractDomain(result.url);
    if (!domain) continue;
    if (candidateDomains.has(domain)) {
      duplicateDomainCandidates.push(result);
      continue;
    }
    candidateDomains.add(domain);
    uniqueDomainCandidates.push(result);
  }
  const orderedCandidates = [...uniqueDomainCandidates, ...duplicateDomainCandidates];

  for (const result of orderedCandidates) {
    if (extractedData.length >= MAX_RESEARCH_PAGES) break;
    const source = buildResearchSource(result);
    if (!source) continue;
    if (seenDomains.has(source.domain)) continue;

    const { evidence } = await adapter.openPage(source.url);
    if (!evidence) continue;
    const extracted = buildExtractedResearchData(source, evidence);
    if (extracted.claims.length === 0 && extracted.metrics.length === 0 && extracted.timestamps.length === 0) {
      continue;
    }

    sources.push(source);
    extractedData.push(extracted);
    seenDomains.add(source.domain);
    if (seenDomains.size >= minDomains && extractedData.length >= minDomains) {
      break;
    }
  }

  await adapter.restoreSearchTab(searchTabId);

  const validation = validateExtractedResearchData(extractedData);
  const context: ResearchContext = {
    query: input.prompt,
    minimumDomainCount: minDomains,
    sources,
    extractedData,
    validatedClaims: validation.validatedClaims,
    conflicts: validation.conflicts,
    discardedSources: validation.discardedSources,
    verificationLevel: validation.verificationLevel,
    domainCount: new Set(sources.map((source) => source.domain)).size,
    isSufficient: new Set(sources.map((source) => source.domain)).size >= minDomains && validation.validatedClaims.length > 0,
    failureReason: null,
  };

  if (!context.isSufficient) {
    context.failureReason = context.domainCount < minDomains
      ? `Grounded research found only ${context.domainCount} distinct domain(s); at least ${minDomains} are required.`
      : 'Grounded research did not extract enough validated claims to support synthesis.';
  }

  if (input.taskId) {
    for (const source of context.sources) {
      taskMemoryStore.recordEvidence(input.taskId, `${source.title} (${source.domain})`, {
        url: source.url,
        domain: source.domain,
      });
    }
    for (const claim of context.validatedClaims) {
      taskMemoryStore.recordClaim(input.taskId, claim.claim, {
        supportDomains: claim.support.map((source) => source.domain),
        verification: claim.verification,
        confidenceLabel: claim.confidenceLabel,
        confidenceScore: claim.confidenceScore,
        agreementLevel: claim.agreementLevel,
        conflictIds: claim.conflictIds ?? [],
      });
    }
    if (context.conflicts.length > 0) {
      for (const conflict of context.conflicts) {
        taskMemoryStore.recordCritique(input.taskId, `Conflicting claims detected for "${conflict.skeleton}"`, {
          conflictId: conflict.id,
          conflictingClaims: conflict.claims.map((claim) => claim.claim),
        });
      }
    }
    taskMemoryStore.recordVerification(input.taskId, context.failureReason ?? `Grounded research completed with ${context.domainCount} domains and ${context.validatedClaims.length} validated claims.`, {
      verificationLevel: context.verificationLevel,
      domainCount: context.domainCount,
      validatedClaimCount: context.validatedClaims.length,
      sufficient: context.isSufficient,
    });
  }

  return context;
}

export function buildResearchContextPrompt(context: ResearchContext): string {
  const sections = [
    '## Grounded Research Context',
    'This task must use extraction-driven synthesis. Do not introduce claims that are not present in the validated claims below.',
    `Verification level: ${context.verificationLevel}`,
    `Distinct source domains: ${context.domainCount}/${context.minimumDomainCount}`,
  ];

  if (context.failureReason) {
    sections.push('', `Pipeline status: insufficient grounding. ${context.failureReason}`);
    sections.push('Do not create or update an artifact until adequate extracted evidence exists. If needed, explain the limitation instead of filling gaps from model knowledge.');
  }

  if (context.sources.length > 0) {
    sections.push('', '### Sources');
    for (const source of context.sources) {
      sections.push(`- ${source.domain}: ${source.title} (${source.url})`);
    }
  }

  if (context.extractedData.length > 0) {
    sections.push('', '### Extracted Source Data');
    for (const entry of context.extractedData) {
      sections.push('', `Source: ${entry.source.domain} — ${entry.source.title}`);
      if (entry.claims.length > 0) sections.push(`Claims: ${entry.claims.join(' | ')}`);
      if (entry.metrics.length > 0) sections.push(`Metrics: ${entry.metrics.join(' | ')}`);
      if (entry.definitions.length > 0) sections.push(`Definitions: ${entry.definitions.join(' | ')}`);
      if (entry.timestamps.length > 0) sections.push(`Timestamps: ${entry.timestamps.join(' | ')}`);
    }
  }

  if (context.validatedClaims.length > 0) {
    sections.push('', '### Validated Claims');
    for (const claim of context.validatedClaims) {
      const support = claim.support.map((source) => `${source.domain} (${source.url})`).join('; ');
      sections.push(`- ${claim.claim} [${formatClaimEvidenceTag(claim)}; supported by: ${support}]`);
    }
  }

  if (context.conflicts.length > 0) {
    sections.push('', '### Conflicts');
    for (const conflict of context.conflicts) {
      const details = conflict.claims.map((claim) => `${claim.source.domain}: ${claim.claim}`).join(' | ');
      sections.push(`- ${conflict.id}: ${details}`);
    }
  }

  sections.push(
    '',
    'Synthesis rule: every major claim in the final answer or artifact must map to a validated claim above. If no validated claim supports a statement, omit it.',
  );

  return sections.join('\n');
}

export function withGroundedResearchAllowedTools(
  allowedTools: 'all' | AgentToolName[],
  context: ResearchContext | null,
  fullToolCatalogNames?: AgentToolName[],
): 'all' | AgentToolName[] {
  if (!context) return allowedTools;

  const base = allowedTools === 'all'
    ? (fullToolCatalogNames ? [...fullToolCatalogNames] : 'all')
    : [...allowedTools];

  if (base === 'all') return 'all';
  const ensured = Array.from(new Set([...base, ...GROUNDED_RESEARCH_TOOL_NAMES]));
  if (context.isSufficient) return ensured;

  return ensured.filter((tool) => !ARTIFACT_WRITE_TOOL_NAMES.includes(tool));
}

export function buildGroundedResearchSystemInstructions(context: ResearchContext | null): string | null {
  if (!context) return null;
  if (!context.isSufficient) {
    return [
      '## Research Grounding Gate',
      'Grounded research mode is active, but the extracted evidence is insufficient for synthesis.',
      `Failure reason: ${context.failureReason ?? 'insufficient extracted support'}.`,
      'Do not create or update an artifact.',
      'Do not fill gaps from model knowledge.',
      'Explain that the report could not be grounded sufficiently and identify what source coverage is missing.',
    ].join('\n');
  }

  return [
    '## Research Grounding Gate',
    'Grounded research mode is active.',
    'Use only the validated extracted claims in the research context.',
    'Do not introduce unsupported facts or fill gaps from model knowledge.',
    'Every major claim in the response must map to validated extracted claims and include source attribution.',
    'High-confidence claims may be stated directly. Medium-confidence claims should be lightly qualified.',
    'Low-confidence or single-source claims must be marked as tentative or single-source when used.',
    'Claims marked as conflicting evidence must be presented as disagreement. Do not merge them into one reconciled statement.',
    'Use subtle inline markers when helpful, such as "(High confidence)", "(Single source)", or "(Conflicting evidence)".',
  ].join('\n');
}
