# Grounding Gate Implementation Plan

> Historical note: this plan was written during a broader multi-provider transition. The shipped runtime is now Codex-only; provider comparisons and future-provider language here are historical context.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it structurally impossible for the primary model runtime to finalize a task with claims that are not backed by a PASS-validated tool result.

**Architecture:** Add a new terminal tool `answer.submit` that the model must call to finalize. The tool accepts a structured `FinalAnswer` (claims with evidence_ids + unresolved list) and runs a deterministic grounding check against the run's existing `ResultValidation` history from `agentRunStore`. A failed gate returns a structured revision prompt via the normal tool-result path — no new runtime surface, no second model, no provider-specific code.

**Tech Stack:** TypeScript, existing Vitest test harness, existing `AgentToolExecutor`/`ConstraintValidator`/`agentRunStore` infrastructure.

---

## Non-Goals (v1)

- No second model (no Codex reviewer, no Gemini critic).
- No pre-task planning pass — that is the next design conversation.
- No enforcement that the model *must* call `answer.submit` — in v1 it is available and instructed; we measure uptake before tightening.
- No quote-verification against cached source chunks (the check that `evidence.quote` literally appears in the cached chunk it cites). Deferred to v2.
- No UI changes beyond rendering the structured answer as prose with inline citation markers when present.

## Integration Map

| File | Status | Responsibility |
|---|---|---|
| `src/shared/types/finalAnswer.ts` | **new** | `FinalAnswerClaim`, `FinalAnswer`, `GroundingVerdict` types. Shared so renderer can consume later. |
| `src/main/agent/GroundingGate.ts` | **new** | Pure function `checkGrounding(finalAnswer, validationByCallId)` → `GroundingVerdict`. No I/O. |
| `src/main/agent/GroundingGate.test.ts` | **new** | Vitest coverage for the gate: PASS, FAIL-missing-ref, FAIL-incomplete-evidence, FAIL-invalid-evidence, unresolved-only is PASS. |
| `src/main/agent/tools/answerSubmit.ts` | **new** | `AgentToolDefinition` for `answer.submit`. Calls `GroundingGate`, reads validations from `agentRunStore`. |
| `src/main/agent/tools/answerSubmit.test.ts` | **new** | Integration test: seed `agentRunStore` with tool calls + validations, call the tool, assert PASS/FAIL pass-through. |
| `src/main/agent/AgentTypes.ts` | **modify** | Add `'answer.submit'` to `AgentToolName`. Add optional `finalAnswer?: FinalAnswer` to `AgentProviderResult`. |
| `src/main/agent/AgentToolExecutor.ts` | **modify** | Register the new tool. No execution-path changes. |
| `src/main/agent/AgentPromptBuilder.ts` | **modify** | Add a "Finalizing your answer" section instructing the model to call `answer.submit` and explaining the schema. |
| `src/main/agent/AgentPromptBuilder.test.ts` | **modify** | Assert the new section appears when `answer.submit` is in scope. |
| `src/main/agent/AgentRuntime.ts` | **modify** | After `provider.invoke()` returns, if the run recorded a successful `answer.submit` tool call, extract its `FinalAnswer` and attach to `AgentProviderResult.finalAnswer`; replace `output` with a prose rendering of it. |
| `src/main/agent/AgentRunStore.ts` | **modify (read-only additions)** | Add a `findLatestToolCall(runId, toolName)` query helper. No schema change. |

## Task Breakdown

### Task 1: Types for the structured final answer

**Files:**
- Create: `src/shared/types/finalAnswer.ts`

- [ ] **Step 1: Write the type module**

```typescript
// src/shared/types/finalAnswer.ts

/**
 * Reference to a prior tool call in the same run that produced the evidence
 * backing a claim. The id matches `AgentToolCallRecord.id` in `agentRunStore`.
 */
export type EvidenceRef = {
  toolCallId: string;
  /** Short verbatim quote or value observed in that tool's output. */
  quote: string;
};

export type FinalAnswerClaim = {
  /** User-visible prose for this claim. May be a sentence or a paragraph. */
  text: string;
  /** At least one evidence_ref required. Empty arrays are rejected by the gate. */
  evidence: EvidenceRef[];
};

export type FinalAnswerUnresolved = {
  question: string;
  reason: string;
};

export type FinalAnswer = {
  claims: FinalAnswerClaim[];
  unresolved: FinalAnswerUnresolved[];
};

export type GroundingIssue =
  | { kind: 'missing_evidence'; claimIndex: number }
  | { kind: 'unknown_tool_call'; claimIndex: number; toolCallId: string }
  | { kind: 'tool_call_not_valid'; claimIndex: number; toolCallId: string; validationStatus: 'INVALID' | 'INCOMPLETE' }
  | { kind: 'tool_call_failed'; claimIndex: number; toolCallId: string };

export type GroundingVerdict =
  | { status: 'PASS' }
  | { status: 'FAIL'; issues: GroundingIssue[] };
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/types/finalAnswer.ts
git commit -m "feat(agent): add FinalAnswer and GroundingVerdict types"
```

---

### Task 2: Pure `GroundingGate` with full test coverage (TDD)

