---
name: typescript-typecheck
description: Use when the task involves TypeScript errors, type mismatches, missing types, or any change to typed interfaces, function signatures, or shared types.
allowed-tools:
  - terminal.exec
  - terminal.build_repo
  - filesystem.read_file_chunk
  - filesystem.search_file_cache
  - filesystem.patch
  - filesystem.read
references:
  - tsconfig.json
  - tsconfig.main.json
  - tsconfig.preload.json
  - tsconfig.renderer.json
  - src/shared/types/
---

# TypeScript Typecheck

Use this skill when a task involves TypeScript errors, type mismatches, missing types, or any change to typed interfaces, function signatures, or shared types.

## Workflow

1. Run the narrowest typecheck that covers the changed file(s):
   - Single file: `npx tsc -p tsconfig.main.json --noEmit 2>&1 | grep "src/main/path/to/file"`
   - Changed process: `npx tsc -p tsconfig.main.json --noEmit` (or preload / renderer as appropriate)
   - Full check: `npm run build` only when cross-process types are in question
2. Parse the error list — file path, line number, message.
3. Read only the specific lines named in each error. Do not read whole files unless the error spans a type import chain.
4. Patch the owning file at the exact location.
5. Re-run the same scoped typecheck.
6. Repeat until output is clean.
7. Do not widen types (`any`, `unknown` casts) to silence errors — fix the root mismatch.

## Rules

- This skill governs typecheck procedure only. It does not decide whether the task should stay plan-only or perform edits.
- Prefer scoped `tsc` runs before full builds when the failure surface is local.
- Use `npm run build` only when cross-process typing or final verification is actually needed.

## Preferred Tools

- `terminal.exec` (tsc invocations)
- `filesystem.read_file_chunk`
- `filesystem.search_file_cache`
- `filesystem.patch`
- `filesystem.read`
