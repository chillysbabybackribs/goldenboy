import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../browser/BrowserService', () => ({
  browserService: {
    getState: () => ({ navigation: { isLoading: false } }),
    extractSearchResults: vi.fn(),
    createTab: vi.fn(),
    extractPageEvidence: vi.fn(),
    activateTab: vi.fn(),
  },
}));

vi.mock('../browser/browserOperations', () => ({
  executeBrowserOperation: vi.fn(),
}));

vi.mock('../models/taskMemoryStore', () => ({
  taskMemoryStore: {
    recordEvidence: vi.fn(),
    recordClaim: vi.fn(),
    recordCritique: vi.fn(),
    recordVerification: vi.fn(),
  },
}));

import {
  MIN_RESEARCH_DOMAINS,
  buildGroundedResearchSystemInstructions,
  buildResearchContextPrompt,
  runGroundedResearchPipeline,
  validateExtractedResearchData,
  withGroundedResearchAllowedTools,
  type ExtractedResearchData,
  type GroundedResearchSource,
  type ResearchBrowserAdapter,
  type ResearchContext,
} from './researchGrounding';

function source(domain: string, title = domain): GroundedResearchSource {
  return {
    url: `https://${domain}/article`,
    domain,
    title,
  };
}

function extracted(sourceData: GroundedResearchSource, claims: string[], metrics: string[] = [], timestamps: string[] = []): ExtractedResearchData {
  return {
    source: sourceData,
    claims,
    metrics,
    definitions: [],
    timestamps,
  };
}

