# V2 Planning Contract

Use this contract only for complex orchestration tasks. Keep normal coding, debugging, and browser work on the lean `AGENTS.md` path.

## When To Use

Use planning mode when the user is asking for strategy, decomposition, staged execution, repo-wide change design, or explicit multi-agent coordination.

Do not enter planning mode for straightforward single-path tasks that can be completed directly with one short sequence of tool calls.

The planning objective is to reduce failed tool churn, not to produce long plans. Prefer a short executable plan over a comprehensive document.

## Planning Workflow

1. Classify whether the task is truly orchestration-heavy or only phrased that way.
2. Identify the concrete end state, hard constraints, and validation checkpoints.
3. Split work into the smallest independently useful tracks.
4. Decide which track stays on the parent critical path and which tracks can be delegated.
5. Spawn child agents only for bounded subtasks with clear ownership and success criteria.
6. Re-plan only when observed evidence invalidates the current plan.

Keep the plan compact. If the plan grows faster than execution, the plan is too large.

## Sub-Agent Design

Each child agent should have:

- one concrete role
- one bounded task
- the minimum context required
- an explicit tool scope
- a clear completion signal

Prefer children that answer one question, inspect one subsystem, or implement one isolated slice. Avoid spawning children for the immediate next blocking step unless parallelism clearly saves time.

Use synthesis in the parent. Children should return findings, changed files, commands, blockers, and validation status rather than broad narrative.

## Execution Guardrails

The parent agent owns:

- the master constraint list
- cross-track prioritization
- conflict resolution
- final synthesis

Do not let child plans drift into independent product decisions. If a child result changes scope, the parent must explicitly adopt or reject that change.

When the task is partly strategic and partly implementational, finish the planning pass quickly, then execute. Planning is a phase, not the product.

## Output Contract

For complex tasks, structure execution around:

1. Objective: what must be true at completion.
2. Tracks: the minimal workstreams.
3. Delegation: what the parent does versus what children do.
4. Validation: the checks that determine completion.
5. Next action: the immediate highest-leverage move.

If the user asked for design only, stop after the actionable plan. If the user asked to carry out the work, move from plan to execution without waiting for separate confirmation unless a real blocker appears.