**Files:**
- Create: `src/main/agent/GroundingGate.test.ts`
- Create: `src/main/agent/GroundingGate.ts`

- [ ] **Step 1: Write failing tests first**

Tests cover the five cases the gate must handle: all-PASS evidence → PASS; missing evidence array → FAIL; evidence_ref pointing to non-existent tool call → FAIL; evidence_ref pointing to an INCOMPLETE/INVALID tool call → FAIL; answer with only `unresolved` and no claims → PASS (legitimate "I could not ground this" case).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/main/agent/GroundingGate.test.ts`
Expected: all five tests fail with "module not found".

- [ ] **Step 3: Implement `GroundingGate.ts`**

Pure function. Input: `FinalAnswer` + `Map<toolCallId, { status: AgentToolStatus, validation: ResultValidation | null }>`. Output: `GroundingVerdict`. Walks each claim, checks every evidence_ref against the map, collects issues. Returns PASS only when every claim has at least one evidence_ref pointing to a `completed` tool call whose validation is either absent (no constraints applicable) or `VALID`.

- [ ] **Step 4: Run tests and verify pass**

Run: `npm test -- src/main/agent/GroundingGate.test.ts`
Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/GroundingGate.ts src/main/agent/GroundingGate.test.ts
git commit -m "feat(agent): add GroundingGate deterministic validator"
```

---

### Task 3: `answer.submit` tool definition (TDD)

**Files:**
- Modify: `src/main/agent/AgentTypes.ts` (add `'answer.submit'` to `AgentToolName`)
- Create: `src/main/agent/tools/answerSubmit.ts`
- Create: `src/main/agent/tools/answerSubmit.test.ts`
- Modify: `src/main/agent/AgentRunStore.ts` (add `getToolCallsForRun(runId)` if not already present)

- [ ] **Step 1: Write failing tests first**

Tests: (a) happy path — seed store with a `completed` tool call whose `validation.status === 'VALID'`, submit a claim pointing to it → tool returns `{ summary: 'answer accepted', data: { verdict: { status: 'PASS' }, finalAnswer } }`; (b) failure path — evidence_ref points to a tool call with `validation.status === 'INCOMPLETE'` → tool returns a result whose `summary` begins with `GROUNDING FAIL` and `data.verdict.issues` contains the `tool_call_not_valid` issue; (c) unknown tool_call_id → `unknown_tool_call` issue.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- src/main/agent/tools/answerSubmit.test.ts`
Expected: fail with missing module.

- [ ] **Step 3: Implement the tool**

Input schema: matches `FinalAnswer`. Execution: reads `agentRunStore.getToolCallsForRun(context.runId)`, builds the validation map, calls `GroundingGate.checkGrounding(input, map)`. On PASS: returns `{ summary: 'answer accepted', data: { verdict, finalAnswer: input } }`. On FAIL: returns `{ summary: 'GROUNDING FAIL — revise: ...', data: { verdict } }` with a human-readable revision directive for the model.

- [ ] **Step 4: Add `AgentToolName` literal and register tool**

Edit `AgentTypes.ts` to include `'answer.submit'` in the union. Wire registration wherever `AgentToolExecutor` builds its default registry.

- [ ] **Step 5: Run tests and verify pass**

Run: `npm test -- src/main/agent/tools/answerSubmit.test.ts`
Expected: 3/3 pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/tools/answerSubmit.ts src/main/agent/tools/answerSubmit.test.ts src/main/agent/AgentTypes.ts src/main/agent/AgentRunStore.ts
git commit -m "feat(agent): add answer.submit tool gated by GroundingGate"
```

---

### Task 4: Extend `AgentProviderResult` and surface the structured answer

**Files:**
- Modify: `src/main/agent/AgentTypes.ts` (add `finalAnswer?: FinalAnswer` to `AgentProviderResult`)
- Modify: `src/main/agent/AgentRuntime.ts` (extract the submitted answer after `provider.invoke()` and surface it)
- Modify: `src/main/agent/AgentRuntime.test.ts` (new test for the extraction path)

- [ ] **Step 1: Write the failing runtime test**

Test: stub a provider that calls `answer.submit` via the executor during `invoke()`, then returns. Assert that `AgentRuntime.run()` returns a result with `finalAnswer` set and `output` rendered as prose from the claims.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- src/main/agent/AgentRuntime.test.ts`
Expected: fail — `finalAnswer` is undefined.

- [ ] **Step 3: Implement the extraction**

After `provider.invoke()` returns, query `agentRunStore.getToolCallsForRun(run.id)` for the most recent successful `answer.submit` call. If present, read its result's `data.finalAnswer` and set `result.finalAnswer`; render `output` as a plain-text join of claim texts with `[ref:<shortId>]` citation markers, followed by an "Unresolved:" section if `unresolved.length > 0`. If absent, leave `output` unchanged (v1 shadow fallback — prose-only runs still work).

- [ ] **Step 4: Run tests and verify pass**

Run: `npm test -- src/main/agent/AgentRuntime.test.ts`
Expected: all existing + new tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/AgentTypes.ts src/main/agent/AgentRuntime.ts src/main/agent/AgentRuntime.test.ts
git commit -m "feat(agent): surface FinalAnswer on AgentProviderResult"
```

