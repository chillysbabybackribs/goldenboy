# Local Debug

Use this skill when a task requires running builds, checking app startup, inspecting terminal output, or diagnosing runtime failures.

## Relevant Files

- `package.json`
- `tsconfig.json`
- `tsconfig.main.json`
- `tsconfig.preload.json`
- `tsconfig.renderer.json`
- `src/main/main.ts`
- `src/main/ipc/registerIpc.ts`
- `src/main/events/eventRouter.ts`

## Workflow

1. Run the narrowest build or check that can expose the issue.
2. Capture the exact failure.
3. Patch the owning file.
4. Re-run the same check.
5. If Electron is launched for smoke testing, stop spawned processes before finishing.

## Preferred Tools

- `terminal.exec`
- `terminal.spawn`
- `terminal.kill`
- `filesystem.read`
- `filesystem.patch`