function context(overrides?: Partial<ResearchContext>): ResearchContext {
  return {
    query: 'local ai tooling landscape',
    minimumDomainCount: MIN_RESEARCH_DOMAINS,
    sources: [source('example.com')],
    extractedData: [],
    validatedClaims: [],
    conflicts: [],
    discardedSources: [],
    verificationLevel: 'generated',
    domainCount: 1,
    isSufficient: false,
    failureReason: 'Not enough distinct domains.',
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('research grounding', () => {
  it('deduplicates supported claims, flags conflicting numeric claims, and discards weak sources', () => {
    const primary = source('browserless.io', 'Browserless');
    const corroborating = source('playwright.dev', 'Playwright');
    const conflicting = source('example.org', 'Example');
    const weak = source('thin-source.dev', 'Thin Source');

    const result = validateExtractedResearchData([
      extracted(primary, [
        'Local deployment is rising among small teams.',
        'Browser automation adoption reached 20% in 2025.',
      ], ['20%'], ['2025']),
      extracted(corroborating, [
        'Local deployment is rising among small teams.',
      ], [], ['2025']),
      extracted(conflicting, [
        'Browser automation adoption reached 35% in 2025.',
      ], ['35%'], ['2025']),
      extracted(weak, []),
    ]);

    expect(result.validatedClaims).toEqual(expect.arrayContaining([
      expect.objectContaining({
        claim: 'Local deployment is rising among small teams.',
        verification: 'multi-source',
        confidenceLabel: 'high',
        confidenceScore: 1,
        agreementLevel: 'multi_source',
      }),
      expect.objectContaining({
        claim: 'Browser automation adoption reached 20% in 2025.',
        verification: 'single-source',
        confidenceLabel: 'low',
        confidenceScore: 0.33,
        agreementLevel: 'conflicted',
        conflictIds: ['conflict-1'],
      }),
      expect.objectContaining({
        claim: 'Browser automation adoption reached 35% in 2025.',
        verification: 'single-source',
        confidenceLabel: 'low',
        confidenceScore: 0.33,
        agreementLevel: 'conflicted',
        conflictIds: ['conflict-1'],
      }),
    ]));
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toEqual(expect.objectContaining({
      id: 'conflict-1',
    }));
    expect(result.discardedSources).toEqual([weak]);
    expect(result.verificationLevel).toBe('multi-source-verified');
  });

  it('assigns low confidence to single-source claims without timestamp support', () => {
    const result = validateExtractedResearchData([
      extracted(source('single-source.dev'), [
        'A local inference stack can reduce cloud costs for some teams.',
      ]),
    ]);

    expect(result.validatedClaims).toEqual([
      expect.objectContaining({
        claim: 'A local inference stack can reduce cloud costs for some teams.',
        confidenceLabel: 'low',
        confidenceScore: 0.33,
        agreementLevel: 'single_source',
      }),
    ]);
  });

  it('strips artifact write tools when grounding is insufficient', () => {
    const tools = withGroundedResearchAllowedTools(
      ['artifact.create', 'artifact.replace_content', 'artifact.append_content', 'browser.research_search', 'filesystem.read'],
      context(),
    );

    expect(tools).toEqual(expect.arrayContaining([
      'browser.research_search',
      'browser.search_page_cache',
      'browser.read_cached_chunk',
      'filesystem.read',
    ]));
    expect(tools).not.toEqual(expect.arrayContaining([
      'artifact.create',
      'artifact.replace_content',
      'artifact.append_content',
    ]));
  });

  it('builds a strict insufficient-grounding instruction block', () => {
    const instructions = buildGroundedResearchSystemInstructions(context());

    expect(instructions).toContain('Do not create or update an artifact.');
    expect(instructions).toContain('Do not fill gaps from model knowledge.');
  });

  it('builds a validated-claims context prompt with source attribution', () => {
    const prompt = buildResearchContextPrompt(context({
      isSufficient: true,
      failureReason: null,
      sources: [source('browserless.io'), source('playwright.dev'), source('openai.com')],
      extractedData: [
        extracted(source('browserless.io'), ['A']),
        extracted(source('playwright.dev'), ['B']),
      ],
      validatedClaims: [{
        claim: 'Local deployment is rising among small teams.',
        support: [source('browserless.io'), source('playwright.dev')],
        metrics: ['20%'],
        timestamps: ['2025'],
        verification: 'multi-source',
        confidenceScore: 1,
        confidenceLabel: 'high',
        agreementLevel: 'multi_source',
      }],
      conflicts: [{
        id: 'conflict-1',
        skeleton: 'browser automation adoption reached in',
        claims: [
          { claim: 'Browser automation adoption reached 20% in 2025.', source: source('browserless.io') },
          { claim: 'Browser automation adoption reached 35% in 2025.', source: source('example.org') },
        ],
      }],
      verificationLevel: 'multi-source-verified',
      domainCount: 3,
    }));

    expect(prompt).toContain('### Validated Claims');
    expect(prompt).toContain('high confidence');
    expect(prompt).toContain('multi-source');
    expect(prompt).toContain('conflict-1');
    expect(prompt).toContain('browserless.io: Browser automation adoption reached 20% in 2025.');
    expect(prompt).toContain('example.org: Browser automation adoption reached 35% in 2025.');
    expect(prompt).toContain('browserless.io');
    expect(prompt).toContain('playwright.dev');
    expect(prompt).toContain('If no validated claim supports a statement, omit it.');
  });

  it('builds grounded synthesis instructions that preserve conflict surfacing and evidence weighting', () => {
    const instructions = buildGroundedResearchSystemInstructions(context({
      isSufficient: true,
      failureReason: null,
      validatedClaims: [{
        claim: 'Local deployment is rising among small teams.',
        support: [source('browserless.io'), source('playwright.dev')],
        metrics: [],
        timestamps: ['2025'],
        verification: 'multi-source',
        confidenceScore: 1,
        confidenceLabel: 'high',
        agreementLevel: 'multi_source',
      }],
      conflicts: [{
        id: 'conflict-1',
        skeleton: 'browser automation adoption reached in',
        claims: [
          { claim: 'Browser automation adoption reached 20% in 2025.', source: source('browserless.io') },
          { claim: 'Browser automation adoption reached 35% in 2025.', source: source('example.org') },
        ],
      }],
    }));

    expect(instructions).toContain('High-confidence claims may be stated directly.');
    expect(instructions).toContain('single-source claims must be marked as tentative or single-source');
    expect(instructions).toContain('presented as disagreement');
  });

  it('gathers distinct domains and produces stable validated claims from the browser adapter', async () => {
    const adapter: ResearchBrowserAdapter = {
      async searchWeb() {
        return {
          searchTabId: 'search-tab',
          results: [
            { url: 'https://browserless.io/blog/one', title: 'Browserless' },
            { url: 'https://www.playwright.dev/blog/two', title: 'Playwright' },
            { url: 'https://browserless.io/blog/duplicate', title: 'Duplicate Domain' },
            { url: 'https://openai.com/news/three', title: 'OpenAI' },
          ] as never,
        };
      },
      async openPage(url: string) {
        if (url.includes('browserless.io')) {
          return {
            evidence: {
              title: 'Browserless',
              summary: 'Local deployment is rising among small teams. Browser automation adoption reached 20% in 2025.',
              keyFacts: ['Local deployment is rising among small teams.'],
              dates: ['2025'],
            } as never,
          };
        }
        if (url.includes('playwright.dev')) {
          return {
            evidence: {
              title: 'Playwright',
              summary: 'Local deployment is rising among small teams and teams want stronger browser reliability.',
              keyFacts: ['Local deployment is rising among small teams.'],
              dates: ['2025'],
            } as never,
          };
        }
        return {
          evidence: {
            title: 'OpenAI',
            summary: 'Hybrid local plus cloud workflows are becoming common.',
            keyFacts: ['Hybrid local plus cloud workflows are becoming common.'],
            dates: ['2025'],
          } as never,
        };
      },
      async restoreSearchTab() {
        return;
      },
    };

    const first = await runGroundedResearchPipeline({
      prompt: 'Research the local AI tooling landscape.',
      taskId: 'task-grounding',
      browserAdapter: adapter,
    });
    const second = await runGroundedResearchPipeline({
      prompt: 'Research the local AI tooling landscape.',
      browserAdapter: adapter,
    });

    expect(first.isSufficient).toBe(true);
    expect(first.domainCount).toBe(3);
    expect(first.sources.map((entry) => entry.domain)).toEqual([
      'browserless.io',
      'playwright.dev',
      'openai.com',
    ]);
    expect(first.validatedClaims.map((claim) => claim.claim)).toEqual(second.validatedClaims.map((claim) => claim.claim));
  });

  it('fails gracefully when too few distinct domains are gathered', async () => {
    const adapter: ResearchBrowserAdapter = {
      async searchWeb() {
        return {
          searchTabId: 'search-tab',
          results: [
            { url: 'https://browserless.io/blog/one', title: 'Browserless' },
            { url: 'https://browserless.io/blog/two', title: 'Browserless Duplicate' },
          ] as never,
        };
      },
      async openPage() {
        return {
          evidence: {
            title: 'Browserless',
            summary: 'Local deployment is rising among small teams.',
            keyFacts: ['Local deployment is rising among small teams.'],
            dates: ['2025'],
          } as never,
        };
      },
      async restoreSearchTab() {
        return;
      },
    };

    const result = await runGroundedResearchPipeline({
      prompt: 'Research the local AI tooling landscape.',
      browserAdapter: adapter,
    });

    expect(result.isSufficient).toBe(false);
    expect(result.failureReason).toContain('at least 3 are required');
    expect(result.domainCount).toBe(1);
    const tools = withGroundedResearchAllowedTools(
      ['artifact.create', 'artifact.replace_content', 'browser.research_search'],
      result,
    );
    expect(tools).toEqual(expect.arrayContaining([
      'browser.research_search',
      'browser.search_page_cache',
      'browser.read_cached_chunk',
    ]));
    expect(tools).not.toEqual(expect.arrayContaining([
      'artifact.create',
      'artifact.replace_content',
      'artifact.append_content',
    ]));
  });

  it('keeps artifact writes blocked when grounding gathers sources but no validated evidence', async () => {
    const adapter: ResearchBrowserAdapter = {
      async searchWeb() {
        return {
          searchTabId: 'search-tab',
          results: [
            { url: 'https://browserless.io/blog/one', title: 'Browserless' },
            { url: 'https://playwright.dev/blog/two', title: 'Playwright' },
            { url: 'https://openai.com/news/three', title: 'OpenAI' },
          ] as never,
        };
      },
      async openPage(url: string) {
        return {
          evidence: {
            title: url,
            summary: '2025 saw 20%.',
            keyFacts: [],
            dates: ['2025'],
          } as never,
        };
      },
      async restoreSearchTab() {
        return;
      },
    };

    const result = await runGroundedResearchPipeline({
      prompt: 'Research the local AI tooling landscape.',
      browserAdapter: adapter,
    });

    expect(result.isSufficient).toBe(false);
    expect(result.failureReason).toContain('did not extract enough validated claims');
    const tools = withGroundedResearchAllowedTools(
      ['artifact.create', 'artifact.replace_content', 'artifact.append_content', 'browser.research_search'],
      result,
    );
    expect(tools).toEqual(expect.arrayContaining([
      'browser.research_search',
      'browser.search_page_cache',
      'browser.read_cached_chunk',
    ]));
    expect(tools).not.toEqual(expect.arrayContaining([
      'artifact.create',
      'artifact.replace_content',
      'artifact.append_content',
    ]));
  });
});
