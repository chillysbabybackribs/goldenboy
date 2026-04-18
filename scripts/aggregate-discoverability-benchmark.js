const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const parsed = {
    inputDir: null,
    outDir: null,
    files: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input-dir' && argv[index + 1]) {
      parsed.inputDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--out-dir' && argv[index + 1]) {
      parsed.outDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--files' && argv[index + 1]) {
      parsed.files = argv[index + 1].split(',').map((value) => value.trim()).filter(Boolean);
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

function discoverJsonFiles(inputDir) {
  return fs.readdirSync(inputDir)
    .filter((entry) => entry.startsWith('discoverability-report-') && entry.endsWith('.json'))
    .sort()
    .map((entry) => path.join(inputDir, entry));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = path.join(__dirname, '..');
  const inputDir = path.resolve(projectRoot, args.inputDir || path.join('artifacts', 'discoverability-benchmark'));
  const outDir = path.resolve(projectRoot, args.outDir || inputDir);

  const {
    buildMergedDiscoverabilityReport,
  } = require(path.join(projectRoot, 'dist', 'main', 'main', 'agent', 'discoverabilityAggregate.js'));

  const selectedFiles = args.files.length > 0
    ? args.files.map((file) => path.resolve(projectRoot, file))
    : discoverJsonFiles(inputDir);
  if (selectedFiles.length === 0) {
    throw new Error(`No discoverability benchmark JSON files found in ${inputDir}`);
  }

  const payloads = selectedFiles.map((filePath) => JSON.parse(fs.readFileSync(filePath, 'utf-8')));
  const report = buildMergedDiscoverabilityReport(payloads);

  ensureDir(outDir);
  const stamp = timestampLabel();
  const markdownPath = path.join(outDir, `discoverability-aggregate-${stamp}.md`);
  const jsonPath = path.join(outDir, `discoverability-aggregate-${stamp}.json`);
  const payload = {
    generatedAt: new Date().toISOString(),
    sourceFiles: selectedFiles,
    report,
    payloads,
  };

  fs.writeFileSync(markdownPath, report, 'utf-8');
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf-8');

  process.stdout.write(`${report}\n\n`);
  process.stdout.write(`Aggregate markdown: ${markdownPath}\n`);
  process.stdout.write(`Aggregate json: ${jsonPath}\n`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