---

### Task 5: Prompt instruction for `answer.submit`

**Files:**
- Modify: `src/main/agent/AgentPromptBuilder.ts`
- Modify: `src/main/agent/AgentPromptBuilder.test.ts`

- [ ] **Step 1: Write failing prompt test**

Test: when `answer.submit` is in the scoped tool list, `buildSystemPrompt` includes a section titled `## Finalizing Your Answer` containing: the tool name, the rule that every claim must carry `evidence` referencing prior tool calls, and the `unresolved` escape hatch.

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- src/main/agent/AgentPromptBuilder.test.ts`
Expected: fail — section missing.

- [ ] **Step 3: Implement the prompt section**

Add a dedicated builder method for the finalization instructions. Content must:
- Tell the model to end the task by calling `answer.submit` with `{ claims, unresolved }`
- Require every `claim.evidence` entry to reference a real prior tool call id
- State the `unresolved` field is the honest path when a fact could not be grounded
- Warn that calling `answer.submit` with ungrounded claims will fail the gate and force revision

Ship it in v1 as a normal prompt instruction, not a hard requirement. Measure uptake in logs before making it mandatory.

- [ ] **Step 4: Run tests and verify pass**

Run: `npm test -- src/main/agent/AgentPromptBuilder.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/AgentPromptBuilder.ts src/main/agent/AgentPromptBuilder.test.ts
git commit -m "feat(agent): instruct models to finalize via answer.submit"
```

---

### Task 6: End-to-end smoke test with a fake provider

**Files:**
- Create: `src/main/agent/groundingGate.e2e.test.ts`

- [ ] **Step 1: Write the e2e test**

Using the same test harness pattern as `AgentRuntime.test.ts`, set up a fake provider that invokes two tool calls (one `terminal.exec` that passes validation, one that comes back INCOMPLETE), then calls `answer.submit` with claims referencing both. Assert:
- The gate returns a FAIL verdict listing the INCOMPLETE reference
- The run output surfaces the revision prompt instead of accepting the answer

Then run a second scenario where the model, on seeing the revision, re-submits with only the VALID reference — and the run completes with `finalAnswer` set.

- [ ] **Step 2: Run and verify pass**

Run: `npm test -- src/main/agent/groundingGate.e2e.test.ts`
Expected: both scenarios pass.

- [ ] **Step 3: Commit**

```bash
git add src/main/agent/groundingGate.e2e.test.ts
git commit -m "test(agent): e2e grounding gate gates INCOMPLETE evidence"
```

---

### Task 7: Full suite + type check

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all green, no new type errors.

- [ ] **Step 2: Run the build**

Run: `npm run build`
Expected: clean compile, no TS errors.

- [ ] **Step 3: Final commit if anything needs tidying**

```bash
git status
# If clean, no commit needed. Otherwise, fix and commit.
```

---

## Open Questions for Review Before Implementation

1. **Tool name:** `answer.submit` vs `answer.finalize` vs `task.finalize`. I prefer `answer.submit` because "submit" communicates that the runtime owns what happens next; the model is handing off, not declaring.
2. **Claim → tool-call reference shape:** using `AgentToolCallRecord.id` (the runtime's own id) means the model needs to know these ids. Haiku sees them in tool result metadata, but we should confirm the Haiku/Codex/Gemini providers all expose tool call ids in a way the model can reference back. Alternative: use stable per-run indices (1, 2, 3, ...) which every provider sees naturally.
3. **Strict vs shadow in v1:** the plan above makes `answer.submit` optional (fallback to prose). If you'd rather start strict — the runtime rejects prose-only completions and forces one repair turn — say so and I'll tighten Task 4 accordingly. My recommendation is shadow first; flip to strict after one week of uptake data.
4. **Rendering format for `output`:** I'm defaulting to a simple join with `[ref:<shortId>]` markers. If you want richer markup (e.g. footnote-style), we can pick a format now or defer to a renderer-layer task.

## Self-Review

**Spec coverage:**
- Structured output contract → Task 1 (types), Task 3 (tool), Task 5 (prompt).
- Deterministic grounding gate → Task 2 (pure gate), Task 3 (tool integration).
- Provider-agnostic by construction → Tasks operate at the tool and runtime layer, no provider-specific code.
- Consumes existing `ResultValidation` → Task 2 reads validation status from the gate input; Task 3 builds that input from `agentRunStore`.
- Honest "unresolved" escape hatch → Task 1 types, Task 5 prompt.
- Does not break prose-only runs → Task 4 leaves `output` unchanged when no `answer.submit` fires.

**Placeholder scan:** no TBDs, no "handle edge cases" — every task specifies which tests and what shape the implementation takes. Exact file paths throughout.

**Type consistency:** `FinalAnswer` / `FinalAnswerClaim` / `EvidenceRef` / `GroundingVerdict` are defined once in Task 1 and referenced consistently in Tasks 2–4. `GroundingGate.checkGrounding` signature stable across Tasks 2, 3, 6.
