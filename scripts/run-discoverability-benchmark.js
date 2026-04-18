const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function parseArgs(argv) {
  const parsed = {
    providers: null,
    scenarios: null,
    outDir: null,
    format: 'both',
    perInvocationTimeoutMs: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--providers' && argv[index + 1]) {
      parsed.providers = argv[index + 1].split(',').map((value) => value.trim()).filter(Boolean);
      index += 1;
      continue;
    }
    if (arg === '--scenarios' && argv[index + 1]) {
      parsed.scenarios = argv[index + 1].split(',').map((value) => value.trim()).filter(Boolean);
      index += 1;
      continue;
    }
    if (arg === '--out-dir' && argv[index + 1]) {
      parsed.outDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--format' && argv[index + 1]) {
      parsed.format = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--per-invocation-timeout-ms' && argv[index + 1]) {
      parsed.perInvocationTimeoutMs = Number(argv[index + 1]);
      index += 1;
    }
  }

  return parsed;
}

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function timestampLabel() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function main() {
  await app.whenReady();

  const args = parseArgs(process.argv.slice(2));
  const projectRoot = path.join(__dirname, '..');
  const outDir = path.resolve(projectRoot, args.outDir || path.join('artifacts', 'discoverability-benchmark'));

  const {
    AgentModelService,
  } = require(path.join(projectRoot, 'dist', 'main', 'main', 'agent', 'AgentModelService.js'));
  const {
    runDiscoverabilityBenchmark,
    benchmarkRunsToArtifacts,
  } = require(path.join(projectRoot, 'dist', 'main', 'main', 'agent', 'discoverabilityBenchmarkHarness.js'));
  const {
    DISCOVERABILITY_AUDIT_SCENARIOS,
  } = require(path.join(projectRoot, 'dist', 'main', 'main', 'agent', 'discoverabilityAuditFixtures.js'));
  const {
    appStateStore,
  } = require(path.join(projectRoot, 'dist', 'main', 'main', 'state', 'appStateStore.js'));

  const selectedScenarios = args.scenarios
    ? DISCOVERABILITY_AUDIT_SCENARIOS.filter((scenario) => args.scenarios.includes(scenario.id))
    : DISCOVERABILITY_AUDIT_SCENARIOS;
  const selectedProviders = args.providers && args.providers.length > 0 ? args.providers : ['gpt-5.4', 'haiku'];

  if (selectedScenarios.length === 0) {
    throw new Error('No discoverability scenarios matched the provided --scenarios filter.');
  }

  try {
    const isolatedInvoker = {
      async invoke(taskId, prompt, explicitOwner, options) {
        const service = new AgentModelService();
        service.init();
        try {
          return await service.invoke(taskId, prompt, explicitOwner, options);
        } finally {
          if (typeof service.dispose === 'function') {
            await service.dispose();
          }
        }
      },
    };

    const benchmark = await runDiscoverabilityBenchmark(isolatedInvoker, {
      scenarios: selectedScenarios,
      providers: selectedProviders,
      taskIdPrefix: 'discoverability-live',
      perInvocationTimeoutMs: Number.isFinite(args.perInvocationTimeoutMs) ? args.perInvocationTimeoutMs : undefined,
    });

    ensureDir(outDir);
    const stamp = timestampLabel();
    const markdownPath = path.join(outDir, `discoverability-report-${stamp}.md`);
    const jsonPath = path.join(outDir, `discoverability-report-${stamp}.json`);

    const payload = {
      generatedAt: new Date().toISOString(),
      providers: selectedProviders,
      scenarios: selectedScenarios.map((scenario) => scenario.id),
      report: benchmark.report,
      runs: benchmark.runs.map((run) => ({
        scenarioId: run.scenarioId,
        providerId: run.providerId,
        taskId: run.taskId,
        prompt: run.prompt,
        result: run.result,
      })),
      artifacts: benchmarkRunsToArtifacts(benchmark.runs),
    };

    if (args.format === 'both' || args.format === 'md') {
      fs.writeFileSync(markdownPath, benchmark.report, 'utf-8');
    }
    if (args.format === 'both' || args.format === 'json') {
      fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf-8');
    }

    process.stdout.write(`${benchmark.report}\n\n`);
    process.stdout.write(`Report output directory: ${outDir}\n`);
    if (args.format === 'both' || args.format === 'md') {
      process.stdout.write(`Markdown report: ${markdownPath}\n`);
    }
    if (args.format === 'both' || args.format === 'json') {
      process.stdout.write(`JSON report: ${jsonPath}\n`);
    }
  } finally {
    appStateStore.persistNow();
    await app.quit();
  }
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`${message}\n`);
  try {
    await app.quit();
  } catch {}
  process.exitCode = 1;
});
