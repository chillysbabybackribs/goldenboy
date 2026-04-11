import { AgentToolName } from './AgentTypes';

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const DEFAULT_TTL_MS = 30_000;

export class AgentCache {
  private toolResults = new Map<string, CacheEntry<unknown>>();

  getToolResult<T>(key: string): T | null {
    const entry = this.toolResults.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.toolResults.delete(key);
      return null;
    }
    return entry.value as T;
  }

  setToolResult<T>(key: string, value: T, ttlMs: number = DEFAULT_TTL_MS): void {
    this.toolResults.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  clear(): void {
    this.toolResults.clear();
  }
}

export function makeToolCacheKey(name: AgentToolName, input: unknown): string {
  return `${name}:${stableStringify(input)}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

export const agentCache = new AgentCache();
