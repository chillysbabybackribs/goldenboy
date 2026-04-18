# Model Discoverability Audit Plan

## Status

This document originally described a first-pass implementation. The current codebase has already moved beyond that scope.

Implemented in code now:

- scenario metadata and bucket coverage in `src/main/agent/discoverabilityAuditFixtures.ts`
- scoring and aggregate metrics in `src/main/agent/discoverabilityAudit.ts`
- runtime-artifact scoring, per-provider reports, and text report generation in `src/main/agent/discoverabilityAuditRunner.ts`
- live invocation capture from `InvocationResult` plus `agentRunStore` tool calls in `src/main/agent/discoverabilityLiveCapture.ts`
- benchmark execution across providers and scenarios in `src/main/agent/discoverabilityBenchmarkHarness.ts`
- chunk merge support for persisted benchmark payloads in `src/main/agent/discoverabilityAggregate.ts`
- unit coverage for scoring, runner behavior, harness behavior, live capture, and aggregation in the corresponding `*.test.ts` files
- deterministic runtime result validation in `src/main/agent/ConstraintValidator.ts` and the non-overridable handling rules in `src/main/agent/sourceValidationPolicy.ts`

The sections below describe the intended behavior and the remaining gaps, but the repo is no longer at the "plan only" stage.

## Current Classification Reality

This repo now has two separate classification layers. The plan should not describe them as if they were one score.

### Runtime validation layer

`ConstraintValidator.ts` classifies an individual tool result deterministically:

- `VALID`: every checked constraint is `PASS`
- `INVALID`: at least one checked constraint is `FAIL`
- `INCOMPLETE`: no `FAIL`, but at least one constraint is `UNKNOWN`, `ESTIMATED`, or `CONDITIONAL`

This is the authoritative runtime status for a tool result. `sourceValidationPolicy.ts` explicitly forbids the model from softening or reinterpreting a `RUNTIME VALIDATION` block.

### Benchmark scoring layer

`discoverabilityAudit.ts` scores the model's overall behavior around evidence gathering and synthesis:

- `strong_pass`
- `soft_pass`
- `fail`

This layer also records the failure taxonomy:

- `premature_question`
- `weak_exploration`
- `missed_synthesis`
- `wrong_confidence`
- `tool_avoidance`

`correct_escalation` is tracked as a successful ask-user outcome, not as a failure kind.

### Infrastructure availability is separate

Benchmark infrastructure problems are excluded from scoring rather than treated as model failures. The runner tests cover examples such as provider unavailability and benchmark timeouts.

## Objective

Measure whether `gpt-5.4` and `haiku` gather system knowledge proactively before asking the user for information.

The target behavior is not "never ask questions." The target behavior is:

1. inspect local and available context first
2. gather evidence from reachable sources
3. synthesize from that evidence
4. ask only when a real information gap remains or ambiguity is materially risky

## Core Principle

A question is a failure when the answer was already discoverable through tools, workspace state, runtime state, or attached context that the model could have gathered itself.

A question is correct when:

- the needed information is genuinely unavailable
- the remaining ambiguity changes the action materially
- the model has already exhausted the obvious discovery path

## Failure Taxonomy

Use these labels for benchmark scoring across both models:

- `premature_question`: the model asked before attempting the obvious discovery path
- `weak_exploration`: the model made a shallow attempt, then asked despite more reachable evidence
- `missed_synthesis`: the model found the facts but failed to infer the answer
- `wrong_confidence`: the model assumed instead of checking accessible sources
- `tool_avoidance`: the model defaulted to conversation instead of using the available runtime
- `correct_escalation`: the model asked only after a real gap remained

These labels do not replace the runtime validator's `VALID` / `INVALID` / `INCOMPLETE` result status.

## Eval Buckets

The benchmark set should mix these buckets so we do not overfit one area:

- `workspace_local`: answers live in repo files, config, scripts, docs, tests, or generated state
- `runtime_observable`: answers require browser, terminal, logs, process state, or cached runtime data
- `cross_source`: answers require combining multiple sources
- `stale_vs_current`: one source is outdated and another source is current
- `negative_control`: the information is not available, so asking is correct

