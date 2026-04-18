# Discoverability Benchmark Setup

## Goal

Run the same discoverability scenarios against `gpt-5.4` and `haiku`, capture the real runtime tool traces, and emit a comparative report.

## Command

```bash
npm run benchmark:discoverability
```

This command:

1. builds the app
2. starts Electron with the benchmark runner
3. runs the discoverability scenario matrix through `AgentModelService.invoke()`
4. writes report files under `artifacts/discoverability-benchmark/`

If the full matrix is too unstable in one long Electron session, use chunked execution:

```bash
npm run benchmark:discoverability:chunks
```

This runs smaller scenario batches, tolerates chunk failures, and then writes one merged aggregate report from the successful chunk JSON files.

The benchmark launches Electron with:

- `--disable-gpu`
- `--disable-software-rasterizer`
- `--disable-dev-shm-usage`

This reduces long-run instability in environments where the Electron GPU process is unreliable.

## Output

Each run writes timestamped files:

- `discoverability-report-<timestamp>.md`
- `discoverability-report-<timestamp>.json`

Aggregated chunk runs also write:

- `discoverability-aggregate-<timestamp>.md`
- `discoverability-aggregate-<timestamp>.json`

The markdown file is the human-readable scorecard.

The JSON file contains:

- report text
- selected providers
- selected scenarios
- per-run prompts
- raw invocation results

## Filters

You can narrow the run:

```bash
electron --disable-gpu --disable-software-rasterizer --disable-dev-shm-usage scripts/run-discoverability-benchmark.js --providers gpt-5.4
electron --disable-gpu --disable-software-rasterizer --disable-dev-shm-usage scripts/run-discoverability-benchmark.js --scenarios local-config-lookup,tests-infer-behavior
electron --disable-gpu --disable-software-rasterizer --disable-dev-shm-usage scripts/run-discoverability-benchmark.js --out-dir artifacts/discoverability-custom
electron --disable-gpu --disable-software-rasterizer --disable-dev-shm-usage scripts/run-discoverability-benchmark.js --format md
```

## Current Scenario Set

The live benchmark currently uses the fixtures defined in:

- `src/main/agent/discoverabilityAuditFixtures.ts`

## Important Notes

- The harness uses the real `AgentModelService` path, so provider availability and authentication still matter.
- If one provider or scenario fails, the benchmark continues and records that failure in the final report instead of aborting the whole run.
- The benchmark currently scores observable behavior from invocation output plus `runId`-scoped tool calls from `agentRunStore`.

## Next Improvements

- add a command-surface action to launch the benchmark from the UI
- persist scored artifacts directly instead of writing plain files only
- add richer question-detection heuristics based on chat/tool transcripts
