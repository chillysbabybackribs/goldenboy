---
name: systematic-debugging
description: Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes. Enforces root-cause investigation before any attempted patch.
allowed-tools:
  - terminal.exec
  - terminal.status
  - filesystem.read
  - filesystem.search
  - repomap.find_symbol
  - repomap.neighbors
  - browser.get_console_events
  - browser.get_network_events
references:
  - src/main/agent/AgentToolExecutor.ts
  - docs/agent/contracts/tool-names.md
---

# Systematic Debugging

## Overview

Random fixes waste time and create new bugs. Quick patches mask underlying issues.

**Core principle:** ALWAYS find root cause before attempting fixes. Symptom fixes are failure.

## The Iron Law

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

If you have not completed Phase 1, you cannot propose fixes.

## When To Use

Use for ANY technical issue:
- Test failures (`terminal.test_repo`)
- Build failures (`terminal.build_repo`)
- Runtime errors (console logs, stack traces)
- Unexpected UI / browser behavior
- Performance problems

Use this **especially** when:
- Under time pressure (emergencies make guessing tempting).
- "Just one quick fix" seems obvious.
- You have already tried multiple fixes.
- You do not fully understand the issue.

## The Four Phases

You MUST complete each phase before proceeding to the next.

### Phase 1 — Root Cause Investigation

Before attempting any fix:

1. **Read the error message carefully.** Full stack trace, line numbers, error codes. The message often contains the exact solution. Use `filesystem.read` on the files cited in the trace.
2. **Reproduce consistently.** Exact steps. Does it happen every time? If not reproducible → gather more data, do not guess.
3. **Check recent changes.** `terminal.exec` → `git log -20 --oneline`, `git diff HEAD~5 -- <file>`. New dependencies, config changes, environmental differences.
4. **Gather evidence across component boundaries.** For multi-layer systems (renderer ↔ IPC ↔ main, or host ↔ app-server ↔ provider):
   - Log what enters each boundary and what exits.
   - Run ONCE to gather evidence showing WHERE it breaks.
   - Only then investigate that specific component.
5. **Trace data flow backward.** Where does the bad value originate? What called this with a bad value? Keep tracing up until you find the source. Fix at source, not at symptom. `repomap.find_symbol` + `repomap.neighbors` are your friends here.

### Phase 2 — Pattern Analysis

Find the pattern before fixing:

1. **Find working examples.** Locate similar working code in the same codebase. What works that is similar to what is broken?
2. **Compare against references.** Read the reference implementation completely — do not skim.
3. **Identify differences.** List every difference, however small. Do not assume "that cannot matter."
4. **Understand dependencies.** Config, environment, upstream contracts, required flags.

### Phase 3 — Hypothesis And Testing

Scientific method:

1. **Form a single hypothesis.** "I think X is the root cause because Y." Be specific.
2. **Test minimally.** Smallest possible change to test the hypothesis. One variable at a time.
3. **Verify before continuing.** Worked → Phase 4. Did not work → form a NEW hypothesis. Do not stack fixes.
4. **When you do not know, say so.** Do not pretend. Research more.

### Phase 4 — Implementation

Fix the root cause, not the symptom:

1. **Create a failing test case first.** Pair with the `test-driven-fix` skill where applicable.
2. **Implement a single fix.** One change at a time. No "while I am here" refactors.
3. **Verify the fix.** Target test passes. No other tests broken. Issue actually resolved. Use the `verification-before-completion` skill before claiming success.
4. **If the fix does not work, STOP.** Count attempts. After 3+ failed attempts, question the architecture rather than trying a fourth patch.

## Red Flags — STOP And Return To Phase 1

If you catch yourself thinking:

- "Quick fix for now, investigate later."
- "Just try changing X and see if it works."
- "Add multiple changes, run tests."
- "It is probably X, let me fix that."
- "Pattern says X but I will adapt it differently."
- "One more fix attempt" (when already tried 2+).

All of these mean: return to Phase 1.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Issue is simple, do not need process" | Simple issues have root causes too. Process is fast for simple bugs. |
| "Emergency, no time for process" | Systematic debugging is FASTER than guess-and-check. |
| "Just try this first, then investigate" | First fix sets the pattern. Do it right from the start. |
| "I will write the test after confirming the fix" | Untested fixes do not stick. Test first proves it. |
| "Multiple fixes at once saves time" | Cannot isolate what worked. Causes new bugs. |
| "Reference too long, I will adapt the pattern" | Partial understanding guarantees bugs. |

## Quick Reference

| Phase | Key Activities | Success Criteria |
|-------|----------------|------------------|
| 1. Root Cause | Read errors, reproduce, check changes, trace data flow | Understand WHAT and WHY |
| 2. Pattern | Find working examples, compare, identify diffs | Identify exact deltas |
| 3. Hypothesis | Form theory, test minimally | Confirmed or new hypothesis |
| 4. Implementation | Failing test, fix, verify | Bug resolved, tests pass |

## Related Skills

- `test-driven-fix` — write the failing test before fixing.
- `verification-before-completion` — verify fix before claiming success.
- `local-debug` — Goldenboy-specific build / terminal harness commands.
