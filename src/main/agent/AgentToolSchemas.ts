import { AgentToolDefinition, AgentToolName } from './AgentTypes';

export type AgentToolSchemaSummary = Pick<AgentToolDefinition, 'name' | 'description' | 'inputSchema'>;

function schema(name: AgentToolName, description: string, inputSchema: Record<string, unknown> = { type: 'object' }): AgentToolSchemaSummary {
  return { name, description, inputSchema };
}

export const UNRESTRICTED_DEV_TOOL_SCHEMAS: AgentToolSchemaSummary[] = [
  schema('browser.get_state', 'Return current browser state.'),
  schema('browser.get_tabs', 'Return open browser tabs.'),
  schema('browser.navigate', 'Navigate the active browser tab.', { type: 'object', required: ['url'], properties: { url: { type: 'string' } } }),
  schema('browser.search_web', 'Search the web in the owned browser.', { type: 'object', required: ['query'], properties: { query: { type: 'string' } } }),
  schema('browser.research_search', 'Run browser search, open/cache result pages sequentially, and stop when enough evidence is found.', { type: 'object', required: ['query'], properties: { query: { type: 'string' }, maxPages: { type: 'number' }, resultLimit: { type: 'number' }, stopWhenAnswerFound: { type: 'boolean' }, minEvidenceScore: { type: 'number' } } }),
  schema('browser.back', 'Go back in the active browser tab.'),
  schema('browser.forward', 'Go forward in the active browser tab.'),
  schema('browser.reload', 'Reload the active browser tab.'),
  schema('browser.create_tab', 'Create a browser tab.', { type: 'object', properties: { url: { type: 'string' } } }),
  schema('browser.close_tab', 'Close one or more browser tabs.', { type: 'object', properties: { tabId: { type: 'string' }, tabIds: { type: 'array', items: { type: 'string' } } } }),
  schema('browser.activate_tab', 'Activate a browser tab.', { type: 'object', required: ['tabId'], properties: { tabId: { type: 'string' } } }),
  schema('browser.click', 'Click a page element.', { type: 'object', required: ['selector'], properties: { selector: { type: 'string' }, tabId: { type: 'string' } } }),
  schema('browser.type', 'Type text into a page element.', { type: 'object', required: ['selector', 'text'], properties: { selector: { type: 'string' }, text: { type: 'string' }, tabId: { type: 'string' } } }),
  schema('browser.drag', 'Drag one page element onto another by selector using native input plus DOM drag/drop events.', { type: 'object', required: ['sourceSelector', 'targetSelector'], properties: { sourceSelector: { type: 'string' }, targetSelector: { type: 'string' }, tabId: { type: 'string' } } }),
  schema('browser.hit_test', 'Check whether a selector is the topmost clickable element at its center point.', { type: 'object', required: ['selector'], properties: { selector: { type: 'string' }, tabId: { type: 'string' } } }),
  schema('browser.get_console_events', 'Return recent browser console events for diagnostics.', { type: 'object', properties: { tabId: { type: 'string' }, since: { type: 'number' }, level: { type: 'string' }, limit: { type: 'number' } } }),
  schema('browser.get_network_events', 'Return recent browser network events for diagnostics.', { type: 'object', properties: { tabId: { type: 'string' }, since: { type: 'number' }, status: { type: 'string' }, failedOnly: { type: 'boolean' }, limit: { type: 'number' } } }),
  schema('browser.run_intent_program', 'Execute semantic Web Intent VM bytecode for login/drag-drop/cart/checkout/upload/extract/assert flows.', {
    type: 'object',
    required: ['instructions'],
    properties: {
      instructions: { type: 'array', items: { type: 'object' } },
      tabId: { type: 'string' },
      failFast: { type: 'boolean' },
    },
  }),
  schema('browser.extract_page', 'Extract readable page content from a tab.'),
  schema('browser.get_actionable_elements', 'Return actionable page elements.'),
  schema('browser.capture_snapshot', 'Capture a browser tab snapshot.'),
  schema('filesystem.list', 'List files and directories.'),
  schema('filesystem.search', 'Search filenames or file contents.'),
  schema('filesystem.read', 'Read a file.'),
  schema('filesystem.write', 'Write a file.'),
  schema('filesystem.patch', 'Patch a file.'),
  schema('filesystem.delete', 'Delete a file or directory.'),
  schema('filesystem.mkdir', 'Create a directory.'),
  schema('filesystem.move', 'Move or rename a file or directory.'),
  schema('terminal.exec', 'Execute a terminal command and wait for completion.'),
  schema('terminal.spawn', 'Start a long-running terminal process.'),
  schema('terminal.write', 'Write input to a running terminal process.'),
  schema('terminal.kill', 'Kill a running terminal process.'),
  schema('chat.thread_summary', 'Return the compact summary and index of the current chat thread.'),
  schema('chat.read_last', 'Read the last messages in the current chat thread.', { type: 'object', properties: { count: { type: 'number' }, maxChars: { type: 'number' }, role: { type: 'string' } } }),
  schema('chat.search', 'Search cached chat history by query and return snippets plus message ids.', { type: 'object', required: ['query'], properties: { query: { type: 'string' }, role: { type: 'string' }, includeTools: { type: 'boolean' }, limit: { type: 'number' }, maxSnippetChars: { type: 'number' } } }),
  schema('chat.read_message', 'Read one full cached chat message by message id.', { type: 'object', required: ['messageId'], properties: { messageId: { type: 'string' }, maxChars: { type: 'number' } } }),
  schema('chat.read_window', 'Read a bounded message window around a cached chat message id.', { type: 'object', properties: { messageId: { type: 'string' }, before: { type: 'number' }, after: { type: 'number' }, maxChars: { type: 'number' } } }),
  schema('chat.recall', 'Progressive chat memory recall using recent messages first and search/window reads when needed.', { type: 'object', required: ['query'], properties: { query: { type: 'string' }, intent: { type: 'string' }, maxChars: { type: 'number' } } }),
  schema('chat.cache_stats', 'Return chat cache size and token estimates for the current task.'),
  schema('subagent.spawn', 'Spawn a runtime-managed child agent.'),
  schema('subagent.message', 'Send a message to an existing child agent.'),
  schema('subagent.wait', 'Wait for a child agent result.'),
  schema('subagent.cancel', 'Cancel a child agent.'),
  schema('subagent.list', 'List child agents.'),
];
