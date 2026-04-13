import * as fs from 'fs';
import * as path from 'path';
import { AgentToolName } from './AgentTypes';
import { APP_WORKSPACE_ROOT } from '../workspaceRoot';

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

  invalidateByToolPrefix(prefix: string): void {
    for (const key of this.toolResults.keys()) {
      if (key.startsWith(prefix)) {
        this.toolResults.delete(key);
      }
    }
  }

  clear(): void {
    this.toolResults.clear();
  }
}

export function makeToolCacheKey(name: AgentToolName, input: unknown): string {
  const freshness = cacheFreshnessKey(name, input);
  return freshness
    ? `${name}:${freshness}:${stableStringify(input)}`
    : `${name}:${stableStringify(input)}`;
}

function cacheFreshnessKey(name: AgentToolName, input: unknown): string | null {
  if (name !== 'filesystem.read') return null;
  const obj = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  if (typeof obj.path !== 'string' || obj.path.trim() === '') return null;
  const resolved = path.resolve(APP_WORKSPACE_ROOT, obj.path);
  try {
    const stat = fs.statSync(resolved);
    return `${resolved}:${stat.size}:${stat.mtimeMs}`;
  } catch {
    return `${resolved}:missing`;
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

export const agentCache = new AgentCache();
