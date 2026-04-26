#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Node wrapper that spawns the Electron harness, reads the JSON report, prints
 * a human summary, and exits with the harness's result code.
 *
 * Usage:
 *   npm run test:e2e:determinism
 * Env:
 *   E2E_DISPLAY   — if "headless", run under xvfb-run (Linux CI).
 *   E2E_TIMEOUT   — overall timeout in ms (default: 60_000).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const HARNESS = path.join(__dirname, 'harness.js');
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT || 60_000);

function requireBuilt() {
  const marker = path.join(
    PROJECT_ROOT,
    'dist',
    'main',
    'main',
    'browser',
    'determinism',
    'DeterministicKernel.js',
  );
  if (!fs.existsSync(marker)) {
    console.error('[e2e] dist/main is missing. Run `npm run build:main` first.');
    process.exit(2);
  }
}

function pickElectron() {
  const bin = path.join(
    PROJECT_ROOT,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'electron.cmd' : 'electron',
  );
  if (!fs.existsSync(bin)) {
    console.error(`[e2e] electron binary not found at ${bin}`);
    process.exit(2);
  }
  return bin;
}

async function main() {
  requireBuilt();
  const electron = pickElectron();

  const reportPath = path.join(
    os.tmpdir(),
    `goldenboy-e2e-determinism-${Date.now()}-${process.pid}.json`,
  );

  const args = [HARNESS, '--no-sandbox'];
  const useXvfb = process.env.E2E_DISPLAY === 'headless' && process.platform === 'linux';
  const cmd = useXvfb ? 'xvfb-run' : electron;
  const spawnArgs = useXvfb
    ? ['--auto-servernum', '--server-args=-screen 0 1280x720x24', electron, ...args]
    : args;

  const env = {
    ...process.env,
    GOLDENBOY_E2E_REPORT: reportPath,
    GOLDENBOY_E2E_VERBOSE: process.env.GOLDENBOY_E2E_VERBOSE || '',
    ELECTRON_DISABLE_GPU: '1',
    ELECTRON_ENABLE_LOGGING: '1',
  };

  console.log(`[e2e] launching: ${cmd} ${spawnArgs.join(' ')}`);
  console.log(`[e2e] report → ${reportPath}`);

  const child = spawn(cmd, spawnArgs, { env, stdio: 'inherit', cwd: PROJECT_ROOT });

  const timer = setTimeout(() => {
    console.error(`[e2e] timeout after ${TIMEOUT_MS}ms — killing harness`);
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
  }, TIMEOUT_MS);

  const exitCode = await new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (signal) {
        console.error(`[e2e] harness killed by signal ${signal}`);
        resolve(2);
      } else {
        resolve(code == null ? 2 : code);
      }
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      console.error('[e2e] failed to launch harness:', err);
      resolve(2);
    });
  });

  let report = null;
  if (fs.existsSync(reportPath)) {
    try { report = JSON.parse(fs.readFileSync(reportPath, 'utf8')); } catch (e) {
      console.error(`[e2e] failed to parse report: ${e.message}`);
    }
  }

  if (!report) {
    console.error('[e2e] no report produced.');
    process.exit(exitCode || 2);
  }

  console.log('');
  console.log('=== Determinism E2E Report ===');
  console.log(`overall: ${report.ok ? 'PASS' : 'FAIL'}  (started ${report.startedAt} → ${report.finishedAt})`);
  for (const c of report.cases) {
    const tag = c.status === 'pass' ? 'PASS' : 'FAIL';
    console.log(`  [${tag}] ${c.label} (${c.durationMs}ms)`);
    if (c.status === 'fail' && c.error) {
      console.log(c.error.split('\n').map((l) => `         ${l}`).join('\n'));
    }
  }

  try { fs.unlinkSync(reportPath); } catch { /* ignore */ }
  process.exit(report.ok ? 0 : 1);
}

main().catch((err) => {
  console.error('[e2e] wrapper crashed:', err);
  process.exit(2);
});
