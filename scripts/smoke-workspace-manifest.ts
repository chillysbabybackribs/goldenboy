/**
 * Smoke script: build the workspace manifest for the current repo, print
 * size + top-10 directory overview, then run a few prompt-routing queries
 * through `locate` to verify it returns sensible paths.
 *
 * Usage: npx tsx scripts/smoke-workspace-manifest.ts
 */
import * as path from 'path';
import { buildWorkspaceManifest, locate, renderDirectoryOverview } from '../src/main/agent/workspaceManifest';

async function main(): Promise<void> {
  const root = path.resolve(__dirname, '..');
  const t0 = Date.now();
  const manifest = buildWorkspaceManifest({ root });
  const buildMs = Date.now() - t0;

  console.log(`Built workspace manifest for ${root}`);
  console.log(`  files: ${manifest.files.length}`);
  console.log(`  directories: ${manifest.directories.length}`);
  console.log(`  build: ${buildMs}ms`);
  console.log();

  const overview = renderDirectoryOverview(manifest, { maxDepth: 3, maxChars: 4000 });
  console.log('--- DIRECTORY OVERVIEW ---');
  console.log(overview);
  console.log();
  console.log(`overview chars: ${overview.length}`);
  console.log();

  const queries = [
    'memory system functionality',
    'how does the browser research search work',
    'where is the task profile router',
    'skill files for subagent coordination',
    'prompt builder',
    'repo map pagerank',
    'filesystem patch tool',
  ];
  for (const q of queries) {
    const hits = locate(manifest, { query: q, limit: 5 });
    console.log(`QUERY: ${q}`);
    for (const h of hits) {
      const purpose = h.purpose ? ` — ${h.purpose}` : '';
      console.log(`  ${h.score.toFixed(2).padStart(6)}  ${h.path}${purpose}`);
    }
    if (hits.length === 0) console.log('  (no matches)');
    console.log();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
