import { describe, expect, it } from 'vitest';
import {
  AgentToolBindingStore,
  createToolBindings,
  createToolBindingStore,
  listCallableTools,
  promoteQueuedBindings,
  queueExpandedBindings,
} from './toolBindingScope';

describe('toolBindingScope', () => {
  const catalog = [
    { name: 'runtime.search_tools', description: 'Search tools', inputSchema: {} },
    { name: 'browser.close_tab', description: 'Close a browser tab', inputSchema: {} },
    { name: 'browser.get_tabs', description: 'List browser tabs', inputSchema: {} },
  ] as const;

  it('keeps newly expanded tools out of the callable set until promotion', () => {
    const initial = createToolBindings([catalog[0]]);
    const queued = queueExpandedBindings(initial, [...catalog], ['browser.close_tab']);

    expect(listCallableTools(queued).map((tool) => tool.name)).toEqual(['runtime.search_tools']);
    expect(queued.find((binding) => binding.name === 'browser.close_tab')?.state).toBe('queued_next_turn');

    const promoted = promoteQueuedBindings(queued);
    expect(listCallableTools(promoted).map((tool) => tool.name)).toEqual([
      'runtime.search_tools',
      'browser.close_tab',
    ]);
  });

  it('does not duplicate already callable tools when queueing an expansion', () => {
    const initial = createToolBindings([catalog[0], catalog[1]]);
    const queued = queueExpandedBindings(initial, [...catalog], ['browser.close_tab', 'browser.get_tabs']);

    expect(queued.filter((binding) => binding.name === 'browser.close_tab')).toHaveLength(1);
    expect(queued.find((binding) => binding.name === 'browser.close_tab')?.state).toBe('callable');
    expect(queued.find((binding) => binding.name === 'browser.get_tabs')?.state).toBe('queued_next_turn');
  });

  it('promotes queued tools only when a new turn begins in the binding store', () => {
    const store = createToolBindingStore([catalog[0]], [...catalog]);
    expect(store.beginTurn().map((tool) => tool.name)).toEqual(['runtime.search_tools']);

    store.queueTools(['browser.close_tab']);
    expect(store.getCallableTools().map((tool) => tool.name)).toEqual(['runtime.search_tools']);

    expect(store.beginTurn().map((tool) => tool.name)).toEqual([
      'runtime.search_tools',
      'browser.close_tab',
    ]);
  });

  it('can restore a binding store from explicit binding state', () => {
    const store = AgentToolBindingStore.fromBindings([
      { ...catalog[0], state: 'callable' },
      { ...catalog[1], state: 'queued_next_turn' },
    ], [...catalog]);

    expect(store.getCallableTools().map((tool) => tool.name)).toEqual(['runtime.search_tools']);
    expect(store.beginTurn().map((tool) => tool.name)).toEqual([
      'runtime.search_tools',
      'browser.close_tab',
    ]);
  });
});
