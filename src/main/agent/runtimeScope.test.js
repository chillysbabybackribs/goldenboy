"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const runtimeScope_1 = require("./runtimeScope");
describe('runtime scope', () => {
    it('enables orchestration mode when prompt requests multiple agents', () => {
        const scope = (0, runtimeScope_1.scopeForPrompt)('Split this work across multiple agents and run in parallel');
        expect((0, runtimeScope_1.looksLikeOrchestrationTask)('Split this work across multiple agents and run in parallel')).toBe(true);
        expect((0, runtimeScope_1.looksLikeDelegationTask)('Split this work across multiple agents and run in parallel')).toBe(true);
        expect(scope.allowedTools).not.toBe('all');
        expect(scope.canSpawnSubagents).toBe(true);
        expect(scope.skillNames).toEqual([]);
    });
    it('uses research mode for browser search tasks without rewriting the prompt', () => {
        const prompt = 'Search the web for the latest Anthropic model pricing';
        const scope = (0, runtimeScope_1.scopeForPrompt)(prompt);
        expect((0, runtimeScope_1.looksLikeResearchTask)(prompt)).toBe(true);
        expect((0, runtimeScope_1.looksLikeBrowserSearchTask)(prompt)).toBe(true);
        expect(scope.allowedTools).not.toBe('all');
        expect(scope.allowedTools).toEqual(expect.arrayContaining([
            'browser.research_search',
            'browser.search_web',
            'browser.navigate',
            'browser.extract_page',
            'browser.inspect_page',
            'browser.get_tabs',
            'browser.close_tab',
            'browser.click',
            'browser.type',
            'browser.get_console_events',
            'browser.get_network_events',
            'browser.get_dialogs',
            'browser.run_intent_program',
        ]));
        expect(scope.canSpawnSubagents).toBe(false);
        expect(scope.skillNames).toEqual([]);
        expect((0, runtimeScope_1.withBrowserSearchDirective)(prompt)).toBe(prompt);
    });
    it('does not misclassify browser automation/audit prompts as research tasks', () => {
        const prompt = 'Audit browser automation for navigate, click, and file-system aware tasks';
        expect((0, runtimeScope_1.looksLikeResearchTask)(prompt)).toBe(false);
        expect((0, runtimeScope_1.looksLikeBrowserSearchTask)(prompt)).toBe(false);
        expect((0, runtimeScope_1.withBrowserSearchDirective)(prompt)).toBe(prompt);
    });
    it('does not misclassify internal state questions with the word current as research tasks', () => {
        const prompt = 'What is the current artifact?';
        expect((0, runtimeScope_1.looksLikeResearchTask)(prompt)).toBe(false);
        expect((0, runtimeScope_1.looksLikeBrowserSearchTask)(prompt)).toBe(false);
        expect((0, runtimeScope_1.withBrowserSearchDirective)(prompt)).toBe(prompt);
    });
    it('keeps runtime/process cleanup prompts out of browser-search mode', () => {
        const prompt = 'Clean up the current prompt, search-tool, and memory hydration process in the runtime.';
        expect((0, runtimeScope_1.looksLikeResearchTask)(prompt)).toBe(false);
        expect((0, runtimeScope_1.looksLikeBrowserSearchTask)(prompt)).toBe(false);
        expect((0, runtimeScope_1.looksLikeBrowserAutomationTask)(prompt)).toBe(false);
        expect((0, runtimeScope_1.looksLikeImplementationTask)(prompt)).toBe(true);
        expect((0, runtimeScope_1.withBrowserSearchDirective)(prompt)).toBe(prompt);
    });
    it('routes tab-management requests into browser automation mode', () => {
        const prompt = 'Close out the browser tabs except the active one';
        const scope = (0, runtimeScope_1.scopeForPrompt)(prompt);
        expect((0, runtimeScope_1.looksLikeBrowserAutomationTask)(prompt)).toBe(true);
        expect(scope.allowedTools).not.toBe('all');
        expect(scope.allowedTools).toEqual(expect.arrayContaining([
            'browser.get_tabs',
            'browser.close_tab',
            'browser.navigate',
            'browser.click',
            'browser.type',
            'browser.wait_for',
            'browser.research_search',
            'browser.extract_page',
            'browser.get_console_events',
            'browser.get_network_events',
            'browser.get_dialogs',
            'browser.run_intent_program',
        ]));
        expect(scope.skillNames).toEqual(['browser-operation']);
    });
    it('does not turn browser-routing discussion into a browser task', () => {
        const prompt = 'Change the prompt routing so the word browser does not auto-trigger a browser task';
        expect((0, runtimeScope_1.looksLikeResearchTask)(prompt)).toBe(false);
        expect((0, runtimeScope_1.looksLikeBrowserSearchTask)(prompt)).toBe(false);
        expect((0, runtimeScope_1.looksLikeBrowserAutomationTask)(prompt)).toBe(false);
        expect((0, runtimeScope_1.withBrowserSearchDirective)(prompt)).toBe(prompt);
    });
    it('requires explicit browser action intent instead of any browser mention', () => {
        const prompt = 'Explain how the browser opens a dedicated search tab for research tasks';
        expect((0, runtimeScope_1.looksLikeResearchTask)(prompt)).toBe(false);
        expect((0, runtimeScope_1.looksLikeBrowserAutomationTask)(prompt)).toBe(false);
    });
    it('still detects explicit browser action requests', () => {
        const prompt = 'Please open a new browser tab and go to https://example.com';
        expect((0, runtimeScope_1.looksLikeBrowserAutomationTask)(prompt)).toBe(true);
    });
    it('still classifies clear freshness lookups as research tasks', () => {
        const prompt = "What's the latest on OpenAI API pricing?";
        expect((0, runtimeScope_1.looksLikeResearchTask)(prompt)).toBe(true);
        expect((0, runtimeScope_1.withBrowserSearchDirective)(prompt)).toBe(prompt);
    });
    it('detects implementation work and keeps non-orchestration execution broad', () => {
        const prompt = 'Patch this TypeScript file and run the local build';
        const scope = (0, runtimeScope_1.scopeForPrompt)(prompt);
        expect((0, runtimeScope_1.looksLikeImplementationTask)(prompt)).toBe(true);
        expect((0, runtimeScope_1.looksLikeLocalCodeTask)(prompt)).toBe(true);
        expect(scope.allowedTools).not.toBe('all');
        expect(scope.allowedTools).toEqual(expect.arrayContaining([
            'filesystem.list',
            'filesystem.search',
            'filesystem.read',
            'filesystem.write',
            'filesystem.patch',
            'terminal.exec',
            'terminal.spawn',
            'terminal.write',
            'terminal.kill',
        ]));
        expect(scope.canSpawnSubagents).toBe(false);
        expect(scope.skillNames).toEqual([]);
    });
    it('distinguishes debug and review tasks from implementation work', () => {
        const debugPrompt = 'Debug why the renderer build is failing with a TypeScript error';
        const debugScope = (0, runtimeScope_1.scopeForPrompt)(debugPrompt);
        expect((0, runtimeScope_1.looksLikeDebugTask)(debugPrompt)).toBe(true);
        expect((0, runtimeScope_1.looksLikeImplementationTask)(debugPrompt)).toBe(false);
        expect(debugScope.maxToolTurns).toBe(28);
        expect(debugScope.allowedTools).not.toBe('all');
        expect(debugScope.allowedTools).toEqual(expect.arrayContaining([
            'filesystem.search',
            'filesystem.read',
            'filesystem.patch',
            'filesystem.list',
            'terminal.exec',
            'terminal.spawn',
            'terminal.write',
            'terminal.kill',
            'browser.evaluate_js',
            'chat.thread_summary',
        ]));
        expect(debugScope.skillNames).toEqual([]);
        const reviewPrompt = 'Review this PR diff and identify regressions before merge';
        const reviewScope = (0, runtimeScope_1.scopeForPrompt)(reviewPrompt);
        expect((0, runtimeScope_1.looksLikeReviewTask)(reviewPrompt)).toBe(true);
        expect((0, runtimeScope_1.looksLikeImplementationTask)(reviewPrompt)).toBe(false);
        expect(reviewScope.allowedTools).not.toBe('all');
        expect(reviewScope.allowedTools).toEqual(expect.arrayContaining([
            'filesystem.list',
            'filesystem.search',
            'filesystem.read',
            'chat.thread_summary',
            'chat.read_last',
            'chat.search',
            'chat.read_window',
            'chat.read_message',
        ]));
        expect(reviewScope.canSpawnSubagents).toBe(false);
        expect(reviewScope.skillNames).toEqual([]);
    });
    it('uses the default scoped preset for general tasks', () => {
        const scope = (0, runtimeScope_1.scopeForPrompt)('Help me think through a product naming idea');
        expect(scope.allowedTools).not.toBe('all');
    });
    it('starts obvious local-files tasks with a focused filesystem surface', () => {
        const scope = (0, runtimeScope_1.scopeForPrompt)('List all .md files in my Desktop');
        expect(scope.allowedTools).not.toBe('all');
        expect(scope.allowedTools).toEqual(expect.arrayContaining([
            'runtime.search_tools',
            'runtime.request_tool_pack',
            'runtime.list_tool_packs',
            'filesystem.list',
            'filesystem.search',
            'filesystem.read',
        ]));
        expect(scope.allowedTools).not.toEqual(expect.arrayContaining([
            'browser.research_search',
            'browser.navigate',
        ]));
    });
    it('treats report updates that require current web sources as research tasks', () => {
        const prompt = 'Update this report using only current web sources with at least 3 sources with links and remove unverifiable claims.';
        const scope = (0, runtimeScope_1.scopeForPrompt)(prompt);
        expect((0, runtimeScope_1.looksLikeResearchTask)(prompt)).toBe(true);
        expect(scope.allowedTools).not.toBe('all');
        expect(scope.allowedTools).toEqual(expect.arrayContaining([
            'browser.research_search',
            'browser.search_web',
            'browser.navigate',
            'browser.extract_page',
            'browser.get_tabs',
            'browser.close_tab',
            'browser.get_console_events',
            'browser.get_network_events',
        ]));
    });
    it('treats CI failure investigation as debug work and repo-wide planning as orchestration', () => {
        const ciPrompt = 'Investigate the failing CI and explain root cause';
        expect((0, runtimeScope_1.looksLikeDebugTask)(ciPrompt)).toBe(true);
        expect((0, runtimeScope_1.looksLikeImplementationTask)(ciPrompt)).toBe(false);
        const planningPrompt = 'Plan a repo-wide migration strategy';
        const planningScope = (0, runtimeScope_1.scopeForPrompt)(planningPrompt);
        expect((0, runtimeScope_1.looksLikeOrchestrationTask)(planningPrompt)).toBe(true);
        expect(planningScope.canSpawnSubagents).toBe(true);
        expect(planningScope.skillNames).toEqual([]);
    });
    it('treats explicit task profile overrides as authoritative', () => {
        const prompt = 'Help me think through a product naming idea';
        const scope = (0, runtimeScope_1.scopeForPrompt)(prompt, {
            kind: 'research',
            skillNames: ['browser-operation', 'local-debug'],
            toolPackPreset: 'all',
            canSpawnSubagents: true,
            maxToolTurns: 9,
        });
        expect(scope.allowedTools).toBe('all');
        expect(scope.canSpawnSubagents).toBe(true);
        expect(scope.maxToolTurns).toBe(9);
        expect(scope.skillNames).toEqual(['browser-operation', 'local-debug']);
        expect((0, runtimeScope_1.withBrowserSearchDirective)(prompt, { kind: 'research' })).toBe(prompt);
        expect((0, runtimeScope_1.withBrowserSearchDirective)(prompt, { kind: 'general' })).toBe(prompt);
    });
    it('normalizes legacy task kinds in overrides for compatibility', () => {
        expect((0, runtimeScope_1.scopeForPrompt)('Investigate a crash', { kind: 'delegation' }).canSpawnSubagents).toBe(true);
        expect((0, runtimeScope_1.withBrowserSearchDirective)('Find current pricing', { kind: 'browser-search' })).toBe('Find current pricing');
        expect((0, runtimeScope_1.looksLikeLocalCodeTask)('Patch this file and run the build')).toBe(true);
    });
    it('supports the tighter four-tool preset for benchmark runs', () => {
        const scope = (0, runtimeScope_1.scopeForPrompt)('Search the web for current SEC guidance', {
            kind: 'research',
            toolPackPreset: 'mode-4',
        });
        expect(scope.allowedTools).not.toBe('all');
        expect(scope.allowedTools).toHaveLength(8);
        expect(scope.allowedTools).toContain('runtime.search_tools');
        expect(scope.allowedTools).toContain('runtime.require_tools');
        expect(scope.allowedTools).toContain('runtime.invoke_tool');
        expect(scope.allowedTools).toContain('runtime.request_tool_pack');
        expect(scope.allowedTools).toContain('runtime.list_tool_packs');
    });
});
//# sourceMappingURL=runtimeScope.test.js.map