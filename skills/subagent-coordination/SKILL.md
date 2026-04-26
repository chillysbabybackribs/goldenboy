---
name: subagent-coordination
description: Use when the task benefits from parallel or delegated work via child agents. Governs delegation procedure, scope separation, and result integration.
allowed-tools:
  - subagent.spawn
references:
  - src/main/agent/subagents/SubAgentManager.ts
  - src/main/agent/subagents/SubAgentRuntime.ts
  - src/main/agent/subagents/SubAgentTypes.ts
  - src/main/agent/tools/subagent/index.ts
---

# Sub-Agent Coordination

Use this skill when a task benefits from parallel or delegated work.

## Workflow

1. Decide whether a child agent can make progress independently.
2. Give the child a concrete role and task.
3. Pass only the context needed for that task unless unrestricted full-context mode is active.
4. Treat the child as a delegated execution step in the same parent task flow.
5. Summarize child results before using them in parent reasoning.

## Rules

- This skill governs delegation procedure only. It does not grant permission to spawn sub-agents when the runtime scope disallows it.
- Do not use child agents to mask unclear scope or avoid local critical-path work.
- Keep write ownership disjoint across delegated tracks.

## Preferred Tools

- `subagent.spawn`
