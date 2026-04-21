# Sub-Agent Coordination

Use this skill when a task benefits from parallel or delegated work.

## Relevant Files

- `src/main/agent/subagents/SubAgentManager.ts`
- `src/main/agent/subagents/SubAgentRuntime.ts`
- `src/main/agent/subagents/SubAgentTypes.ts`
- `src/main/agent/tools/subagent/index.ts`

## Workflow

1. Decide whether a child agent can make progress independently.
2. Give the child a concrete role and task.
3. Pass only the context needed for that task unless unrestricted full-context mode is active.
4. Treat the child as a delegated execution step in the same parent task flow.
5. Summarize child results before using them in parent reasoning.

## Preferred Tools

- `subagent.spawn`
