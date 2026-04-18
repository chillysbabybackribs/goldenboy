"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
vitest_1.vi.mock('../browser/BrowserService', () => ({
    browserService: {
        getState: () => ({ navigation: { isLoading: false } }),
        extractSearchResults: vitest_1.vi.fn(),
        createTab: vitest_1.vi.fn(),
        extractPageEvidence: vitest_1.vi.fn(),
        activateTab: vitest_1.vi.fn(),
    },
}));
vitest_1.vi.mock('../browser/browserOperations', () => ({
    executeBrowserOperation: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('../models/taskMemoryStore', () => ({
    taskMemoryStore: {
        recordEvidence: vitest_1.vi.fn(),
        recordClaim: vitest_1.vi.fn(),
        recordCritique: vitest_1.vi.fn(),
        recordVerification: vitest_1.vi.fn(),
    },
}));
const researchGrounding_1 = require("./researchGrounding");
function source(domain, title = domain) {
    return {
        url: `https://${domain}/article`,
        domain,
        title,
    };
}
function extracted(sourceData, claims, metrics = [], timestamps = []) {
    return {
        source: sourceData,
        claims,
        metrics,
        definitions: [],
        timestamps,
    };
}
function context(overrides) {
    return {
        query: 'local ai tooling landscape',
        minimumDomainCount: researchGrounding_1.MIN_RESEARCH_DOMAINS,
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
(0, vitest_1.afterEach)(() => {
    vitest_1.vi.clearAllMocks();
});
(0, vitest_1.describe)('research grounding', () => {
    (0, vitest_1.it)('deduplicates supported claims, flags conflicting numeric claims, and discards weak sources', () => {
        const primary = source('browserless.io', 'Browserless');
        const corroborating = source('playwright.dev', 'Playwright');
        const conflicting = source('example.org', 'Example');
        const weak = source('thin-source.dev', 'Thin Source');
        const result = (0, researchGrounding_1.validateExtractedResearchData)([
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
        (0, vitest_1.expect)(result.validatedClaims).toEqual(vitest_1.expect.arrayContaining([
            vitest_1.expect.objectContaining({
                claim: 'Local deployment is rising among small teams.',
                verification: 'multi-source',
                confidenceLabel: 'high',
                confidenceScore: 1,
                agreementLevel: 'multi_source',
            }),
            vitest_1.expect.objectContaining({
                claim: 'Browser automation adoption reached 20% in 2025.',
                verification: 'single-source',
                confidenceLabel: 'low',
                confidenceScore: 0.33,
                agreementLevel: 'conflicted',
                conflictIds: ['conflict-1'],
            }),
            vitest_1.expect.objectContaining({
                claim: 'Browser automation adoption reached 35% in 2025.',
                verification: 'single-source',
                confidenceLabel: 'low',
                confidenceScore: 0.33,
                agreementLevel: 'conflicted',
                conflictIds: ['conflict-1'],
            }),
        ]));
        (0, vitest_1.expect)(result.conflicts).toHaveLength(1);
        (0, vitest_1.expect)(result.conflicts[0]).toEqual(vitest_1.expect.objectContaining({
            id: 'conflict-1',
        }));
        (0, vitest_1.expect)(result.discardedSources).toEqual([weak]);
        (0, vitest_1.expect)(result.verificationLevel).toBe('multi-source-verified');
    });
    (0, vitest_1.it)('assigns low confidence to single-source claims without timestamp support', () => {
        const result = (0, researchGrounding_1.validateExtractedResearchData)([
            extracted(source('single-source.dev'), [
                'A local inference stack can reduce cloud costs for some teams.',
            ]),
        ]);
        (0, vitest_1.expect)(result.validatedClaims).toEqual([
            vitest_1.expect.objectContaining({
                claim: 'A local inference stack can reduce cloud costs for some teams.',
                confidenceLabel: 'low',
                confidenceScore: 0.33,
                agreementLevel: 'single_source',
            }),
        ]);
    });
    (0, vitest_1.it)('strips artifact write tools when grounding is insufficient', () => {
        const tools = (0, researchGrounding_1.withGroundedResearchAllowedTools)(['artifact.create', 'artifact.replace_content', 'artifact.append_content', 'browser.research_search', 'filesystem.read'], context());
        (0, vitest_1.expect)(tools).toEqual(vitest_1.expect.arrayContaining([
            'browser.research_search',
            'browser.search_page_cache',
            'browser.read_cached_chunk',
            'filesystem.read',
        ]));
        (0, vitest_1.expect)(tools).not.toEqual(vitest_1.expect.arrayContaining([
            'artifact.create',
            'artifact.replace_content',
            'artifact.append_content',
        ]));
    });
    (0, vitest_1.it)('builds a strict insufficient-grounding instruction block', () => {
        const instructions = (0, researchGrounding_1.buildGroundedResearchSystemInstructions)(context());
        (0, vitest_1.expect)(instructions).toContain('Do not create or update an artifact.');
        (0, vitest_1.expect)(instructions).toContain('Do not fill gaps from model knowledge.');
    });
    (0, vitest_1.it)('builds a validated-claims context prompt with source attribution', () => {
        const prompt = (0, researchGrounding_1.buildResearchContextPrompt)(context({
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
        (0, vitest_1.expect)(prompt).toContain('### Validated Claims');
        (0, vitest_1.expect)(prompt).toContain('high confidence');
        (0, vitest_1.expect)(prompt).toContain('multi-source');
        (0, vitest_1.expect)(prompt).toContain('conflict-1');
        (0, vitest_1.expect)(prompt).toContain('browserless.io: Browser automation adoption reached 20% in 2025.');
        (0, vitest_1.expect)(prompt).toContain('example.org: Browser automation adoption reached 35% in 2025.');
        (0, vitest_1.expect)(prompt).toContain('browserless.io');
        (0, vitest_1.expect)(prompt).toContain('playwright.dev');
        (0, vitest_1.expect)(prompt).toContain('If no validated claim supports a statement, omit it.');
    });
    (0, vitest_1.it)('builds grounded synthesis instructions that preserve conflict surfacing and evidence weighting', () => {
        const instructions = (0, researchGrounding_1.buildGroundedResearchSystemInstructions)(context({
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
        (0, vitest_1.expect)(instructions).toContain('High-confidence claims may be stated directly.');
        (0, vitest_1.expect)(instructions).toContain('single-source claims must be marked as tentative or single-source');
        (0, vitest_1.expect)(instructions).toContain('presented as disagreement');
    });
    (0, vitest_1.it)('gathers distinct domains and produces stable validated claims from the browser adapter', async () => {
        const adapter = {
            async searchWeb() {
                return {
                    searchTabId: 'search-tab',
                    results: [
                        { url: 'https://browserless.io/blog/one', title: 'Browserless' },
                        { url: 'https://www.playwright.dev/blog/two', title: 'Playwright' },
                        { url: 'https://browserless.io/blog/duplicate', title: 'Duplicate Domain' },
                        { url: 'https://openai.com/news/three', title: 'OpenAI' },
                    ],
                };
            },
            async openPage(url) {
                if (url.includes('browserless.io')) {
                    return {
                        evidence: {
                            title: 'Browserless',
                            summary: 'Local deployment is rising among small teams. Browser automation adoption reached 20% in 2025.',
                            keyFacts: ['Local deployment is rising among small teams.'],
                            dates: ['2025'],
                        },
                    };
                }
                if (url.includes('playwright.dev')) {
                    return {
                        evidence: {
                            title: 'Playwright',
                            summary: 'Local deployment is rising among small teams and teams want stronger browser reliability.',
                            keyFacts: ['Local deployment is rising among small teams.'],
                            dates: ['2025'],
                        },
                    };
                }
                return {
                    evidence: {
                        title: 'OpenAI',
                        summary: 'Hybrid local plus cloud workflows are becoming common.',
                        keyFacts: ['Hybrid local plus cloud workflows are becoming common.'],
                        dates: ['2025'],
                    },
                };
            },
            async restoreSearchTab() {
                return;
            },
        };
        const first = await (0, researchGrounding_1.runGroundedResearchPipeline)({
            prompt: 'Research the local AI tooling landscape.',
            taskId: 'task-grounding',
            browserAdapter: adapter,
        });
        const second = await (0, researchGrounding_1.runGroundedResearchPipeline)({
            prompt: 'Research the local AI tooling landscape.',
            browserAdapter: adapter,
        });
        (0, vitest_1.expect)(first.isSufficient).toBe(true);
        (0, vitest_1.expect)(first.domainCount).toBe(3);
        (0, vitest_1.expect)(first.sources.map((entry) => entry.domain)).toEqual([
            'browserless.io',
            'playwright.dev',
            'openai.com',
        ]);
        (0, vitest_1.expect)(first.validatedClaims.map((claim) => claim.claim)).toEqual(second.validatedClaims.map((claim) => claim.claim));
    });
    (0, vitest_1.it)('fails gracefully when too few distinct domains are gathered', async () => {
        const adapter = {
            async searchWeb() {
                return {
                    searchTabId: 'search-tab',
                    results: [
                        { url: 'https://browserless.io/blog/one', title: 'Browserless' },
                        { url: 'https://browserless.io/blog/two', title: 'Browserless Duplicate' },
                    ],
                };
            },
            async openPage() {
                return {
                    evidence: {
                        title: 'Browserless',
                        summary: 'Local deployment is rising among small teams.',
                        keyFacts: ['Local deployment is rising among small teams.'],
                        dates: ['2025'],
                    },
                };
            },
            async restoreSearchTab() {
                return;
            },
        };
        const result = await (0, researchGrounding_1.runGroundedResearchPipeline)({
            prompt: 'Research the local AI tooling landscape.',
            browserAdapter: adapter,
        });
        (0, vitest_1.expect)(result.isSufficient).toBe(false);
        (0, vitest_1.expect)(result.failureReason).toContain('at least 3 are required');
        (0, vitest_1.expect)(result.domainCount).toBe(1);
        const tools = (0, researchGrounding_1.withGroundedResearchAllowedTools)(['artifact.create', 'artifact.replace_content', 'browser.research_search'], result);
        (0, vitest_1.expect)(tools).toEqual(vitest_1.expect.arrayContaining([
            'browser.research_search',
            'browser.search_page_cache',
            'browser.read_cached_chunk',
        ]));
        (0, vitest_1.expect)(tools).not.toEqual(vitest_1.expect.arrayContaining([
            'artifact.create',
            'artifact.replace_content',
            'artifact.append_content',
        ]));
    });
    (0, vitest_1.it)('keeps artifact writes blocked when grounding gathers sources but no validated evidence', async () => {
        const adapter = {
            async searchWeb() {
                return {
                    searchTabId: 'search-tab',
                    results: [
                        { url: 'https://browserless.io/blog/one', title: 'Browserless' },
                        { url: 'https://playwright.dev/blog/two', title: 'Playwright' },
                        { url: 'https://openai.com/news/three', title: 'OpenAI' },
                    ],
                };
            },
            async openPage(url) {
                return {
                    evidence: {
                        title: url,
                        summary: '2025 saw 20%.',
                        keyFacts: [],
                        dates: ['2025'],
                    },
                };
            },
            async restoreSearchTab() {
                return;
            },
        };
        const result = await (0, researchGrounding_1.runGroundedResearchPipeline)({
            prompt: 'Research the local AI tooling landscape.',
            browserAdapter: adapter,
        });
        (0, vitest_1.expect)(result.isSufficient).toBe(false);
        (0, vitest_1.expect)(result.failureReason).toContain('did not extract enough validated claims');
        const tools = (0, researchGrounding_1.withGroundedResearchAllowedTools)(['artifact.create', 'artifact.replace_content', 'artifact.append_content', 'browser.research_search'], result);
        (0, vitest_1.expect)(tools).toEqual(vitest_1.expect.arrayContaining([
            'browser.research_search',
            'browser.search_page_cache',
            'browser.read_cached_chunk',
        ]));
        (0, vitest_1.expect)(tools).not.toEqual(vitest_1.expect.arrayContaining([
            'artifact.create',
            'artifact.replace_content',
            'artifact.append_content',
        ]));
    });
});
//# sourceMappingURL=researchGrounding.test.js.map