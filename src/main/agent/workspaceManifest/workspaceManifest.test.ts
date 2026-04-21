import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  applyFileDelete,
  applyFileUpsert,
  buildWorkspaceManifest,
} from './buildManifest';
import { locate, tokenize } from './locate';
import {
  renderDirectoryOverview,
  renderFullFileListing,
  listSubtree,
} from './renderManifest';
import { WorkspaceManifestService } from './workspaceManifestService';

function makeFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wsm-'));
  const write = (rel: string, content: string): void => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
  };

  write(
    'AGENTS.md',
    '# Goldenboy Agent Contract\n\nThis file defines the operating rules for all agents.\n',
  );
  write(
    'package.json',
    JSON.stringify(
      { name: 'goldenboy', description: 'Desktop AI agent with multi-surface tool routing' },
      null,
      2,
    ),
  );
  write(
    'src/main/memory/taskMemoryStore.ts',
    `/**
 * Persistent memory store for task-level notes and scratchpads.
 * Uses better-sqlite3 under the hood.
 */
export class TaskMemoryStore {
  constructor() {}
}
`,
  );
  write(
    'src/main/agent/AgentRuntime.ts',
    `// Top-level agent turn orchestrator: assembles prompt, dispatches to provider, collects tool results.
import { nothing } from 'nothing';

export class AgentRuntime {}
`,
  );
  write(
    'src/main/agent/AgentRuntime.test.ts',
    `describe('AgentRuntime', () => { it('works', () => {}); });
`,
  );
  write(
    'src/main/chatKnowledge/ChatKnowledgeStore.ts',
    `/**
 * In-memory embedding store for chat-thread turns.
 */
export class ChatKnowledgeStore {}
`,
  );
  write(
    'skills/subagent-coordination/SKILL.md',
    `---
name: subagent-coordination
description: How to delegate bounded work to parallel subagents.
---

# Subagent Coordination

Body goes here.
`,
  );
  write(
    'docs/overview.md',
    '# Goldenboy Architecture Overview\n\nHigh-level map of the process layout.\n',
  );
  write('src/main/browser/fixtures/page.html', '<html>ignore me</html>\n');
  write('assets/icon.png', 'binarystub');

  return root;
}

