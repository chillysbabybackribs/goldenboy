# Two-Model Rollout Record

Date: 2026-04-12
Status: completed

## Final runtime surface

- `gpt-5.4`
- `gpt-5.3-codex-spark`
- `auto`

## Completed implementation outcomes

- shared provider ids now map directly to the active model surface
- both active models run through the existing V2 runtime and tool executor
- the Codex CLI transport passes explicit `--model` selection
- the command UI exposes only the two active models plus `auto`
- stale persisted selections normalize safely instead of breaking the UI
- the legacy startup dependency and inactive provider path were removed

## Current routing behavior

- `research` routes to `gpt-5.4`
- `implementation` routes to `gpt-5.3-codex-spark`
- `review` routes to `gpt-5.4`
- `debug` currently routes to `gpt-5.4`
- orchestration/planning-style prompts route to `gpt-5.4`
- general fallback prefers `gpt-5.4`

## Follow-up review items

The migration itself is complete. The next layer of work is behavior tuning:

1. review whether `debug` should stay on `gpt-5.4` by default or split further
2. tighten task-profile heuristics for ambiguous prompts
3. evaluate whether `auto` should become more task-mode driven and less keyword heuristic
4. review whether the command UI communicates selected and resolved model identity clearly enough
5. revisit validation enforcement and sub-agent cancellation as separate runtime concerns

## Validation completed

- `npm run build`
- `npm test`

## Current source of truth

- [src/main/agent/AgentModelService.ts](/home/dp/Desktop/v2workspace/src/main/agent/AgentModelService.ts)
- [src/main/agent/providerRouting.ts](/home/dp/Desktop/v2workspace/src/main/agent/providerRouting.ts)
- [src/main/agent/taskProfile.ts](/home/dp/Desktop/v2workspace/src/main/agent/taskProfile.ts)
- [src/renderer/command/command.ts](/home/dp/Desktop/v2workspace/src/renderer/command/command.ts)
- [src/renderer/command/index.html](/home/dp/Desktop/v2workspace/src/renderer/command/index.html)
