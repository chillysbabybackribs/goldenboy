---
name: subagent-coordination
description: Orchestrate runtime-managed sub-agents when a task benefits from delegation, parallel discovery, independent verification, or multiple specialist passes. Use for research, browser work, writing, audits, planning, debugging, and implementation. Not for trivial work or tightly coupled tasks that need one continuous local thread.
metadata:
  short-description: Coordinate delegated multi-agent work
---

# Sub-Agent Coordination

Use this skill when the parent agent should own judgement and synthesis while child agents handle bounded subtasks.

This is not code-only. Use it for research, browser investigation, writing, audits, plans, debugging, and implementation.

## Relevant Files

- `src/main/agent/tools/subagentTools.ts`
- `src/main/agent/subagents/SubAgentManager.ts`
- `src/main/agent/subagents/SubAgentRuntime.ts`
- `src/main/agent/subagents/SubAgentTypes.ts`
- `skills/browser-operation/SKILL.md`
- `skills/filesystem-operation/SKILL.md`
- `skills/local-debug/SKILL.md`

## Use It When

1. A child can make progress independently with a clear objective.
2. Parallel discovery or verification would reduce latency or uncertainty.
3. You want separate lenses on the same artifact, problem, or decision.
4. The work has a natural scout -> act -> verify shape.
5. The parent can continue synthesis while child work runs.

Do not use it when:

1. The task is trivial or faster to do directly.
2. The next parent action is blocked on a tiny subtask you can do yourself.
3. Multiple children would need to edit the same artifact concurrently.
4. The child would just rediscover the whole task because the boundary is vague.

Default rule: many readers are fine; use one writer per shared artifact or decision surface.

## Parent Responsibilities

The orchestrator owns:

1. Deciding whether delegation is worth it.
2. Splitting work into concrete, bounded subtasks.
3. Passing only the context the child actually needs.
4. Tracking child ids and statuses.
5. Waiting only when the parent is blocked.
6. Merging outputs into one clear answer or next action.

Do not forward raw child output unless it is already clean and decision-ready.

## Preferred Tools

- `subagent.spawn`
- `subagent.wait`
- `subagent.list`
- `subagent.cancel`

## Spawn Guidance

Use these fields deliberately:

- `task`: exact deliverable
- `role`: short label such as `research`, `browser`, `files`, `code`, `debug`, `writer`, or `verifier`
- `mode`: default to `unrestricted-dev` unless stricter handling is needed
- `inheritedContext`: default to `summary`; use `full` only when necessary, `none` for isolated work
- `allowedTools`: restrict when the task is narrow or risky; use `'all'` only when justified
- `canSpawnSubagents`: usually `false` for bounded child work

Before spawning, answer:

1. What exact output do I need back?
2. What context can the child not infer safely?
3. What tools should the child be allowed to use?
4. Is this read-only, or is the child the single owner of a write surface?
5. Do I need the result now, or can it run in parallel?

If those answers are fuzzy, refine the task first.

## Context Pack

When the task is subtle or history-sensitive, give the child a compact brief:

- Goal
- Non-goals
- Constraints
- Inputs such as files, URLs, notes, or artifacts
- Success check

Do not pass full history by default. Prefer `inheritedContext: "summary"` plus a short task-specific brief.

## Common Patterns

### Triangulated Review

Use when you want independent perspectives on the same thing.

Examples:

- correctness
- risks and edge cases
- clarity, structure, or audience fit

Parent output: one ranked list, deduplicated, with a clear recommendation.

### Scout -> Decide -> Act -> Verify

Use when missing context is the main risk.

1. Scout gathers the minimum facts.
2. Parent chooses the approach.
3. One actor produces the change or deliverable.
4. One verifier checks for omissions, regressions, or unsupported claims.

### Split By Slice

Use when work divides cleanly by section, file, page, source set, or question.

Each child owns one slice. The parent reconciles tone, consistency, and priority.

### Research -> Synthesis

Use when the result is a judgement call informed by evidence.

Children gather evidence. The parent resolves disagreement, dates findings when relevant, and states the recommendation.

### Options Sprint

Use when choosing direction matters more than immediate execution.

Children produce 2 to 3 viable options. The parent selects or combines them.

## Role Guidance

Choose roles that fit the runtime's routing:

- `research` or `browser-research` for web discovery and evidence gathering
- `browser` for page inspection or interaction-heavy tasks
- `files` for read-heavy workspace analysis
- `code` for implementation work
- `debug` or `terminal-debug` for builds, logs, and runtime failures
- `verifier` for read-only validation
- `writer`, `editor`, or `analyst` for document and synthesis work

Include the role keyword in `role` so the child gets the most relevant local skills.

## Write Safety

If a child may edit:

1. Give it a clearly owned artifact or file set.
2. Keep other children read-only on that same surface.
3. Tell it what not to touch.
4. Follow with a separate verification pass when the task matters.

This applies to code and non-code artifacts alike.

## Waiting Strategy

After spawning a child:

1. Continue local work if possible.
2. Use `subagent.list` when you need status.
3. Call `subagent.wait` only when the next parent step depends on the result.
4. Cancel children that are no longer useful.

Avoid spawning and then immediately waiting unless the child is on the critical path.

## Reading Child Results

`subagent.wait` returns structured output including:

- `summary`
- `findings`
- `changedFiles`
- `commands`
- `blockers`
- `toolCalls`
- `validation`

Focus on `findings` for substance, `changedFiles` and `commands` for traceability, and `blockers` plus `validation` for risk.

## Prompting Pattern

Keep child tasks short, specific, and bounded.

```text
TASK: <exact task>
ROLE: <specialist role>
GOAL: <what success looks like>
CONSTRAINTS:
- <scope boundary>
- <must keep or avoid>
OUTPUT:
- <expected deliverables>
```

Example research spawn:

```json
{
  "task": "Review the browser automation options in this project and return a concise recommendation with evidence, tradeoffs, and open risks. Do not edit files.",
  "role": "research",
  "inheritedContext": "summary",
  "allowedTools": ["browser.search_web", "browser.research_search", "filesystem.read"],
  "canSpawnSubagents": false
}
```

Example writer/verifier spawn:

```json
{
  "task": "Review the draft report for unsupported claims, missing caveats, and internal inconsistencies. Read-only.",
  "role": "verifier",
  "inheritedContext": "summary",
  "allowedTools": ["filesystem.read", "filesystem.search", "browser.search_web"],
  "canSpawnSubagents": false
}
```

## Orchestrator Habits

1. Skim the artifact or problem yourself before delegating.
2. Delegate sidecar work, not your own immediate critical-path reasoning.
3. Prefer two strong children over a swarm of vague ones.
4. Re-run with better context if a child misunderstood.
5. Synthesize into one answer with one recommended next step.

Sub-agents increase throughput and coverage. The parent still owns the call.
