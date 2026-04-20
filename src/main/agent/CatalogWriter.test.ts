import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Mock electron app before importing CatalogWriter
vi.mock('electron', () => ({
  app: { getPath: () => tmpDir },
}));

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('writeCatalog', () => {
  it('writes a manifest and chunk files', async () => {
    const { writeCatalog } = await import('./CatalogWriter');
    const tools = [
      {
        name: 'browser.navigate' as any,
        description: 'Navigate to a URL',
        inputSchema: { type: 'object', properties: { url: { type: 'string' } } },
        execute: async () => ({ summary: '', data: {} }),
      },
      {
        name: 'filesystem.read' as any,
        description: 'Read a file',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
        execute: async () => ({ summary: '', data: {} }),
      },
    ];

    const manifest = writeCatalog(tools);

    expect(manifest.version).toBe(1);
    expect(manifest.chunks).toHaveLength(2);
    expect(manifest.chunks.map(c => c.category).sort()).toEqual(['browser', 'filesystem']);

    const catalogDir = path.join(tmpDir, 'tool-catalog');
    expect(fs.existsSync(path.join(catalogDir, 'catalog-manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(catalogDir, 'catalog-browser.json'))).toBe(true);
    expect(fs.existsSync(path.join(catalogDir, 'catalog-filesystem.json'))).toBe(true);
  });

  it('skips rewriting a chunk when signature is unchanged', async () => {
    const { writeCatalog } = await import('./CatalogWriter');
    const tools = [
      {
        name: 'browser.navigate' as any,
        description: 'Navigate',
        inputSchema: {},
        execute: async () => ({ summary: '', data: {} }),
      },
    ];

    writeCatalog(tools);

    const catalogDir = path.join(tmpDir, 'tool-catalog');
    const chunkPath = path.join(catalogDir, 'catalog-browser.json');
    const mtimeBefore = fs.statSync(chunkPath).mtimeMs;

    // Small sleep to ensure mtime would change if file is rewritten
    await new Promise(r => setTimeout(r, 10));
    writeCatalog(tools);

    const mtimeAfter = fs.statSync(chunkPath).mtimeMs;
    expect(mtimeAfter).toBe(mtimeBefore);
  });

  it('rewrites a chunk when tool description changes', async () => {
    const { writeCatalog } = await import('./CatalogWriter');
    const tool = {
      name: 'browser.navigate' as any,
      description: 'Navigate',
      inputSchema: {},
      execute: async () => ({ summary: '', data: {} }),
    };

    writeCatalog([tool]);

    const catalogDir = path.join(tmpDir, 'tool-catalog');
    const chunkPath = path.join(catalogDir, 'catalog-browser.json');
    const mtimeBefore = fs.statSync(chunkPath).mtimeMs;

    await new Promise(r => setTimeout(r, 10));
    writeCatalog([{ ...tool, description: 'Navigate to a URL — updated' }]);

    const mtimeAfter = fs.statSync(chunkPath).mtimeMs;
    expect(mtimeAfter).toBeGreaterThan(mtimeBefore);
  });

  it('includes jsCall and tokenEstimate in each entry', async () => {
    const { writeCatalog } = await import('./CatalogWriter');
    const tools = [
      {
        name: 'terminal.exec' as any,
        description: 'Execute a shell command',
        inputSchema: { type: 'object', properties: { command: { type: 'string' } } },
        execute: async () => ({ summary: '', data: {} }),
      },
    ];

    writeCatalog(tools);

    const catalogDir = path.join(tmpDir, 'tool-catalog');
    const chunk = JSON.parse(fs.readFileSync(path.join(catalogDir, 'catalog-terminal.json'), 'utf-8'));
    expect(chunk[0].jsCall).toBe('window.tools.terminal.exec');
    expect(typeof chunk[0].tokenEstimate).toBe('number');
    expect(chunk[0].tokenEstimate).toBeGreaterThan(0);
  });
});
