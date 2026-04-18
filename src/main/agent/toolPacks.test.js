"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const toolPacks_1 = require("./toolPacks");
(0, vitest_1.describe)('tool packs', () => {
    (0, vitest_1.it)('returns exact four-tool packs for the minimal preset', () => {
        const research = (0, toolPacks_1.resolveAllowedToolsForTaskKind)('research', 'mode-4');
        const orchestration = (0, toolPacks_1.resolveAllowedToolsForTaskKind)('orchestration', 'mode-4');
        (0, vitest_1.expect)(research).not.toBe('all');
        (0, vitest_1.expect)(orchestration).not.toBe('all');
        (0, vitest_1.expect)(research).toHaveLength(8);
        (0, vitest_1.expect)(orchestration).toHaveLength(8);
        (0, vitest_1.expect)(research).toEqual(vitest_1.expect.arrayContaining([
            'runtime.search_tools',
            'runtime.require_tools',
            'runtime.invoke_tool',
            'runtime.request_tool_pack',
            'runtime.list_tool_packs',
            'browser.research_search',
            'browser.search_page_cache',
        ]));
        (0, vitest_1.expect)(orchestration).toEqual(vitest_1.expect.arrayContaining([
            'runtime.search_tools',
            'runtime.require_tools',
            'runtime.invoke_tool',
            'runtime.request_tool_pack',
            'runtime.list_tool_packs',
            'subagent.spawn',
            'subagent.wait',
        ]));
    });
    (0, vitest_1.it)('returns exact six-tool packs for the default preset', () => {
        const implementation = (0, toolPacks_1.resolveAllowedToolsForTaskKind)('implementation', 'mode-6');
        const review = (0, toolPacks_1.resolveAllowedToolsForTaskKind)('review', 'mode-6');
        const browserAutomation = (0, toolPacks_1.resolveAllowedToolsForTaskKind)('browser-automation', 'mode-6');
        const general = (0, toolPacks_1.resolveAllowedToolsForTaskKind)('general', 'mode-6');
        (0, vitest_1.expect)(implementation).not.toBe('all');
        (0, vitest_1.expect)(review).not.toBe('all');
        (0, vitest_1.expect)(browserAutomation).not.toBe('all');
        (0, vitest_1.expect)(general).not.toBe('all');
        (0, vitest_1.expect)(implementation).toHaveLength(10);
        (0, vitest_1.expect)(review).toHaveLength(10);
        (0, vitest_1.expect)(browserAutomation).toHaveLength(11);
        (0, vitest_1.expect)(general).toHaveLength(11);
        (0, vitest_1.expect)(implementation).toEqual(vitest_1.expect.arrayContaining([
            'runtime.search_tools',
            'runtime.require_tools',
            'runtime.invoke_tool',
            'runtime.request_tool_pack',
            'runtime.list_tool_packs',
            'filesystem.patch',
            'filesystem.write',
            'terminal.exec',
        ]));
        (0, vitest_1.expect)(review).toEqual(vitest_1.expect.arrayContaining([
            'runtime.search_tools',
            'runtime.require_tools',
            'runtime.invoke_tool',
            'runtime.request_tool_pack',
            'runtime.list_tool_packs',
            'chat.thread_summary',
            'chat.search',
        ]));
        (0, vitest_1.expect)(browserAutomation).toEqual(vitest_1.expect.arrayContaining([
            'runtime.search_tools',
            'runtime.require_tools',
            'runtime.invoke_tool',
            'runtime.request_tool_pack',
            'runtime.list_tool_packs',
            'browser.get_tabs',
            'browser.close_tab',
            'browser.navigate',
            'browser.click',
            'browser.type',
        ]));
        (0, vitest_1.expect)(general).toEqual(vitest_1.expect.arrayContaining([
            'runtime.search_tools',
            'runtime.require_tools',
            'runtime.invoke_tool',
            'runtime.request_tool_pack',
            'runtime.list_tool_packs',
            'chat.thread_summary',
            'chat.read_last',
        ]));
    });
    (0, vitest_1.it)('supports the unrestricted preset for comparison runs', () => {
        (0, vitest_1.expect)((0, toolPacks_1.resolveAllowedToolsForTaskKind)('debug', 'all')).toBe('all');
        (0, vitest_1.expect)((0, toolPacks_1.resolveAllowedToolsForTaskKind)('browser-search', 'all')).toBe('all');
    });
    (0, vitest_1.it)('searches the tool catalog and ranks exact missing tools first', () => {
        const matches = (0, toolPacks_1.searchToolCatalog)('close browser tabs', [
            { name: 'browser.close_tab', description: 'Close one browser tab' },
            { name: 'browser.get_tabs', description: 'List the currently open browser tabs' },
            { name: 'filesystem.read', description: 'Read a local file from disk' },
        ], {
            currentTools: [{ name: 'browser.get_tabs' }],
            limit: 3,
        });
        (0, vitest_1.expect)(matches.map((match) => match.name)).toEqual([
            'browser.close_tab',
            'browser.get_tabs',
        ]);
        (0, vitest_1.expect)(matches[0]?.bindingState).toBe('discoverable');
        (0, vitest_1.expect)(matches[0]?.callableNow).toBe(false);
        (0, vitest_1.expect)(matches[0]?.invokableNow).toBe(true);
        (0, vitest_1.expect)(matches[0]?.invocationMethod).toBe('runtime.invoke_tool');
        (0, vitest_1.expect)(matches[0]?.availableNextTurn).toBe(true);
        (0, vitest_1.expect)(matches[1]?.bindingState).toBe('callable');
        (0, vitest_1.expect)(matches[1]?.callableNow).toBe(true);
        (0, vitest_1.expect)(matches[1]?.invokableNow).toBe(true);
        (0, vitest_1.expect)(matches[1]?.invocationMethod).toBe('direct');
        (0, vitest_1.expect)(matches[1]?.availableNextTurn).toBe(false);
        (0, vitest_1.expect)(matches[0]?.relatedPackIds).toContain('browser-automation');
    });
    (0, vitest_1.it)('loads named expansion packs from manifests', () => {
        (0, vitest_1.expect)((0, toolPacks_1.getToolPack)('debug')).toEqual(vitest_1.expect.objectContaining({
            id: 'debug',
            tools: vitest_1.expect.arrayContaining(['browser.evaluate_js', 'terminal.exec']),
        }));
        (0, vitest_1.expect)((0, toolPacks_1.getToolPack)('terminal-heavy')).toEqual(vitest_1.expect.objectContaining({
            id: 'terminal-heavy',
            tools: vitest_1.expect.arrayContaining(['terminal.exec', 'terminal.spawn', 'terminal.kill']),
        }));
        (0, vitest_1.expect)((0, toolPacks_1.getToolPack)('browser-advanced')).toEqual(vitest_1.expect.objectContaining({
            id: 'browser-advanced',
            tools: vitest_1.expect.arrayContaining(['browser.upload_file', 'browser.get_console_events']),
        }));
        (0, vitest_1.expect)((0, toolPacks_1.getToolPack)('browser-advanced')?.tools).not.toContain('browser.evaluate_js');
        (0, vitest_1.expect)((0, toolPacks_1.getToolPack)('file-cache')).toEqual(vitest_1.expect.objectContaining({
            id: 'file-cache',
            tools: vitest_1.expect.arrayContaining(['filesystem.index_workspace', 'filesystem.search_file_cache']),
        }));
        (0, vitest_1.expect)((0, toolPacks_1.getToolPack)('browser-automation')).toEqual(vitest_1.expect.objectContaining({
            id: 'browser-automation',
            baseline6: vitest_1.expect.arrayContaining(['browser.get_tabs', 'browser.close_tab']),
        }));
        (0, vitest_1.expect)((0, toolPacks_1.getToolPack)('artifacts')).toEqual(vitest_1.expect.objectContaining({
            id: 'artifacts',
            tools: vitest_1.expect.arrayContaining(['artifact.create', 'artifact.delete', 'artifact.read', 'artifact.replace_content']),
        }));
        (0, vitest_1.expect)((0, toolPacks_1.getToolPack)('all-tools')).toEqual(vitest_1.expect.objectContaining({
            id: 'all-tools',
            scope: 'all',
        }));
    });
    (0, vitest_1.it)('suggests auto-expansion when the model says browser tools are missing', () => {
        const expansion = (0, toolPacks_1.resolveAutoExpandedToolPack)('I cannot continue because the current scope does not have browser tab tools.', [
            { name: 'runtime.request_tool_pack' },
            { name: 'runtime.list_tool_packs' },
            { name: 'browser.research_search' },
        ], [
            { name: 'runtime.request_tool_pack', description: '', inputSchema: {} },
            { name: 'runtime.list_tool_packs', description: '', inputSchema: {} },
            { name: 'browser.research_search', description: '', inputSchema: {} },
            { name: 'browser.get_tabs', description: '', inputSchema: {} },
            { name: 'browser.close_tab', description: '', inputSchema: {} },
        ]);
        (0, vitest_1.expect)(expansion).toEqual(vitest_1.expect.objectContaining({
            pack: 'browser-automation',
            tools: vitest_1.expect.arrayContaining(['browser.get_tabs', 'browser.close_tab']),
        }));
    });
    (0, vitest_1.it)('preflight-expands browser automation for tab-management requests before the first model turn', () => {
        const expansions = (0, toolPacks_1.resolvePreflightToolPackExpansions)('Close the extra browser tabs and keep the active page open.', [
            { name: 'runtime.request_tool_pack' },
            { name: 'runtime.list_tool_packs' },
        ], [
            { name: 'runtime.request_tool_pack', description: '', inputSchema: {} },
            { name: 'runtime.list_tool_packs', description: '', inputSchema: {} },
            { name: 'browser.get_tabs', description: '', inputSchema: {} },
            { name: 'browser.close_tab', description: '', inputSchema: {} },
            { name: 'browser.navigate', description: '', inputSchema: {} },
        ]);
        (0, vitest_1.expect)(expansions).toEqual([
            vitest_1.expect.objectContaining({
                pack: 'browser-automation',
                tools: vitest_1.expect.arrayContaining(['browser.get_tabs', 'browser.close_tab', 'browser.navigate']),
            }),
        ]);
    });
    (0, vitest_1.it)('preflight-expands browser automation when the prompt explicitly asks for new tabs and create_tab is missing', () => {
        const expansions = (0, toolPacks_1.resolvePreflightToolPackExpansions)('Open three new tabs one for yahoo one for reddit and one for gmail.', [
            { name: 'runtime.request_tool_pack' },
            { name: 'runtime.list_tool_packs' },
            { name: 'browser.get_state' },
            { name: 'browser.get_tabs' },
            { name: 'browser.close_tab' },
            { name: 'browser.navigate' },
            { name: 'browser.click' },
            { name: 'browser.type' },
        ], [
            { name: 'runtime.request_tool_pack', description: '', inputSchema: {} },
            { name: 'runtime.list_tool_packs', description: '', inputSchema: {} },
            { name: 'browser.get_state', description: '', inputSchema: {} },
            { name: 'browser.get_tabs', description: '', inputSchema: {} },
            { name: 'browser.close_tab', description: '', inputSchema: {} },
            { name: 'browser.navigate', description: '', inputSchema: {} },
            { name: 'browser.click', description: '', inputSchema: {} },
            { name: 'browser.type', description: '', inputSchema: {} },
            { name: 'browser.create_tab', description: '', inputSchema: {} },
            { name: 'browser.activate_tab', description: '', inputSchema: {} },
        ]);
        (0, vitest_1.expect)(expansions).toEqual([
            vitest_1.expect.objectContaining({
                pack: 'browser-automation',
                tools: vitest_1.expect.arrayContaining(['browser.create_tab', 'browser.activate_tab']),
            }),
        ]);
    });
    (0, vitest_1.it)('preflight-expands browser-advanced when the prompt asks for upload or browser diagnostics', () => {
        const expansions = (0, toolPacks_1.resolvePreflightToolPackExpansions)('Upload a file in the browser and inspect any console or network errors.', [
            { name: 'runtime.request_tool_pack' },
            { name: 'runtime.list_tool_packs' },
            { name: 'browser.get_state' },
            { name: 'browser.get_tabs' },
        ], [
            { name: 'runtime.request_tool_pack', description: '', inputSchema: {} },
            { name: 'runtime.list_tool_packs', description: '', inputSchema: {} },
            { name: 'browser.get_state', description: '', inputSchema: {} },
            { name: 'browser.get_tabs', description: '', inputSchema: {} },
            { name: 'browser.upload_file', description: '', inputSchema: {} },
            { name: 'browser.get_console_events', description: '', inputSchema: {} },
            { name: 'browser.get_network_events', description: '', inputSchema: {} },
        ]);
        (0, vitest_1.expect)(expansions).toEqual([
            vitest_1.expect.objectContaining({
                pack: 'browser-advanced',
                tools: vitest_1.expect.arrayContaining(['browser.upload_file', 'browser.get_console_events', 'browser.get_network_events']),
            }),
        ]);
    });
    (0, vitest_1.it)('preflight-expands file-cache when the prompt asks for indexed chunk search', () => {
        const expansions = (0, toolPacks_1.resolvePreflightToolPackExpansions)('Index the workspace, search the file cache, and read the matching chunk.', [
            { name: 'runtime.request_tool_pack' },
            { name: 'runtime.list_tool_packs' },
            { name: 'filesystem.list' },
            { name: 'filesystem.search' },
        ], [
            { name: 'runtime.request_tool_pack', description: '', inputSchema: {} },
            { name: 'runtime.list_tool_packs', description: '', inputSchema: {} },
            { name: 'filesystem.list', description: '', inputSchema: {} },
            { name: 'filesystem.search', description: '', inputSchema: {} },
            { name: 'filesystem.index_workspace', description: '', inputSchema: {} },
            { name: 'filesystem.search_file_cache', description: '', inputSchema: {} },
            { name: 'filesystem.read_file_chunk', description: '', inputSchema: {} },
        ]);
        (0, vitest_1.expect)(expansions).toEqual([
            vitest_1.expect.objectContaining({
                pack: 'file-cache',
                tools: vitest_1.expect.arrayContaining(['filesystem.index_workspace', 'filesystem.search_file_cache', 'filesystem.read_file_chunk']),
            }),
        ]);
    });
    (0, vitest_1.it)('preflight-expands file-cache for repo analysis prompts even without explicit cache wording', () => {
        const expansions = (0, toolPacks_1.resolvePreflightToolPackExpansions)('Inspect the codebase and review the Codex integration path for token-cost optimizations.', [
            { name: 'runtime.request_tool_pack' },
            { name: 'runtime.list_tool_packs' },
            { name: 'filesystem.search' },
            { name: 'filesystem.read' },
            { name: 'filesystem.patch' },
            { name: 'terminal.exec' },
        ], [
            { name: 'runtime.request_tool_pack', description: '', inputSchema: {} },
            { name: 'runtime.list_tool_packs', description: '', inputSchema: {} },
            { name: 'filesystem.search', description: '', inputSchema: {} },
            { name: 'filesystem.read', description: '', inputSchema: {} },
            { name: 'filesystem.patch', description: '', inputSchema: {} },
            { name: 'terminal.exec', description: '', inputSchema: {} },
            { name: 'filesystem.index_workspace', description: '', inputSchema: {} },
            { name: 'filesystem.answer_from_cache', description: '', inputSchema: {} },
            { name: 'filesystem.search_file_cache', description: '', inputSchema: {} },
            { name: 'filesystem.read_file_chunk', description: '', inputSchema: {} },
        ]);
        (0, vitest_1.expect)(expansions).toEqual([
            vitest_1.expect.objectContaining({
                pack: 'file-cache',
                tools: vitest_1.expect.arrayContaining([
                    'filesystem.index_workspace',
                    'filesystem.answer_from_cache',
                    'filesystem.search_file_cache',
                    'filesystem.read_file_chunk',
                ]),
            }),
        ]);
    });
    (0, vitest_1.it)('preflight-expands terminal-heavy when the prompt asks to stop or interact with a running process', () => {
        const expansions = (0, toolPacks_1.resolvePreflightToolPackExpansions)('Stop the dev server with Ctrl+C and answer any prompt it shows.', [
            { name: 'runtime.request_tool_pack' },
            { name: 'runtime.list_tool_packs' },
            { name: 'filesystem.search' },
            { name: 'filesystem.read' },
            { name: 'filesystem.patch' },
            { name: 'filesystem.write' },
            { name: 'terminal.exec' },
        ], [
            { name: 'runtime.request_tool_pack', description: '', inputSchema: {} },
            { name: 'runtime.list_tool_packs', description: '', inputSchema: {} },
            { name: 'filesystem.search', description: '', inputSchema: {} },
            { name: 'filesystem.read', description: '', inputSchema: {} },
            { name: 'filesystem.patch', description: '', inputSchema: {} },
            { name: 'filesystem.write', description: '', inputSchema: {} },
            { name: 'terminal.exec', description: '', inputSchema: {} },
            { name: 'terminal.spawn', description: '', inputSchema: {} },
            { name: 'terminal.write', description: '', inputSchema: {} },
            { name: 'terminal.kill', description: '', inputSchema: {} },
        ]);
        (0, vitest_1.expect)(expansions).toEqual([
            vitest_1.expect.objectContaining({
                pack: 'terminal-heavy',
                tools: vitest_1.expect.arrayContaining(['terminal.spawn', 'terminal.write', 'terminal.kill']),
            }),
        ]);
    });
    (0, vitest_1.it)('preflight-expands artifacts when the prompt asks for a managed markdown or csv artifact', () => {
        const expansions = (0, toolPacks_1.resolvePreflightToolPackExpansions)('Create a markdown artifact called Weekly Research Note and then append to this csv sheet.', [
            { name: 'runtime.request_tool_pack' },
            { name: 'runtime.list_tool_packs' },
            { name: 'filesystem.search' },
            { name: 'filesystem.read' },
        ], [
            { name: 'runtime.request_tool_pack', description: '', inputSchema: {} },
            { name: 'runtime.list_tool_packs', description: '', inputSchema: {} },
            { name: 'filesystem.search', description: '', inputSchema: {} },
            { name: 'filesystem.read', description: '', inputSchema: {} },
            { name: 'artifact.list', description: '', inputSchema: {} },
            { name: 'artifact.get', description: '', inputSchema: {} },
            { name: 'artifact.get_active', description: '', inputSchema: {} },
            { name: 'artifact.read', description: '', inputSchema: {} },
            { name: 'artifact.create', description: '', inputSchema: {} },
            { name: 'artifact.delete', description: '', inputSchema: {} },
            { name: 'artifact.replace_content', description: '', inputSchema: {} },
            { name: 'artifact.append_content', description: '', inputSchema: {} },
        ]);
        (0, vitest_1.expect)(expansions).toEqual([
            vitest_1.expect.objectContaining({
                pack: 'artifacts',
                tools: vitest_1.expect.arrayContaining([
                    'artifact.create',
                    'artifact.delete',
                    'artifact.read',
                    'artifact.replace_content',
                    'artifact.append_content',
                ]),
            }),
        ]);
    });
    (0, vitest_1.it)('preflight-expands chat recall when only thread_summary is present', () => {
        const expansions = (0, toolPacks_1.resolvePreflightToolPackExpansions)('Check the previous conversation and use the last message as context.', [
            { name: 'runtime.request_tool_pack' },
            { name: 'runtime.list_tool_packs' },
            { name: 'chat.thread_summary' },
        ], [
            { name: 'runtime.request_tool_pack', description: '', inputSchema: {} },
            { name: 'runtime.list_tool_packs', description: '', inputSchema: {} },
            { name: 'chat.thread_summary', description: '', inputSchema: {} },
            { name: 'chat.read_last', description: '', inputSchema: {} },
            { name: 'chat.search', description: '', inputSchema: {} },
            { name: 'chat.read_window', description: '', inputSchema: {} },
        ]);
        (0, vitest_1.expect)(expansions).toEqual([
            vitest_1.expect.objectContaining({
                pack: 'chat-recall',
                tools: vitest_1.expect.arrayContaining(['chat.read_last', 'chat.search', 'chat.read_window']),
            }),
        ]);
    });
});
//# sourceMappingURL=toolPacks.test.js.map