#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ELECTRON="$ROOT/node_modules/.bin/electron"
RUNNER="$ROOT/scripts/run-discoverability-benchmark.js"
AGGREGATOR="$ROOT/scripts/aggregate-discoverability-benchmark.js"
FLAGS=(--disable-gpu --disable-software-rasterizer --disable-dev-shm-usage)

run_chunk() {
  local scenarios="$1"
  timeout 180s "$ELECTRON" "${FLAGS[@]}" "$RUNNER" --scenarios "$scenarios" --providers gpt-5.4,haiku || true
}

run_chunk "local-config-lookup,tests-infer-behavior"
run_chunk "runtime-status-from-logs"
run_chunk "cross-source-summary"
run_chunk "stale-doc-vs-current-code,true-missing-information"

node "$AGGREGATOR"
