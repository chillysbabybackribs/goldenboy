---
name: local-debug
description: Use when the task requires running a build, checking app startup, inspecting terminal output, or diagnosing runtime failures in the local workspace.
allowed-tools:
  - terminal.build_repo
  - terminal.test_repo
  - terminal.exec
  - terminal.spawn
  - terminal.kill
  - terminal.status
  - filesystem.read
  - filesystem.patch
references:
  - package.json
  - tsconfig.json
  - tsconfig.main.json
  - tsconfig.preload.json
  - tsconfig.renderer.json
  - src/main/main.ts
  - src/main/ipc/registerIpc.ts
  - src/main/events/eventRouter.ts
---

# Local Debug

Use this skill when a task requires running builds, checking app startup, inspecting terminal output, or diagnosing runtime failures.

## Workflow

1. Run the narrowest build or check that can expose the issue.
2. Capture the exact failure.
3. Patch the owning file.
4. Re-run the same check.
5. If Electron is launched for smoke testing, stop spawned processes before finishing.

## Rules

- This skill governs debugging procedure only. It does not decide whether the task should remain analysis-only or escalate into edits.
- Prefer `terminal.build_repo` or `terminal.test_repo` when the task is specifically build/test verification.
- Keep debug loops narrow: reproduce, inspect, patch, rerun the same check.

## Preferred Tools

- `terminal.build_repo`
- `terminal.test_repo`
- `terminal.exec`
- `terminal.spawn`
- `terminal.kill`
- `terminal.status`
- `filesystem.read`
- `filesystem.patch`
