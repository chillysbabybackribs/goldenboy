import * as crypto from 'crypto';
import type { GeminiContent, GeminiFunctionDeclaration } from './GeminiClient';

type GeminiPromptCacheEntry = {
  key: string;
  cacheName: string;
  modelId: string;
  expiresAt: number;
};

const DEFAULT_CACHE_TTL_MS = 30 * 60 * 1000;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

export function hashGeminiPromptPrefix(input: {
  modelId: string;
  systemPrompt?: string;
  tools?: GeminiFunctionDeclaration[];
  contents?: GeminiContent[];
}): string {
  const serialized = stableStringify({
    modelId: input.modelId,
    systemPrompt: input.systemPrompt || '',
    tools: input.tools || [],
    contents: input.contents || [],
  });
  return crypto.createHash('sha1').update(serialized).digest('hex');
}

export function estimateGeminiPromptPrefixSize(input: {
  systemPrompt?: string;
  tools?: GeminiFunctionDeclaration[];
  contents?: GeminiContent[];
}): number {
  return (input.systemPrompt || '').length
    + stableStringify(input.tools || []).length
    + stableStringify(input.contents || []).length;
}

export class GeminiPromptCache {
  private readonly entries = new Map<string, GeminiPromptCacheEntry>();

  get(key: string): GeminiPromptCacheEntry | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry;
  }

  set(input: {
    key: string;
    cacheName: string;
    modelId: string;
    ttlMs?: number;
  }): GeminiPromptCacheEntry {
    const entry: GeminiPromptCacheEntry = {
      key: input.key,
      cacheName: input.cacheName,
      modelId: input.modelId,
      expiresAt: Date.now() + (input.ttlMs ?? DEFAULT_CACHE_TTL_MS),
    };
    this.entries.set(input.key, entry);
    return entry;
  }

  delete(key: string): void {
    this.entries.delete(key);
  }
}

export const geminiPromptCache = new GeminiPromptCache();