describe('workspace manifest', () => {
  let root: string;

  beforeEach(() => {
    root = makeFixture();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('walks the workspace and classifies files', () => {
    const manifest = buildWorkspaceManifest({ root });
    const byPath = new Map(manifest.files.map((f) => [f.path, f]));

    expect(byPath.get('AGENTS.md')?.fileType).toBe('doc');
    expect(byPath.get('package.json')?.fileType).toBe('config');
    expect(byPath.get('src/main/agent/AgentRuntime.ts')?.fileType).toBe('code');
    expect(byPath.get('src/main/agent/AgentRuntime.test.ts')?.fileType).toBe('test');
    expect(byPath.get('skills/subagent-coordination/SKILL.md')?.fileType).toBe('skill');
    expect(byPath.get('src/main/browser/fixtures/page.html')?.fileType).toBe('fixture');
    expect(byPath.get('assets/icon.png')?.fileType).toBe('asset');
  });

  it('extracts purpose lines from markdown, package.json, JSDoc, and skill frontmatter', () => {
    const manifest = buildWorkspaceManifest({ root });
    const byPath = new Map(manifest.files.map((f) => [f.path, f]));

    expect(byPath.get('AGENTS.md')?.purpose).toMatch(/Goldenboy Agent Contract/);
    expect(byPath.get('package.json')?.purpose).toMatch(/Desktop AI agent/);
    expect(byPath.get('src/main/memory/taskMemoryStore.ts')?.purpose).toMatch(
      /Persistent memory store/,
    );
    expect(byPath.get('src/main/agent/AgentRuntime.ts')?.purpose).toMatch(
      /agent turn orchestrator/,
    );
    expect(byPath.get('skills/subagent-coordination/SKILL.md')?.purpose).toMatch(
      /delegate bounded work/,
    );
  });

  it('aggregates directory-level purposes from README / AGENTS.md', () => {
    const manifest = buildWorkspaceManifest({ root });
    const dirsByPath = new Map(manifest.directories.map((d) => [d.path, d]));
    // Root dir picks up AGENTS.md as its signal file.
    expect(dirsByPath.get('')?.purpose).toMatch(/Goldenboy Agent Contract/);
  });

  it('locate ranks a conceptual query to the right file', () => {
    const manifest = buildWorkspaceManifest({ root });
    const matches = locate(manifest, { query: 'memory system functionality' });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].path).toBe('src/main/memory/taskMemoryStore.ts');
    expect(matches[0].matchedTokens).toContain('memory');
  });

  it('locate respects pathPrefix and fileTypes filters', () => {
    const manifest = buildWorkspaceManifest({ root });
    const scoped = locate(manifest, {
      query: 'agent runtime',
      pathPrefix: 'src/main/agent',
    });
    expect(scoped.every((m) => m.path.startsWith('src/main/agent/'))).toBe(true);

    const docsOnly = locate(manifest, {
      query: 'goldenboy architecture',
      fileTypes: ['doc'],
    });
    expect(docsOnly.every((m) => m.fileType === 'doc')).toBe(true);
    expect(docsOnly[0]?.path).toBe('docs/overview.md');
  });

  it('tokenizer drops stopwords and splits camelCase/snake_case/kebab-case', () => {
    expect(tokenize('how does the task memory store work?')).toEqual(
      expect.arrayContaining(['task', 'memory', 'store']),
    );
    expect(tokenize('ChatKnowledgeStore')).toEqual(
      expect.arrayContaining(['chatknowledgestore', 'chat', 'knowledge', 'store']),
    );
  });

  it('renders a compact directory overview', () => {
    const manifest = buildWorkspaceManifest({ root });
    const overview = renderDirectoryOverview(manifest, { maxDepth: 3 });
    expect(overview).toContain('Workspace:');
    expect(overview).toContain('src/main/agent/');
    expect(overview).toContain('skills/');
  });

  it('lists a subtree with purposes', () => {
    const manifest = buildWorkspaceManifest({ root });
    const entries = listSubtree(manifest, { prefix: 'src/main' });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.path.startsWith('src/main/'))).toBe(true);

    const flat = renderFullFileListing(manifest);
    expect(flat.some((l) => l.includes('AGENTS.md'))).toBe(true);
  });

  it('applyFileUpsert reflects new files in-place', () => {
    const manifest = buildWorkspaceManifest({ root });
    const newPath = path.join(root, 'src/main/newfeature/index.ts');
    fs.mkdirSync(path.dirname(newPath), { recursive: true });
    fs.writeFileSync(
      newPath,
      `/**
 * Brand-new feature: token routing policy.
 */
export const x = 1;
`,
      'utf-8',
    );

    const changed = applyFileUpsert(manifest, newPath);
    expect(changed).toBe(true);

    const match = locate(manifest, { query: 'token routing policy' });
    expect(match[0]?.path).toBe('src/main/newfeature/index.ts');
  });

  it('applyFileDelete removes a file entry', () => {
    const manifest = buildWorkspaceManifest({ root });
    const target = path.join(root, 'src/main/agent/AgentRuntime.ts');
    fs.unlinkSync(target);
    const removed = applyFileDelete(manifest, target);
    expect(removed).toBe(true);
    expect(
      manifest.files.find((f) => f.path === 'src/main/agent/AgentRuntime.ts'),
    ).toBeUndefined();
  });

  it('service caches, supports noteFileChanged without rebuild, and busts version on change', () => {
    const service = new WorkspaceManifestService();
    const entry = service.ensureSync(root);
    const v1 = service.getVersion(root);
    expect(v1).not.toBe('no-manifest');
    expect(entry.manifest.files.length).toBeGreaterThan(0);

    const newPath = path.join(root, 'src/main/memory/shortTermStore.ts');
    fs.writeFileSync(
      newPath,
      `/**
 * Ephemeral short-term memory buffer used during a single turn.
 */
export const store = {};
`,
      'utf-8',
    );
    service.noteFileChanged(newPath);
    const v2 = service.getVersion(root);
    expect(v2).not.toBe(v1);

    const locateMatch = locate(service.peek(root)!.manifest, {
      query: 'short term memory buffer',
    });
    expect(locateMatch[0]?.path).toBe('src/main/memory/shortTermStore.ts');
  });

  it('service getOverviewSync returns a non-empty rendered overview after build', () => {
    const service = new WorkspaceManifestService();
    service.ensureSync(root);
    const overview = service.getOverviewSync(root, { maxDepth: 3 });
    expect(overview).toBeTruthy();
    expect(overview!.length).toBeGreaterThan(0);
  });
});
