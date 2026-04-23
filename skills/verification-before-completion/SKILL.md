---
name: verification-before-completion
description: Use when about to claim work is complete, fixed, or passing, before handing back to the user or committing. Run the real verification command and read its output before asserting success.
allowed-tools:
  - terminal.exec
  - terminal.test_repo
  - terminal.build_repo
  - filesystem.read
references:
  - docs/agent/contracts/tool-names.md
---

# Verification Before Completion

## Overview

Claiming work is complete without verification is dishonesty, not efficiency.

**Core principle:** Evidence before claims, always.

## The Iron Law

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

If you have not run the verification command in this turn, you cannot claim it passes.

## The Gate Function

```
BEFORE claiming any status or expressing satisfaction:

1. IDENTIFY the command that proves the claim.
2. RUN the FULL command (fresh, complete) via terminal tools.
3. READ the full output. Check exit code. Count failures.
4. VERIFY the output actually confirms the claim.
   - If NO: state the actual status with evidence.
   - If YES: state the claim WITH evidence (exit code, pass counts, diff summary).
5. ONLY THEN make the claim.

Skipping any step is lying, not verifying.
```

## Common Failures

| Claim | Requires | Not Sufficient |
|-------|----------|----------------|
| Tests pass | Test command output: 0 failures | Previous run, "should pass" |
| Linter clean | Linter output: 0 errors | Partial check, extrapolation |
| Build succeeds | Build command: exit 0 | Lint passing, logs look good |
| Bug fixed | Test original symptom: passes | Code changed, assumed fixed |
| Regression test works | Red-green cycle verified | Test passes once |
| Sub-agent completed | VCS diff shows real changes | Sub-agent said "success" |
| Requirements met | Line-by-line checklist | Tests passing |

## Red Flags — STOP

- Using "should," "probably," "seems to."
- Expressing satisfaction before verification ("Great!", "Perfect!", "Done!").
- About to hand the turn back / open a PR without verification.
- Trusting a sub-agent success report without checking the diff.
- Relying on partial verification (only ran one test).
- Thinking "just this once."
- Tired and wanting work over.

## Rationalization Prevention

| Excuse | Reality |
|--------|---------|
| "Should work now" | RUN the verification. |
| "I am confident" | Confidence ≠ evidence. |
| "Just this once" | No exceptions. |
| "Linter passed" | Linter ≠ compiler. |
| "Agent said success" | Verify independently (git diff, run tests). |
| "Partial check is enough" | Partial proves nothing. |

## Key Patterns

**Tests:**

```
OK:  terminal.test_repo → 34/34 pass → "All tests pass (34/34, exit 0)"
BAD: "Should pass now" / "Looks correct"
```

**Regression tests (red-green):**

```
OK:  Write test → run (pass) → revert fix → run (MUST FAIL) → restore → run (pass)
BAD: "I have written a regression test" (no red-green cycle)
```

**Build:**

```
OK:  terminal.build_repo → exit 0 → "Build passes (exit 0)"
BAD: "Linter passed" (linter does not check compilation)
```

**Requirements:**

```
OK:  Re-read the plan → create a checklist → verify each item → report gaps or completion
BAD: "Tests pass, phase complete"
```

**Sub-agent delegation:**

```
OK:  Sub-agent reports success → git status / git diff → verify actual changes → report actual state
BAD: Trust the sub-agent report
```

## When To Apply

Always, before:

- Any variation of success / completion claims.
- Any expression of satisfaction.
- Any positive statement about work state.
- Committing, PR creation, task completion.
- Moving to the next task.
- Handing work back to the user.

Applies to exact phrases, paraphrases, synonyms, and any implication of success.

## The Bottom Line

Run the command. Read the output. THEN claim the result. Non-negotiable.
