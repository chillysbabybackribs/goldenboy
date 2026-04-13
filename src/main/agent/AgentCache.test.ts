import * as fs from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeToolCacheKey } from './AgentCache';

const TEMP_FILE = path.join(process.cwd(), 'tmp-agent-cache-read.txt');

describe('AgentCache', () => {
  afterEach(() => {
    fs.rmSync(TEMP_FILE, { force: true });
  });

  it('changes filesystem.read cache keys when the file contents change', async () => {
    fs.writeFileSync(TEMP_FILE, 'first', 'utf-8');
    const relativePath = path.relative(process.cwd(), TEMP_FILE);
    const firstKey = makeToolCacheKey('filesystem.read', { path: relativePath });

    await new Promise(resolve => setTimeout(resolve, 20));
    fs.writeFileSync(TEMP_FILE, 'second revision', 'utf-8');
    const secondKey = makeToolCacheKey('filesystem.read', { path: relativePath });

    expect(secondKey).not.toBe(firstKey);
  });
});
