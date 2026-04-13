# Codex Continuation Note

Date: 2026-04-12
Status: current

Use this in a new chat:

`Check CODEX_CONTINUATION_NOTE.md and continue the two-model Codex runtime work from there.`

## Current state

- The active runtime surface is `gpt-5.4`, `gpt-5.3-codex-spark`, and `auto`.
- Both active models run through the shared Codex CLI transport and the V2 tool executor path.
- The legacy alternate-provider path has been removed from active code and dependencies.

## Verified checks

- `npm run build`
- `npm test`

## Current runtime shape

The active model path is:

`CodexProvider -> AgentRuntime -> AgentToolExecutor -> tool modules -> app services`

The command window exposes:

- `Auto`
- `GPT-5.4`
- `GPT-5.3-Codex-Spark`

## What to review next

Focus on behavior, not migration plumbing:

1. Review whether `auto` routes the right task classes to the right model.
2. Decide whether planning/orchestration should remain with `gpt-5.4` exclusively or whether some bounded planning tasks can use the fast model.
3. Check whether command-surface labels, progress cards, and persisted task owners communicate the selected model clearly enough.
4. Review whether provider selection should remain prompt-heuristic based or move toward a more explicit task-mode contract.

## Known follow-up pressure points

- prompt/input size in `AgentPromptBuilder`
- stronger task-mode detection and routing policy
- richer sub-agent result structure
- execution-first command UI state

## Related files

- [src/main/agent/CodexProvider.ts](/home/dp/Desktop/v2workspace/src/main/agent/CodexProvider.ts)
- [src/main/agent/AgentModelService.ts](/home/dp/Desktop/v2workspace/src/main/agent/AgentModelService.ts)
- [src/main/agent/providerRouting.ts](/home/dp/Desktop/v2workspace/src/main/agent/providerRouting.ts)
- [src/main/agent/taskProfile.ts](/home/dp/Desktop/v2workspace/src/main/agent/taskProfile.ts)
- [src/renderer/command/command.ts](/home/dp/Desktop/v2workspace/src/renderer/command/command.ts)
