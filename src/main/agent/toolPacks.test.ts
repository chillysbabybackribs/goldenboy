import { describe, expect, it } from 'vitest';
import { getToolPack, resolveAllowedToolsForTaskKind } from './toolPacks';

describe('tool packs', () => {
  it('returns exact four-tool packs for the minimal preset', () => {
    const research = resolveAllowedToolsForTaskKind('research', 'mode-4');
    const orchestration = resolveAllowedToolsForTaskKind('orchestration', 'mode-4');

    expect(research).not.toBe('all');
    expect(orchestration).not.toBe('all');
    expect(research).toHaveLength(4);
    expect(orchestration).toHaveLength(4);
    expect(research).toEqual(expect.arrayContaining([
      'runtime.request_tool_pack',
      'browser.research_search',
      'browser.search_page_cache',
    ]));
    expect(orchestration).toEqual(expect.arrayContaining([
      'runtime.request_tool_pack',
      'subagent.spawn',
      'subagent.wait',
    ]));
  });

  it('returns exact six-tool packs for the default preset', () => {
    const implementation = resolveAllowedToolsForTaskKind('implementation', 'mode-6');
    const review = resolveAllowedToolsForTaskKind('review', 'mode-6');

    expect(implementation).not.toBe('all');
    expect(review).not.toBe('all');
    expect(implementation).toHaveLength(6);
    expect(review).toHaveLength(6);
    expect(implementation).toEqual(expect.arrayContaining([
      'runtime.request_tool_pack',
      'filesystem.patch',
      'filesystem.write',
      'terminal.exec',
    ]));
    expect(review).toEqual(expect.arrayContaining([
      'runtime.request_tool_pack',
      'chat.thread_summary',
      'chat.search',
    ]));
  });

  it('supports the unrestricted preset for comparison runs', () => {
    expect(resolveAllowedToolsForTaskKind('debug', 'all')).toBe('all');
    expect(resolveAllowedToolsForTaskKind('browser-search', 'all')).toBe('all');
  });

  it('loads named expansion packs from manifests', () => {
    expect(getToolPack('terminal-heavy')).toEqual(expect.objectContaining({
      id: 'terminal-heavy',
      tools: expect.arrayContaining(['terminal.exec', 'terminal.spawn']),
    }));
    expect(getToolPack('all-tools')).toEqual(expect.objectContaining({
      id: 'all-tools',
      scope: 'all',
    }));
  });
});
