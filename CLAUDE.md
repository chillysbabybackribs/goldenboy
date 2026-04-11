# CLAUDE.md

Use `AGENT.md` as the canonical instruction file for this repository.

`CLAUDE.md` exists as a compatibility entrypoint for Claude-family models and tools. The app-level contract, file map, tool rules, and sub-agent rules are maintained in `AGENT.md`.

When wiring Haiku 4.5, load `AGENT.md` first, then task-relevant files from `skills/`.
