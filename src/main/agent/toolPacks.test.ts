import { describe, expect, it } from 'vitest';
import {
  getToolPack,
  resolveAllowedToolsForTaskKind,
  resolveAutoExpandedToolPack,
  resolvePreflightToolPackExpansions,
} from './toolPacks';

describe('tool packs', () => {
  it('returns exact four-tool packs for the minimal preset', () => {
    const research = resolveAllowedToolsForTaskKind('research', 'mode-4');
    const orchestration = resolveAllowedToolsForTaskKind('orchestration', 'mode-4');

    expect(research).not.toBe('all');
    expect(orchestration).not.toBe('all');
    expect(research).toHaveLength(5);
    expect(orchestration).toHaveLength(5);
    expect(research).toEqual(expect.arrayContaining([
      'runtime.request_tool_pack',
      'runtime.list_tool_packs',
      'browser.research_search',
      'browser.search_page_cache',
    ]));
    expect(orchestration).toEqual(expect.arrayContaining([
      'runtime.request_tool_pack',
      'runtime.list_tool_packs',
      'subagent.spawn',
      'subagent.wait',
    ]));
  });

  it('returns exact six-tool packs for the default preset', () => {
    const implementation = resolveAllowedToolsForTaskKind('implementation', 'mode-6');
    const review = resolveAllowedToolsForTaskKind('review', 'mode-6');
    const browserAutomation = resolveAllowedToolsForTaskKind('browser-automation', 'mode-6');

    expect(implementation).not.toBe('all');
    expect(review).not.toBe('all');
    expect(browserAutomation).not.toBe('all');
    expect(implementation).toHaveLength(7);
    expect(review).toHaveLength(7);
    expect(browserAutomation).toHaveLength(8);
    expect(implementation).toEqual(expect.arrayContaining([
      'runtime.request_tool_pack',
      'runtime.list_tool_packs',
      'filesystem.patch',
      'filesystem.write',
      'terminal.exec',
    ]));
    expect(review).toEqual(expect.arrayContaining([
      'runtime.request_tool_pack',
      'runtime.list_tool_packs',
      'chat.thread_summary',
      'chat.search',
    ]));
    expect(browserAutomation).toEqual(expect.arrayContaining([
      'runtime.request_tool_pack',
      'runtime.list_tool_packs',
      'browser.get_tabs',
      'browser.close_tab',
      'browser.navigate',
      'browser.click',
      'browser.type',
    ]));
  });

  it('supports the unrestricted preset for comparison runs', () => {
    expect(resolveAllowedToolsForTaskKind('debug', 'all')).toBe('all');
    expect(resolveAllowedToolsForTaskKind('browser-search', 'all')).toBe('all');
  });

  it('loads named expansion packs from manifests', () => {
    expect(getToolPack('terminal-heavy')).toEqual(expect.objectContaining({
      id: 'terminal-heavy',
      tools: expect.arrayContaining(['terminal.exec', 'terminal.spawn', 'terminal.kill']),
    }));
    expect(getToolPack('browser-advanced')).toEqual(expect.objectContaining({
      id: 'browser-advanced',
      tools: expect.arrayContaining(['browser.upload_file', 'browser.get_console_events']),
    }));
    expect(getToolPack('file-cache')).toEqual(expect.objectContaining({
      id: 'file-cache',
      tools: expect.arrayContaining(['filesystem.index_workspace', 'filesystem.search_file_cache']),
    }));
    expect(getToolPack('browser-automation')).toEqual(expect.objectContaining({
      id: 'browser-automation',
      baseline6: expect.arrayContaining(['browser.get_tabs', 'browser.close_tab']),
    }));
    expect(getToolPack('all-tools')).toEqual(expect.objectContaining({
      id: 'all-tools',
      scope: 'all',
    }));
  });

  it('suggests auto-expansion when the model says browser tools are missing', () => {
    const expansion = resolveAutoExpandedToolPack(
      'I cannot continue because the current scope does not have browser tab tools.',
      [
        { name: 'runtime.request_tool_pack' },
        { name: 'runtime.list_tool_packs' },
        { name: 'browser.research_search' },
      ],
      [
        { name: 'runtime.request_tool_pack', description: '', inputSchema: {} },
        { name: 'runtime.list_tool_packs', description: '', inputSchema: {} },
        { name: 'browser.research_search', description: '', inputSchema: {} },
        { name: 'browser.get_tabs', description: '', inputSchema: {} },
        { name: 'browser.close_tab', description: '', inputSchema: {} },
      ],
    );

    expect(expansion).toEqual(expect.objectContaining({
      pack: 'browser-automation',
      tools: expect.arrayContaining(['browser.get_tabs', 'browser.close_tab']),
    }));
  });

  it('preflight-expands browser automation for tab-management requests before the first model turn', () => {
    const expansions = resolvePreflightToolPackExpansions(
      'Close the extra browser tabs and keep the active page open.',
      [
        { name: 'runtime.request_tool_pack' },
        { name: 'runtime.list_tool_packs' },
      ],
      [
        { name: 'runtime.request_tool_pack', description: '', inputSchema: {} },
        { name: 'runtime.list_tool_packs', description: '', inputSchema: {} },
        { name: 'browser.get_tabs', description: '', inputSchema: {} },
        { name: 'browser.close_tab', description: '', inputSchema: {} },
        { name: 'browser.navigate', description: '', inputSchema: {} },
      ],
    );

    expect(expansions).toEqual([
      expect.objectContaining({
        pack: 'browser-automation',
        tools: expect.arrayContaining(['browser.get_tabs', 'browser.close_tab', 'browser.navigate']),
      }),
    ]);
  });

  it('preflight-expands browser automation when the prompt explicitly asks for new tabs and create_tab is missing', () => {
    const expansions = resolvePreflightToolPackExpansions(
      'Open three new tabs one for yahoo one for reddit and one for gmail.',
      [
        { name: 'runtime.request_tool_pack' },
        { name: 'runtime.list_tool_packs' },
        { name: 'browser.get_state' },
        { name: 'browser.get_tabs' },
        { name: 'browser.close_tab' },
        { name: 'browser.navigate' },
        { name: 'browser.click' },
        { name: 'browser.type' },
      ],
      [
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
      ],
    );

    expect(expansions).toEqual([
      expect.objectContaining({
        pack: 'browser-automation',
        tools: expect.arrayContaining(['browser.create_tab', 'browser.activate_tab']),
      }),
    ]);
  });

  it('preflight-expands browser-advanced when the prompt asks for upload or browser diagnostics', () => {
    const expansions = resolvePreflightToolPackExpansions(
      'Upload a file in the browser and inspect any console or network errors.',
      [
        { name: 'runtime.request_tool_pack' },
        { name: 'runtime.list_tool_packs' },
        { name: 'browser.get_state' },
        { name: 'browser.get_tabs' },
      ],
      [
        { name: 'runtime.request_tool_pack', description: '', inputSchema: {} },
        { name: 'runtime.list_tool_packs', description: '', inputSchema: {} },
        { name: 'browser.get_state', description: '', inputSchema: {} },
        { name: 'browser.get_tabs', description: '', inputSchema: {} },
        { name: 'browser.upload_file', description: '', inputSchema: {} },
        { name: 'browser.get_console_events', description: '', inputSchema: {} },
        { name: 'browser.get_network_events', description: '', inputSchema: {} },
      ],
    );

    expect(expansions).toEqual([
      expect.objectContaining({
        pack: 'browser-advanced',
        tools: expect.arrayContaining(['browser.upload_file', 'browser.get_console_events', 'browser.get_network_events']),
      }),
    ]);
  });

  it('preflight-expands file-cache when the prompt asks for indexed chunk search', () => {
    const expansions = resolvePreflightToolPackExpansions(
      'Index the workspace, search the file cache, and read the matching chunk.',
      [
        { name: 'runtime.request_tool_pack' },
        { name: 'runtime.list_tool_packs' },
        { name: 'filesystem.list' },
        { name: 'filesystem.search' },
      ],
      [
        { name: 'runtime.request_tool_pack', description: '', inputSchema: {} },
        { name: 'runtime.list_tool_packs', description: '', inputSchema: {} },
        { name: 'filesystem.list', description: '', inputSchema: {} },
        { name: 'filesystem.search', description: '', inputSchema: {} },
        { name: 'filesystem.index_workspace', description: '', inputSchema: {} },
        { name: 'filesystem.search_file_cache', description: '', inputSchema: {} },
        { name: 'filesystem.read_file_chunk', description: '', inputSchema: {} },
      ],
    );

    expect(expansions).toEqual([
      expect.objectContaining({
        pack: 'file-cache',
        tools: expect.arrayContaining(['filesystem.index_workspace', 'filesystem.search_file_cache', 'filesystem.read_file_chunk']),
      }),
    ]);
  });

  it('preflight-expands terminal-heavy when the prompt asks to stop or interact with a running process', () => {
    const expansions = resolvePreflightToolPackExpansions(
      'Stop the dev server with Ctrl+C and answer any prompt it shows.',
      [
        { name: 'runtime.request_tool_pack' },
        { name: 'runtime.list_tool_packs' },
        { name: 'filesystem.search' },
        { name: 'filesystem.read' },
        { name: 'filesystem.patch' },
        { name: 'filesystem.write' },
        { name: 'terminal.exec' },
      ],
      [
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
      ],
    );

    expect(expansions).toEqual([
      expect.objectContaining({
        pack: 'terminal-heavy',
        tools: expect.arrayContaining(['terminal.spawn', 'terminal.write', 'terminal.kill']),
      }),
    ]);
  });
});
