# Code Edit

Use this skill when a task requires reading, patching, or writing source files. Applies to any file change — single-line fix, new function, or multi-file refactor.

## Workflow

1. **Locate** — use cache search before broad reads:
   - `filesystem.search_file_cache` to find relevant chunks by keyword
   - `filesystem.answer_from_cache` for targeted questions about the codebase
   - `filesystem.index_workspace` if the cache is empty or stale
2. **Read narrowly** — read only the chunk ids or line ranges relevant to the edit. Avoid reading whole files unless the patch context genuinely requires it.
3. **Patch** — apply the smallest edit that satisfies the task. Do not reformat, reorganize, or clean up surrounding code unless the task explicitly asks.
4. **Verify** — after patching, read back the changed lines to confirm the patch applied correctly.
5. **Typecheck** — if the changed file is TypeScript, run a scoped `tsc --noEmit` (see typescript-typecheck skill). Do not skip this step.
6. **Report** — state the changed paths and what changed. Nothing else.

## Rules

- Read before editing. Never patch from memory or assumption.
- Scope patches to the task. Do not touch adjacent code that is not broken.
- Do not introduce `any` types, commented-out code, or `TODO` stubs as deliverables.

## Preferred Tools

- `filesystem.index_workspace`
- `filesystem.answer_from_cache`
- `filesystem.search_file_cache`
- `filesystem.read_file_chunk`
- `filesystem.list_cached_files`
- `filesystem.search`
- `filesystem.read`
- `filesystem.patch`
- `filesystem.write`
- `terminal.exec` (for tsc verification)
