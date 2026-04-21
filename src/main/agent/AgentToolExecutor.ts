import { AgentToolContext, AgentToolDefinition, AgentToolName, AgentToolResult } from './AgentTypes';
import { agentRunStore } from './AgentRunStore';
import { agentCache, makeToolCacheKey } from './AgentCache';
import { validateToolResult } from './ConstraintValidator';
import { runWithBrowserOperationContext } from '../browser/browserOperationContext';

const CACHEABLE_TOOLS = new Set<AgentToolName>([
  'browser.tabs',
  'browser.extract_page',
  'browser.inspect_page',
  'browser.find_element',
  'browser.summarize_page',
  'browser.search_page_cache',
  'browser.read_cached_chunk',
  'browser.cache_inventory',
  'filesystem.list',
  'filesystem.glob',
  'filesystem.search',
  'filesystem.search_file_cache',
  'filesystem.read_file_chunk',
  'filesystem.cache_inventory',
  'filesystem.read',
]);

const DEFAULT_TOOL_TIMEOUT_MS = 180_000;

function cacheTtlForTool(name: AgentToolName): number {
  if (name.startsWith('browser.')) return 10_000;
  if (name.startsWith('filesystem.')) return 60_000;
  return 5_000;
}

function timeoutForTool(name: AgentToolName): number {
  if (name.startsWith('browser.')) return 180_000;
  return DEFAULT_TOOL_TIMEOUT_MS;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export class AgentToolExecutor {
  private tools = new Map<AgentToolName, AgentToolDefinition>();

  register(tool: AgentToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  registerMany(tools: AgentToolDefinition[]): void {
    for (const tool of tools) this.register(tool);
  }

  list(): AgentToolDefinition[] {
    return Array.from(this.tools.values());
  }

  async execute(name: AgentToolName, input: unknown, context: AgentToolContext): Promise<AgentToolResult> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Agent tool not registered: ${name}`);
    const cacheKey = makeToolCacheKey(name, input);
    if (CACHEABLE_TOOLS.has(name)) {
      const cached = agentCache.getToolResult<AgentToolResult>(cacheKey);
      if (cached) {
        return {
          ...cached,
          summary: `${cached.summary} (cached)`,
        };
      }
    }

    const record = agentRunStore.startToolCall({
      runId: context.runId,
      agentId: context.agentId,
      toolName: name,
      toolInput: input,
    });

    try {
      const executeTool = () => withTimeout(
        tool.execute(input, context),
        timeoutForTool(name),
        `Timed out while running tool ${name}`,
      );
      const result = name.startsWith('browser.')
        ? await runWithBrowserOperationContext({
            source: 'agent',
            taskId: context.taskId ?? null,
            agentId: context.agentId,
            runId: context.runId,
            contextId: context.contextId ?? null,
          }, executeTool)
        : await executeTool();

      // Post-execution deterministic constraint validation
      const validation = validateToolResult(name, result, input);
      if (validation) {
        result.validation = validation;
      }

      if (CACHEABLE_TOOLS.has(name)) {
        agentCache.setToolResult(cacheKey, result, cacheTtlForTool(name));
      }
      agentRunStore.finishToolCall(record.id, 'completed', result);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      agentRunStore.finishToolCall(record.id, 'failed', null, message);
      throw err;
    }
  }
}

export const agentToolExecutor = new AgentToolExecutor();
