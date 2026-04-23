---
name: brainstorming
description: Use before any creative or design work - creating features, building components, adding functionality, or modifying behavior when intent or requirements are ambiguous. Explores user intent and constraints before implementation.
allowed-tools:
  - filesystem.read
  - filesystem.search
  - repomap.overview
  - repomap.find_symbol
  - repomap.neighbors
  - workspace.overview
references:
  - AGENTS.md
  - docs/agent/contracts/tool-names.md
---

# Brainstorming

## Overview

Premature implementation locks in the wrong design. Ambiguous requirements produce code that the user will reject.

**Core principle:** Understand intent, constraints, and the existing surface BEFORE writing or editing code.

## When To Use

Load this skill when:

- The user asks for a feature but the exact behaviour, UI, or data flow is not specified.
- The task touches an area of the codebase you have not yet explored.
- Multiple plausible implementations exist and picking wrong would waste a turn.
- The user uses words like "add", "build", "design", "what if", "we should", or "let's".

Do not load this skill for:

- Narrow, obvious tasks (typo, rename, single-line bugfix).
- Tasks where the user has already specified exact files and behaviour.

## The Four Steps

### Step 1 — Restate The Goal

In one sentence, say what you think the user wants. Include the outcome, not the mechanism.

> "You want a button on the chat header that clears the current conversation and starts a fresh one, keeping the provider / project selection intact."

If this restatement is wrong, the user will tell you now — cheap — instead of after an implementation.

### Step 2 — Surface Unknowns

List the real ambiguities. Do not invent them.

- What exactly does "clear the conversation" mean — delete, archive, or just hide?
- Should it be confirmed, or instant?
- Does it reset the sub-agent tree too?
- Which keyboard shortcut, if any?

Ask only the questions that would change the implementation. Batch them.

### Step 3 — Map The Existing Surface

Before proposing a design, understand what already exists.

- `workspace.overview` / `repomap.overview` for a sense of the repo.
- `filesystem.search` for the nearest existing feature that does something similar.
- `repomap.find_symbol` on the relevant types / stores / IPC handlers.
- `filesystem.read` on 1–3 of the most central files — do not skim.

Note the existing conventions: how other features talk to main, how state flows through the store, how tests are structured. The new feature must match.

### Step 4 — Propose Options, Then Pick

Present 1–3 concrete options. For each option: mechanism in one line, trade-off in one line. Pick the one you recommend and say why. Then wait for confirmation OR proceed if the user has explicitly asked you to "just do it."

```
Option A: New IPC handler + store reducer. Clean, matches existing pattern. Touches 3 files.
Option B: Renderer-local reset only. Fastest. Loses parity with `conversation.reset` in main.
Recommend A.
```

## Red Flags — STOP And Brainstorm First

- You have started editing files and you still cannot state the goal in one sentence.
- You are about to add a second mechanism that does what an existing one already does.
- You found yourself guessing about what "simple" means.
- The user's request contains "or something like that."

## Rationalization Prevention

| Excuse | Reality |
|--------|---------|
| "It is obvious what they want" | If it were obvious, you could restate it in one sentence. Try. |
| "I will figure it out while coding" | Code written during exploration is usually thrown away. |
| "Asking questions is slow" | One question now beats a rewrite later. |
| "I should show initiative" | Initiative on the wrong target is wasted work. |

## Output Shape

The end state of a brainstorming turn is a short message that contains:

1. Restated goal.
2. Questions (if any).
3. Proposed approach (1–3 options, recommendation).
4. Explicit next step ("ready to implement Option A — confirm?" or "answer the questions above and I will proceed").

No code yet.

## Related Skills

- `code-edit` — load after brainstorming, when the plan is locked.
- `filesystem-operation` — for the exploration phase.
- `subagent-coordination` — when the work is large enough to split into parallel streams.
