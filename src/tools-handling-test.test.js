"use strict";
/**
 * TOOLS HANDLING TEST
 *
 * Lightweight diagnostic coverage for provider tool transmission patterns.
 * These tests intentionally stay local and do not import runtime services.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const MOCK_BROWSER_TOOLS = [
    { name: 'browser.get_state', description: 'Get current browser state' },
    { name: 'browser.get_tabs', description: 'Get list of open tabs' },
    { name: 'browser.navigate', description: 'Navigate to URL' },
    { name: 'browser.search_web', description: 'Search the web' },
    { name: 'browser.research_search', description: 'Research search' },
    { name: 'browser.click', description: 'Click element' },
    { name: 'browser.type', description: 'Type text' },
    { name: 'browser.cache_current_page', description: 'Cache current page' },
    { name: 'browser.search_page_cache', description: 'Search page cache' },
    { name: 'browser.read_cached_chunk', description: 'Read cached chunk' },
];
const MOCK_FILESYSTEM_TOOLS = [
    { name: 'filesystem.list', description: 'List directory' },
    { name: 'filesystem.search', description: 'Search files' },
    { name: 'filesystem.read', description: 'Read file' },
    { name: 'filesystem.write', description: 'Write file' },
    { name: 'filesystem.patch', description: 'Patch file' },
];
const MOCK_TERMINAL_TOOLS = [
    { name: 'terminal.exec', description: 'Execute command' },
    { name: 'terminal.spawn', description: 'Spawn process' },
];
const MOCK_CHAT_TOOLS = [
    { name: 'chat.thread_summary', description: 'Get thread summary' },
    { name: 'chat.read_last', description: 'Read last messages' },
    { name: 'chat.search', description: 'Search chat' },
];
const ALL_MOCK_TOOLS = [
    ...MOCK_BROWSER_TOOLS,
    ...MOCK_FILESYSTEM_TOOLS,
    ...MOCK_TERMINAL_TOOLS,
    ...MOCK_CHAT_TOOLS,
];
(0, vitest_1.describe)('tools handling diagnostics', () => {
    (0, vitest_1.it)('keeps a stable mock tool inventory for local audits', () => {
        (0, vitest_1.expect)(ALL_MOCK_TOOLS).toHaveLength(20);
        (0, vitest_1.expect)(ALL_MOCK_TOOLS[0].name).toBe('browser.get_state');
        (0, vitest_1.expect)(ALL_MOCK_TOOLS.at(-1)?.name).toBe('chat.search');
    });
    (0, vitest_1.it)('shows the relative size of the codex-style tool planning surface', () => {
        const estimatedTokens = ALL_MOCK_TOOLS.reduce((sum, tool) => {
            return sum + Math.ceil((tool.name.length + tool.description.length) / 4);
        }, 0);
        (0, vitest_1.expect)(estimatedTokens).toBeGreaterThan(50);
    });
});
//# sourceMappingURL=tools-handling-test.test.js.map