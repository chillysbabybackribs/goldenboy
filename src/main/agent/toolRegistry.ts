import type { AgentToolDefinition, AgentToolName } from './AgentTypes';

export type ToolRegistryEntry = {
  name: AgentToolName;
  family: string;
  summary: string;
  description: string;
  tags: string[];
  loaded: boolean;
};

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'by',
  'for',
  'from',
  'in',
  'into',
  'of',
  'on',
  'or',
  'the',
  'to',
  'use',
  'with',
]);

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function firstSentence(description: string): string {
  const trimmed = description.trim();
  if (!trimmed) return '';
  const firstLine = trimmed.split('\n')[0]?.trim() ?? '';
  if (!firstLine) return trimmed;
  return firstLine;
}

function buildTags(tool: Pick<AgentToolDefinition, 'name' | 'description'>): string[] {
  const nameTokens = tokenize(tool.name.replace(/\./g, ' '));
  const descriptionTokens = tokenize(tool.description);
  return Array.from(new Set([...nameTokens, ...descriptionTokens])).slice(0, 16);
}

export function buildToolRegistryEntries(
  tools: Array<Pick<AgentToolDefinition, 'name' | 'description'>>,
  loadedToolNames: string[] = [],
): ToolRegistryEntry[] {
  const loaded = new Set(loadedToolNames);
  return tools
    .map((tool) => ({
      name: tool.name,
      family: tool.name.split('.')[0] ?? 'other',
      summary: firstSentence(tool.description),
      description: tool.description,
      tags: buildTags(tool),
      loaded: loaded.has(tool.name),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function scoreEntry(entry: ToolRegistryEntry, query: string): number {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return 0;

  let score = 0;
  if (entry.name === normalizedQuery) score += 100;
  if (entry.name.includes(normalizedQuery)) score += 40;
  if (entry.family === normalizedQuery) score += 30;

  const haystack = `${entry.name} ${entry.family} ${entry.summary} ${entry.tags.join(' ')}`.toLowerCase();
  for (const token of tokenize(query)) {
    if (entry.name.toLowerCase().includes(token)) score += 12;
    if (entry.family.toLowerCase() === token) score += 10;
    if (entry.tags.includes(token)) score += 6;
    if (haystack.includes(token)) score += 3;
  }

  if (entry.loaded) score += 1;
  return score;
}

export function searchToolRegistry(
  tools: Array<Pick<AgentToolDefinition, 'name' | 'description'>>,
  query: string,
  loadedToolNames: string[] = [],
  limit = 8,
): ToolRegistryEntry[] {
  return buildToolRegistryEntries(tools, loadedToolNames)
    .map((entry) => ({ entry, score: scoreEntry(entry, query) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.entry.name.localeCompare(right.entry.name);
    })
    .slice(0, Math.max(1, limit))
    .map((candidate) => candidate.entry);
}
