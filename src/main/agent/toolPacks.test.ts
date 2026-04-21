import { describe, expect, it } from 'vitest';
import { resolveAllowedToolsForTaskKind } from './toolPacks';

describe('resolveAllowedToolsForTaskKind', () => {
  it('always includes list_loaded_tools in every scoped baseline', () => {
    const kinds = ['research', 'browser-automation', 'implementation', 'debug', 'review', 'orchestration', 'general'] as const;
    for (const kind of kinds) {
      const tools = resolveAllowedToolsForTaskKind(kind, 'mode-6');
      expect(tools).not.toBe('all');
      expect(tools).toContain('runtime.list_loaded_tools');
    }
  });

  it('gives discovery tools to every scoped baseline', () => {
    const kinds = ['research', 'browser-automation', 'implementation', 'debug', 'review', 'orchestration', 'general'] as const;
    for (const kind of kinds) {
      const tools = resolveAllowedToolsForTaskKind(kind, 'mode-6');
      expect(tools).toContain('runtime.search_tools');
      expect(tools).toContain('runtime.load_tools');
    }
  });

  it('returns all for the unrestricted preset', () => {
    expect(resolveAllowedToolsForTaskKind('debug', 'all')).toBe('all');
    expect(resolveAllowedToolsForTaskKind('research', 'all')).toBe('all');
  });

  it('mode-4 baselines are a strict subset of mode-6 baselines', () => {
    const kinds = ['research', 'browser-automation', 'implementation', 'debug', 'review', 'orchestration', 'general'] as const;
    for (const kind of kinds) {
      const mode4 = resolveAllowedToolsForTaskKind(kind, 'mode-4') as string[];
      const mode6 = resolveAllowedToolsForTaskKind(kind, 'mode-6') as string[];
      expect(mode4.length).toBeLessThanOrEqual(mode6.length);
      for (const tool of mode4) {
        expect(mode6).toContain(tool);
      }
    }
  });

  it('research baseline contains browser search and cache tools', () => {
    const tools = resolveAllowedToolsForTaskKind('research', 'mode-6');
    expect(tools).toEqual(expect.arrayContaining([
      'browser.research_search',
      'browser.search_page_cache',
      'browser.read_cached_chunk',
      'browser.answer_from_cache',
      'browser.extract_page',
    ]));
  });

  it('browser-automation baseline contains core navigation and interaction tools', () => {
    const tools = resolveAllowedToolsForTaskKind('browser-automation', 'mode-6');
    expect(tools).toEqual(expect.arrayContaining([
      'browser.get_state',
      'browser.get_tabs',
      'browser.navigate',
      'browser.click',
      'browser.type',
    ]));
  });

  it('implementation baseline contains file and terminal tools', () => {
    const tools = resolveAllowedToolsForTaskKind('implementation', 'mode-6');
    expect(tools).toEqual(expect.arrayContaining([
      'filesystem.search',
      'filesystem.read',
      'filesystem.patch',
      'filesystem.write',
      'terminal.exec',
    ]));
  });

  it('orchestration baseline contains subagent tools', () => {
    const tools = resolveAllowedToolsForTaskKind('orchestration', 'mode-6');
    expect(tools).toEqual(expect.arrayContaining([
      'subagent.spawn',
      'subagent.wait',
      'subagent.list',
    ]));
  });

  it('normalizes legacy kind aliases', () => {
    expect(resolveAllowedToolsForTaskKind('delegation', 'mode-6')).toEqual(
      resolveAllowedToolsForTaskKind('orchestration', 'mode-6'),
    );
    expect(resolveAllowedToolsForTaskKind('browser-search', 'mode-6')).toEqual(
      resolveAllowedToolsForTaskKind('research', 'mode-6'),
    );
    expect(resolveAllowedToolsForTaskKind('local-code', 'mode-6')).toEqual(
      resolveAllowedToolsForTaskKind('implementation', 'mode-6'),
    );
  });

  it('returns no duplicates in any baseline', () => {
    const kinds = ['research', 'browser-automation', 'implementation', 'debug', 'review', 'orchestration', 'general'] as const;
    for (const kind of kinds) {
      const tools = resolveAllowedToolsForTaskKind(kind, 'mode-6') as string[];
      expect(tools.length).toBe(new Set(tools).size);
    }
  });
});
