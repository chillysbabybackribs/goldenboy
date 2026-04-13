# Full Audit Plan

## Objective
Produce a verified end-to-end audit of the V2 agent stack, focusing on correctness, model/provider behavior, runtime enforcement, tool execution, and any gaps between intended architecture and observed implementation.

## Scope
This audit is full-system for the agent path, not a blind line-by-line review of the entire product. The primary scope is:
- provider and model routing
- prompt construction and system addenda
- runtime tool execution and result handling
- deterministic validation enforcement
- browser, filesystem, and terminal runtime contracts
- sub-agent lifecycle and result integration
- UI state that can change provider, model, or execution behavior
- configuration, persistence, and fallbacks that affect the above

Out of scope unless they directly affect the agent path:
- unrelated product features
- purely presentational UI work
- non-agent business logic

## Deliverables
- architecture map of the real execution path
- verified findings with file references and severity
- mismatch list: intended contract vs implemented behavior
- risk register for correctness, safety, and operability
- prioritized remediation plan

## Audit Phases

### 1. Scope Lock And Inventory
Goal: freeze the exact surfaces that participate in the agent stack.
Actions:
- identify the entrypoints from UI action to runtime invocation
- enumerate provider, routing, prompt, tool, validation, and sub-agent modules
- note any config files, storage keys, feature flags, and IPC boundaries that can alter behavior
Output:
- module inventory
- dependency map for the audit path

### 2. Runtime Path Verification
Goal: verify the real execution flow against the intended V2 runtime contract.
Actions:
- trace the path from user task creation through provider selection, prompt build, tool execution, and result handling
- confirm where browser/filesystem/terminal tools are invoked and recorded
- verify whether sub-agents use the same runtime path or diverge
Output:
- observed end-to-end execution diagram
- confirmed control points and bypass risks

### 3. Provider And Model Strategy Audit
Goal: determine how provider choice, model choice, and system addenda actually work.
Actions:
- inspect provider routing logic
- inspect model selection logic per provider
- verify whether Codex is a fixed transport or supports model-level selection
- verify whether system prompt addenda change behavior only at prompt level or also at routing level
Output:
- provider/model decision table
- confirmed gaps between UI intent and runtime behavior

### 4. Prompt Construction Audit
Goal: verify what the model actually receives and whether prompt layers are coherent.
Actions:
- inspect prompt builder inputs and composition order
- verify how system instructions, runtime instructions, skill content, and task context are merged
- identify duplicated, contradictory, or non-binding prompt instructions
Output:
- prompt composition map
- list of prompt-only controls masquerading as hard guarantees

### 5. Tool Execution And Validation Audit
Goal: determine whether tool use and validation are enforced by runtime or only described in prompts.
Actions:
- inspect tool execution pipeline and tool result normalization
- inspect handling of runtime validation blocks
- verify whether INVALID and INCOMPLETE results can still be surfaced as success
- verify error propagation, retry behavior, and cancellation handling
Output:
- enforcement matrix for tool and validation guarantees
- findings on advisory vs deterministic enforcement

### 6. Browser, Filesystem, And Terminal Contract Audit
Goal: confirm whether the host tools match the documented operating model.
Actions:
- inspect browser ownership, caching, extraction, and research flow handling
- inspect filesystem indexing, cache use, bounded reads, and edit paths
- inspect terminal execution, spawned process tracking, and verification behavior
- verify whether the runtime contract is actually encoded in tool policy or only described in prompts
Output:
- contract compliance notes for each tool family
- missing enforcement or observability gaps

### 7. Sub-Agent Audit
Goal: verify lifecycle guarantees for delegated work.
Actions:
- inspect spawn path, inheritance of context, tool scope, and mode
- verify run records, cancellation, summaries, and final result handling
- identify recursion limits, isolation failures, or result-trust issues
Output:
- sub-agent lifecycle map
- risk list for delegation correctness

### 8. UI State And Persistence Audit
Goal: verify whether user-facing controls actually affect runtime behavior.
Actions:
- inspect model/provider toggles, selected owner state, zoom/state persistence, and any execution-affecting preferences
- trace stored values into runtime services
- identify dead controls, misleading labels, or state that never reaches execution
Output:
- UI-to-runtime binding table
- findings on misleading or disconnected controls

### 9. Evidence Consolidation
Goal: convert raw observations into defensible findings.
Actions:
- group findings by severity: critical, high, medium, low
- attach concrete file references and execution-path evidence
- distinguish verified fact from inference
- mark anything unverified as open question, not conclusion
Output:
- prioritized findings list
- open questions and required follow-up checks

### 10. Final Report
Goal: produce a decision-ready audit result.
Actions:
- summarize architecture reality vs intended design
- present top risks, likely regressions, and misleading guarantees
- recommend fixes in dependency order
- separate fast tactical fixes from structural changes
Output:
- final audit report
- remediation sequence

## Core Questions To Answer
- Where is provider routing decided, and is it deterministic?
- Where is model selection decided, and is it real or cosmetic?
- Which runtime guarantees are truly enforced in code?
- Which guarantees exist only in prompts or comments?
- Can invalid tool outcomes be reported as success?
- Do UI controls reliably change runtime behavior?
- Are sub-agents isolated, tracked, and validated correctly?
- Where are the biggest correctness and trust gaps in the current design?

## Evidence Standard
A conclusion is valid only if it is backed by at least one of:
- direct source inspection with file reference
- observed runtime path or tool record
- deterministic validation behavior in code

Do not elevate assumptions into findings. Mark inferred behavior explicitly.

## Completion Criteria
The audit is complete when:
- every major agent-path surface in scope has been inspected
- each important claim has a source reference or explicit unverified status
- the final report distinguishes implementation reality from prompt intent
- the remediation list is ordered by impact and dependency
- SAVE THE REPORT TO THE ROOT DIRECOTRY when completed 
