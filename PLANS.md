# Planning Contract

This is the planning contract for orchestration turns in Goldenboy. Use it when the task is about decomposition, delegation, sequencing, or multi-track execution.

## Planning Workflow

1. Restate the concrete objective in one line.
2. Identify the critical path and the first blocking action.
3. Split supporting work into bounded tracks only when the tracks are materially independent.
4. Keep the plan short enough that execution can start immediately after it.
5. Respect the runtime-selected execution mode; do not self-upgrade a plan-only turn into execution.

## Sub-Agent Design

- Delegate only self-contained subtasks with a clear owner, scope, and success contract.
- Avoid overlapping write scopes across tracks.
- Keep urgent blocker work with the parent unless a delegated result is truly independent of the next local action.
- Ask sub-agents for concrete outputs, not open-ended exploration unless exploration is the task.

## Execution Guardrails

- Do not let planning become speculative prose.
- Prefer plans that can be validated with observed tool results.
- Call out assumptions, blockers, and irreversible decisions explicitly.
- Update the plan when new evidence changes the critical path.

## Output Contract

The final planning output should stay compact and executable. Separate:

- objective
- tracks or workstreams
- delegation
- validation
- immediate next action
