# Test-Driven Fix

Use this skill when a task involves a failing test, a regression, or any change that should be verified by running specific tests.

## Workflow

1. **Run the failing test first** — run the narrowest scope that captures the failure:
   - Single file: `npx vitest run path/to/file.test.ts`
   - Named test: `npx vitest run path/to/file.test.ts -t "test name"`
   - Never run all tests as the first step.
2. **Read the failure** — parse the exact error message and stack trace. Note the file and line number where the assertion fails, not where it is called from.
3. **Read only relevant files** — read the test file and the implementation file named in the stack trace. Do not read the whole module tree.
4. **Patch** — apply the minimal fix. Do not change test expectations unless the test itself is wrong and the task explicitly says so.
5. **Re-run the same test** — confirm the specific test now passes.
6. **Run the full file** — run all tests in the same file to check for regressions introduced by the patch.
7. **Stop** — do not run the full test suite unless the task requires it or the file-level run fails.

## Rules

- The test output is the source of truth. Do not reason about what the code "should" do if the test says otherwise.
- If a test cannot pass without changing the test, explain why before touching the test.
- Never silence a test failure by skipping or commenting it out.

## Preferred Tools

- `terminal.exec` (vitest invocations)
- `filesystem.read_file_chunk`
- `filesystem.search_file_cache`
- `filesystem.patch`
- `filesystem.read`
