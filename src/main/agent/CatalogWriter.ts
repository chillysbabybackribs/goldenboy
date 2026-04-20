import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { AgentToolDefinition } from './AgentTypes';

export type CatalogEntry = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  jsCall: string;
  tokenEstimate: number;
};

export type CatalogChunkMeta = {
  file: string;
  category: string;
  toolCount: number;
  signature: string;
  tokenEstimate: number;
};

export type CatalogManifest = {
  version: number;
  writtenAt: number;
  catalogDir: string;
  chunks: CatalogChunkMeta[];
};

function catalogDir(): string {
  return path.join(app.getPath('userData'), 'tool-catalog');
}

function manifestPath(): string {
  return path.join(catalogDir(), 'catalog-manifest.json');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(k => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(',')}}`;
}

function signatureFor(tools: AgentToolDefinition[]): string {
  const input = [...tools].sort((a, b) => a.name.localeCompare(b.name))
    .map(t => `${t.name}::${t.description}::${stableStringify(t.inputSchema)}`).join('||');
  return crypto.createHash('sha1').update(input).digest('hex');
}

function tokenEstimate(tool: AgentToolDefinition): number {
  return Math.ceil((tool.name.length + tool.description.length + stableStringify(tool.inputSchema).length) / 4);
}

function categoryFor(toolName: string): string {
  const prefix = toolName.split('.')[0];
  return prefix ?? 'unknown';
}

function loadManifest(): CatalogManifest | null {
  try {
    const p = manifestPath();
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as CatalogManifest;
  } catch {
    return null;
  }
}

/** Writes the tool catalog to disk. May throw if the catalog directory is not writable. */
export function writeCatalog(tools: AgentToolDefinition[]): CatalogManifest {
  const dir = catalogDir();
  fs.mkdirSync(dir, { recursive: true });

  const grouped = new Map<string, AgentToolDefinition[]>();
  for (const tool of tools) {
    const cat = categoryFor(tool.name);
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(tool);
  }

  const existing = loadManifest();
  const existingByCategory = new Map<string, CatalogChunkMeta>(
    existing?.chunks.map(c => [c.category, c]) ?? [],
  );

  const chunks: CatalogChunkMeta[] = [];

  for (const [category, categoryTools] of grouped) {
    const sig = signatureFor(categoryTools);
    const existingChunk = existingByCategory.get(category);

    if (existingChunk && existingChunk.signature === sig) {
      chunks.push(existingChunk);
      continue;
    }

    const entries: CatalogEntry[] = categoryTools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown>,
      jsCall: `window.tools.${category}.${tool.name.split('.').slice(1).join('.') || tool.name}`,
      tokenEstimate: tokenEstimate(tool),
    }));

    const chunkFile = `catalog-${category}.json`;
    fs.writeFileSync(path.join(dir, chunkFile), JSON.stringify(entries, null, 2), 'utf-8');

    const totalTokens = entries.reduce((sum, e) => sum + e.tokenEstimate, 0);
    chunks.push({
      file: chunkFile,
      category,
      toolCount: entries.length,
      signature: sig,
      tokenEstimate: totalTokens,
    });
  }

  const manifest: CatalogManifest = {
    version: 1,
    writtenAt: Date.now(),
    catalogDir: dir,
    chunks,
  };

  fs.writeFileSync(manifestPath(), JSON.stringify(manifest, null, 2), 'utf-8');
  return manifest;
}