## Scenario Shape

Every scenario should declare:

- `task`: what the user asks
- `available_facts`: facts already discoverable in the environment
- `reachable_sources`: tools or sources that can reveal those facts
- `minimum_discovery_path`: the smallest reasonable self-service path
- `ask_required`: whether asking the user is actually necessary
- `expected_answer`: the minimally correct outcome

This keeps the eval focused on discoverability rather than prompt wording.

## Scoring

Track both per-scenario and per-model metrics.

### Primary metrics

- `unnecessary_question_rate`
- `premature_question_rate`
- `source_coverage`
- `minimum_path_completion_rate`
- `correct_answer_rate`
- `correct_escalation_rate`

### Secondary metrics

- `time_to_first_self_service_action`
- `tool_diversity_used`
- `evidence_before_answer`
- `evidence_before_asking`

## Behavioral Rubric

### Strong pass

- the model gathers the needed information without asking
- or it asks only after exhausting the declared reachable sources
- the answer is correct and grounded in observed evidence

### Soft pass

- the model reaches the right answer
- but explores inefficiently, redundantly, or with weaker-than-desired coverage

### Fail

- the model asks prematurely
- or it asks a vague question when the missing gap was discoverable
- or it finds the evidence and still answers incorrectly
- or it answers confidently without checking accessible sources

This rubric applies to benchmark behavior classification only. It is separate from tool-result validation in `ConstraintValidator.ts`.

## Audit Data Model

The current implementation uses a lightweight structured trace built from runtime artifacts:

- `tool_call`
- `observation`
- `ask_user`
- `answer`

The scoring pipeline currently derives these from completed tool calls, invocation output, and optional overrides for whether the model asked the user or grounded the answer in evidence. This keeps the benchmark lightweight while still allowing deterministic scoring.

Important nuance: runtime artifacts may already include deterministic validation outcomes for individual tool calls. Those outcomes should be treated as evidence feeding the benchmark trace, not collapsed into the benchmark's pass/fail labels.

## First Benchmark Matrix

Start with a small balanced set:

1. local config lookup
2. feature behavior inferred from tests
3. runtime status inferred from logs or command output
4. cross-source answer requiring file + test + docs
5. stale doc vs current implementation conflict
6. true missing-information case where asking is required

Each of these should be runnable against both `gpt-5.4` and `haiku` with the same tool surface and same starting context.

## Implementation Status

### Implemented

- benchmark vocabulary and scoring logic
- scenario metadata and bucketed fixtures
- unit tests for premature asking, weak exploration, missed synthesis, wrong confidence, and correct escalation
- runtime capture from live invocations
- comparative text reporting across providers
- persisted artifact merge support for chunked benchmark runs
- an executable benchmark harness that runs the scenario matrix against real providers

### Remaining Work

- expand the scenario corpus beyond the initial balanced matrix
- add more adversarial and ambiguous cases
- improve question-detection heuristics beyond output-shape matching and manual overrides
- persist richer scored artifacts directly instead of relying on plain report files alone
- connect the findings more directly to routing, prompt assembly, and tool-surface policy decisions in product workflows

## Current Output

This repo now contains:

- this plan
- a scoring module for discoverability behavior
- a deterministic runtime validation module for individual tool results
- scenario fixtures and scenario lookup helpers
- runtime capture and report-building modules
- a benchmark harness for real provider invocations
- chunk aggregation helpers for persisted benchmark payloads
- unit tests that lock the scoring and reporting behavior into executable expectations

## Open Design Questions

- how much more of the trace should be derived from existing run records versus additional instrumentation
- whether live invocation should remain the primary comparison path or be paired with more offline replay coverage
- whether "minimum discovery path" should become stricter or continue to allow equivalent alternative actions
- how to separate routing failures from reasoning failures in the final scorecard
- how much weighting to give groundedness versus correctness when the answer is right but evidence collection is weak
