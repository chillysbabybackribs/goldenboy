"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const providerRouting_1 = require("./providerRouting");
const model_1 = require("../../shared/types/model");
(0, vitest_1.describe)('provider routing', () => {
    const capabilities = {
        [model_1.PRIMARY_PROVIDER_ID]: { supportsV2ToolRuntime: true },
        [model_1.HAIKU_PROVIDER_ID]: { supportsV2ToolRuntime: true },
    };
    (0, vitest_1.it)('prefers haiku for research tasks when available', () => {
        (0, vitest_1.expect)((0, providerRouting_1.pickProviderForPrompt)('Search online for the latest SEC guidance', [model_1.PRIMARY_PROVIDER_ID, model_1.HAIKU_PROVIDER_ID], undefined, capabilities))
            .toBe(model_1.HAIKU_PROVIDER_ID);
    });
    (0, vitest_1.it)('routes implementation, debug, and review tasks to gpt-5.4 when available', () => {
        (0, vitest_1.expect)((0, providerRouting_1.pickProviderForPrompt)('Patch this TypeScript file and run the local build', [model_1.PRIMARY_PROVIDER_ID, model_1.HAIKU_PROVIDER_ID], undefined, capabilities))
            .toBe(model_1.PRIMARY_PROVIDER_ID);
        (0, vitest_1.expect)((0, providerRouting_1.pickProviderForPrompt)('Debug why the Electron app crashes on startup', [model_1.PRIMARY_PROVIDER_ID, model_1.HAIKU_PROVIDER_ID], undefined, capabilities))
            .toBe(model_1.PRIMARY_PROVIDER_ID);
        (0, vitest_1.expect)((0, providerRouting_1.pickProviderForPrompt)('Review this PR diff and call out regressions', [model_1.PRIMARY_PROVIDER_ID, model_1.HAIKU_PROVIDER_ID], undefined, capabilities))
            .toBe(model_1.PRIMARY_PROVIDER_ID);
    });
    (0, vitest_1.it)('falls back to the remaining available provider', () => {
        (0, vitest_1.expect)((0, providerRouting_1.pickProviderForPrompt)('Search for the latest Electron release notes', [model_1.PRIMARY_PROVIDER_ID], undefined, capabilities))
            .toBe(model_1.PRIMARY_PROVIDER_ID);
        (0, vitest_1.expect)((0, providerRouting_1.pickProviderForPrompt)('Help me think through a product naming idea', [model_1.HAIKU_PROVIDER_ID], undefined, capabilities))
            .toBe(model_1.HAIKU_PROVIDER_ID);
        (0, vitest_1.expect)((0, providerRouting_1.pickProviderForPrompt)('Search online for the latest Electron release notes', [model_1.HAIKU_PROVIDER_ID], undefined, capabilities))
            .toBe(model_1.HAIKU_PROVIDER_ID);
    });
    (0, vitest_1.it)('routes repo-wide planning to gpt-5.4 and CI investigation to the debug path', () => {
        (0, vitest_1.expect)((0, providerRouting_1.pickProviderForPrompt)('Plan a repo-wide migration strategy', [model_1.PRIMARY_PROVIDER_ID, model_1.HAIKU_PROVIDER_ID], undefined, capabilities))
            .toBe(model_1.PRIMARY_PROVIDER_ID);
        (0, vitest_1.expect)((0, providerRouting_1.pickProviderForPrompt)('Investigate the failing CI and explain root cause', [model_1.PRIMARY_PROVIDER_ID, model_1.HAIKU_PROVIDER_ID], undefined, capabilities))
            .toBe(model_1.PRIMARY_PROVIDER_ID);
    });
    (0, vitest_1.it)('uses explicit task kind overrides ahead of prompt heuristics', () => {
        (0, vitest_1.expect)((0, providerRouting_1.pickProviderForPrompt)('Help me think through a product naming idea', [model_1.PRIMARY_PROVIDER_ID, model_1.HAIKU_PROVIDER_ID], { kind: 'implementation' }, capabilities)).toBe(model_1.PRIMARY_PROVIDER_ID);
        (0, vitest_1.expect)((0, providerRouting_1.pickProviderForPrompt)('Patch this TypeScript file and run the local build', [model_1.PRIMARY_PROVIDER_ID, model_1.HAIKU_PROVIDER_ID], { kind: 'research' }, capabilities)).toBe(model_1.HAIKU_PROVIDER_ID);
    });
});
//# sourceMappingURL=providerRouting.test.js.map