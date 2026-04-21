import type { AgentToolName } from './AgentTypes';
import type { AgentTaskKind, AgentToolScopePreset } from '../../shared/types/model';

export const DEFAULT_TOOL_SCOPE_PRESET: AgentToolScopePreset = 'mode-6';

export const RUNTIME_SEARCH_TOOLS_TOOL_NAME = 'runtime.search_tools' as const;
export const RUNTIME_LOAD_TOOLS_TOOL_NAME = 'runtime.load_tools' as const;
export const RUNTIME_LIST_LOADED_TOOLS_TOOL_NAME = 'runtime.list_loaded_tools' as const;

// Always included: introspection plus exact-search/exact-load discovery.
// This lets providers expand scope mid-task without starting from an "open-ended"
// task kind, while still keeping the domain baseline itself small.
const RUNTIME_TOOLS_ALWAYS: AgentToolName[] = [
  RUNTIME_LIST_LOADED_TOOLS_TOOL_NAME,
  RUNTIME_SEARCH_TOOLS_TOOL_NAME,
  RUNTIME_LOAD_TOOLS_TOOL_NAME,
];

// Fixed baselines per task kind. Small enough to keep context lean; the model
// uses runtime.search_tools + runtime.load_tools to pull in anything else it needs.
const BASELINES: Record<string, { mode4: AgentToolName[]; mode6: AgentToolName[] }> = {
  research: {
    mode4: [
      'browser.research_search',
      'browser.search_page_cache',
      'browser.read_cached_chunk',
    ],
    mode6: [
      'browser.research_search',
      'browser.search_page_cache',
      'browser.read_cached_chunk',
      'browser.answer_from_cache',
      'browser.extract_page',
    ],
  },
  'browser-automation': {
    mode4: [
      'browser.get_state',
      'browser.get_tabs',
      'browser.close_tab',
      'browser.navigate',
    ],
    mode6: [
      'browser.get_state',
      'browser.get_tabs',
      'browser.close_tab',
      'browser.navigate',
      'browser.click',
      'browser.type',
    ],
  },
  implementation: {
    mode4: [
      'filesystem.search',
      'filesystem.read',
      'filesystem.patch',
    ],
    mode6: [
      'filesystem.search',
      'filesystem.read',
      'filesystem.patch',
      'filesystem.write',
      'terminal.exec',
    ],
  },
  debug: {
    mode4: [
      'filesystem.search',
      'filesystem.read',
      'terminal.exec',
    ],
    mode6: [
      'filesystem.search',
      'filesystem.read',
      'filesystem.patch',
      'terminal.exec',
      'terminal.spawn',
    ],
  },
  review: {
    mode4: [
      'filesystem.search',
      'filesystem.read',
      'chat.thread_summary',
    ],
    mode6: [
      'filesystem.search',
      'filesystem.read',
      'filesystem.list',
      'chat.thread_summary',
      'chat.search',
    ],
  },
  orchestration: {
    mode4: [
      'subagent.spawn',
      'subagent.wait',
      'filesystem.read',
    ],
    mode6: [
      'subagent.spawn',
      'subagent.wait',
      'subagent.list',
      'filesystem.search',
      'filesystem.read',
    ],
  },
  general: {
    mode4: [
      'filesystem.read',
      'terminal.exec',
      'chat.thread_summary',
    ],
    mode6: [
      'filesystem.search',
      'filesystem.read',
      'filesystem.patch',
      'terminal.exec',
      'chat.thread_summary',
      'chat.read_last',
    ],
  },
};

function normalizeKind(kind: AgentTaskKind): string {
  switch (kind) {
    case 'delegation': return 'orchestration';
    case 'browser-search': return 'research';
    case 'local-code': return 'implementation';
    default: return kind;
  }
}

export function resolveAllowedToolsForTaskKind(
  kind: AgentTaskKind,
  preset: AgentToolScopePreset = DEFAULT_TOOL_SCOPE_PRESET,
): 'all' | AgentToolName[] {
  if (preset === 'all') return 'all';
  const normalizedKind = normalizeKind(kind);
  const baseline = BASELINES[normalizedKind] ?? BASELINES['general'];
  const domain = preset === 'mode-4' ? baseline.mode4 : baseline.mode6;
  
  return Array.from(new Set([...RUNTIME_TOOLS_ALWAYS, ...domain]));
}
