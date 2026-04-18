# Silent Chat Context Hydration Implementation Plan

## Overview

**Goal**: Implement automatic, lazy-loaded chat context injection into model prompts **without any visible traces or announcements**. The runtime detects when prior conversation context is needed and silently injects it into the system/context prompt just before invoking the model.

**Key Principles**:
1. **Full history persisted** — all messages cached to disk by `ChatKnowledgeStore`
2. **Silent injection** — no "I'm reading..." messages, no metadata, context just appears in prompt
3. **Lazy evaluation** — only load when needed, don't bloat every prompt
4. **Token-efficient** — load minimal context that satisfies the need, compress irrelevant details
5. **Invisible to model** — the model should not be told it's receiving hydrated context

---

## Current Architecture

### Where Context is Built (AgentModelService)
- **File**: `src/main/agent/AgentModelService.ts`
- **Line ~397**: `buildContextPrompt()` is called with parts array
- **Current flow**:
  ```
  buildContextPrompt([
    buildAutomaticTaskContinuationContext(taskId, prompt),
    includeConversationContext ? chatKnowledgeStore.buildInvocationContext(...) : null,
    includeTaskMemory ? taskMemoryStore.buildContext(taskId) : null,
    ...
  ])
  ```

### Where Chat Context is Currently Rendered
- **File**: `src/main/chatKnowledge/ChatKnowledgeStore.ts`
- **Method**: `buildInvocationContext(taskId, currentMessageId)`
- **Current behavior**:
  - Includes a visible header: `## Conversation Memory`
  - Adds descriptive text about chat.read_last, chat.search tools
  - Reads last 2 messages + current message + summary
  - **Problem**: This is too visible and static — it announces the hydration

### Chat Knowledge Store Methods
- `readLast()` — reads N most recent messages
- `search()` — searches by query with scoring
- `readMessage()` — reads specific message by ID
- `threadSummary()` — gets thread summary (if built)

---

## The Silent Hydration Pattern

### Phase 1: Detection (Pre-Prompt Build)
Before building the context prompt, the runtime should analyze:

1. **User message content** — does it reference prior context?
   - Pronouns: "it", "that", "the", "this"
   - Explicit refs: "earlier", "before", "previously", "last time"
   - Follow-ups: "yes", "no", "ok", "continue", "explain more"
   - Acronyms not defined in current message

2. **Task continuity** — is this a follow-up to a prior task?
   - Same taskId across multiple runs
   - Prior run in same session
   - Conversation context flag set

3. **Implicit context need** — does the task type require prior context?
   - Research continuation
   - Multi-step implementation
   - Debugging/troubleshooting

### Phase 2: Selective Loading (Lazy Hydration)
If detection signals prior context is needed:

1. **Load minimal context** — don't load everything
   - Prefer recent messages over old
   - Load thread summary (if available)
   - Load specific messages matching keywords (if search needed)

2. **Compress where possible**
   - Tool results → summary only (not full output)
   - Verbose responses → key takeaways
   - Repetitive sections → references ("as discussed earlier")

3. **No headings or markers**
   - Don't add "## Conversation Memory" header
   - Don't add "From earlier:" labels
   - Just include the text naturally

### Phase 3: Silent Injection (Into Prompt)
When building the system/context prompt:

1. **Inject into contextPrompt** (not visible as separate section)
   - Prepend prior context to contextPrompt, before new task context
   - No section dividers, no "from history" markers
   - Treat it as always-present background context

2. **Or inject as system context**
   - Could add to system prompt as implicit background
   - Would need to ensure it doesn't bloat system prompt

3. **Result**: Model receives context as if it was always there
   - No awareness of cache loading
   - No knowledge it's receiving injected history
   - Works seamlessly for follow-ups

---

## Implementation Steps

### Step 1: Create ChatHydrationDetector
**File**: `src/main/agent/ChatHydrationDetector.ts`

```typescript
export type HydrationNeed = 'full' | 'recent' | 'searched' | 'none';

export class ChatHydrationDetector {
  /**
   * Analyze user message to detect if prior context is needed.
   * Returns the type of hydration needed.
   */
  detectNeed(input: {
    userMessage: string;
    taskId: string;
    priorTaskExists: boolean;
    conversationMode: boolean;
  }): HydrationNeed {
    // Check for pronouns and follow-up indicators
    // Check for implicit references
    // Return 'full' | 'recent' | 'none'
  }

  /**
   * Extract keywords from user message that might need searched context.
   * Used for semantic search in chat history.
   */
  extractContextKeywords(userMessage: string): string[] {
    // Extract nouns, verbs, technical terms
    // Filter out stop words
  }
}
```

### Step 2: Enhance ChatKnowledgeStore with Silent Methods
**File**: `src/main/chatKnowledge/ChatKnowledgeStore.ts`

Add new methods that return context **without visible headers**:

```typescript
export class ChatKnowledgeStore {
  /**
   * Build silent hydration context: just the content, no metadata or headers.
   * Designed to be injected invisibly into contextPrompt.
   */
  buildSilentHydrationContext(taskId: string, input: {
    need: 'full' | 'recent' | 'searched';
    searchQuery?: string;
    maxChars?: number;
    excludeToolResults?: boolean;
  }): string | null {
    // Return raw message text + summaries, no "Conversation Memory" header
    // Compress tool results to summaries
    // Return null if nothing meaningful to inject
  }

  /**
   * Get thread summary as compact recap for injection.
   * (May need to enhance to build if missing)
   */
  getThreadSummaryForInjection(taskId: string): string | null {
    // Return just the summary text, no label
  }

  /**
   * Read recent messages in compact form for injection.
   */
  getRecentMessagesForInjection(taskId: string, input: {
    count?: number;
    maxChars?: number;
  }): string | null {
    // Return formatted messages without "Recent Prior Messages" header
  }
}
```

### Step 3: Integrate into AgentModelService
**File**: `src/main/agent/AgentModelService.ts`

Modify the context prompt building logic:

```typescript
// Before buildContextPrompt() is called:
const hydrationDetector = new ChatHydrationDetector();
const hydrationNeed = hydrationDetector.detectNeed({
  userMessage: prompt,
  taskId,
  priorTaskExists: /* check run store */,
  conversationMode: /* infer from invocation */,
});

// Silent hydration context (no visible headers)
const silentChatContext = hydrationNeed !== 'none'
  ? chatKnowledgeStore.buildSilentHydrationContext(taskId, {
      need: hydrationNeed,
      searchQuery: hydrationNeed === 'searched' 
        ? hydrationDetector.extractContextKeywords(prompt).join(' ')
        : undefined,
      maxChars: contextPromptBudgetForTaskKind(taskKind) * 0.4, // 40% of budget
      excludeToolResults: true, // compress tool outputs
    })
  : null;

// Build context prompt with silent injection
const contextPrompt = buildContextPrompt([
  silentChatContext, // Inject silently FIRST (background)
  buildAutomaticTaskContinuationContext(taskId, prompt),
  // ... rest of context
]);
```

### Step 4: Update buildContextPrompt to Remove Old Headers
**File**: `src/main/agent/AgentModelService.ts`

The old `buildInvocationContext()` method should be deprecated/replaced:

```typescript
// OLD (remove or make optional):
// includeConversationContext ? chatKnowledgeStore.buildInvocationContext(...) : null,

// NEW (silent, no headers):
// silentChatContext is already injected above
```

### Step 5: Compress Tool Results in Context
**File**: `src/main/chatKnowledge/ChatKnowledgeStore.ts`

When reading messages for injection, compress tool results:

```typescript
private compressToolResult(toolText: string, maxChars: number = 400): string {
  // If > maxChars: return summary line + truncation marker
  // Example: "**tool.exec result**: completed with status 0 (command output truncated)"
  // This reduces verbosity without losing the key outcome
}

private renderMessagesForInjection(
  taskId: string,
  candidates: ChatMessageMeta[],
  maxChars: number,
): string {
  // Similar to renderMessages, but:
  // - No role labels or formatting
  // - Compress tool results
  // - Return plain text, easily injectable
}
```

---

## Token Budget Optimization

**Current context budget**: See `contextPromptBudgetForTaskKind()`
- general: 2,500 chars
- implementation: 3,000 chars  
- research: 4,000 chars

**Silent hydration allocation**:
- Reserve 40% for hydrated chat context
- Reserve 30% for task continuation/memory
- Reserve 30% for new context (artifact, browser, etc)

**Example (research task with 4,000 char budget)**:
- Silent chat hydration: ~1,600 chars (40%)
- Task/memory context: ~1,200 chars (30%)
- New context: ~1,200 chars (30%)

---

## Detection Heuristics

### What Triggers 'recent' Hydration
- User message contains: "yes", "no", "ok", "continue", "explain"
- Pronouns: "it", "that", "this" (relative refs)
- Time refs: "earlier", "before", "just now"
- Same taskId, conversation context enabled
- **Load**: Last 2-3 exchanges (~500-800 chars)

### What Triggers 'full' Hydration
- User starts with "summarize", "recap", "what did we"
- Large multi-step task
- Research continuation
- **Load**: Full thread summary + last 5 messages

### What Triggers 'searched' Hydration
- User refers to specific topic by name: "about the payment system"
- Technical term not in current message: "the Redux implementation"
- Question about prior result: "does that API support..."
- **Load**: Semantic search of chat history + summary

### What Doesn't Trigger (None)
- Brand new task, unrelated topic
- User provides full context in current message
- Single-turn query (no follow-up)

---

## No Visible Changes to Model

The model will:
1. ✅ Receive prior context in its prompt automatically
2. ✅ NOT see "## Conversation Memory" header
3. ✅ NOT see tool-loading announcements
4. ✅ NOT need to explicitly call chat.read_last or chat.search
5. ✅ Treat hydrated context as background knowledge

The contract in AGENT.md will be updated to note:
- Chat context is **automatically injected when needed**
- The model does not need to explicitly load it via tools
- Tools remain available for explicit context control if needed

---

## Testing Strategy

### Unit Tests
- `ChatHydrationDetector.test.ts` — test detection logic against message patterns
- `ChatKnowledgeStore.test.ts` — enhance with silent methods, verify no headers
- Integration test for end-to-end hydration flow

### E2E Tests
- Follow-up message in same task → verify context is injected
- Follow-up with explicit reference ("earlier", "that") → verify correct context loaded
- New task in same session → verify no cross-task leakage
- Long conversation → verify budget respected, no token bloat

### Human Review
- Review prompts sent to model with debug logging
- Ensure no "Conversation Memory" or "From cache:" text appears
- Verify model still receives context for follow-ups

---

## Rollout Plan

### Phase 1: Detection Only (Safe)
- Add `ChatHydrationDetector`
- Log detections without injecting
- Review logs to verify heuristics are sound

### Phase 2: Injection with Explicit Toggle
- Add silent hydration methods to `ChatKnowledgeStore`
- Gate behind flag in `AgentRuntimeConfig`
- Enable for opt-in testing

### Phase 3: Default Enabled
- Enable for all invocations
- Monitor for any issues
- Remove old `buildInvocationContext()` header-based method

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/main/agent/ChatHydrationDetector.ts` | **Create** | Detect when hydration needed |
| `src/main/chatKnowledge/ChatKnowledgeStore.ts` | **Modify** | Add silent hydration methods, compress tool results |
| `src/main/agent/AgentModelService.ts` | **Modify** | Call detector, inject silently into contextPrompt |
| `src/main/agent/AgentPromptBuilder.ts` | **Modify** | Document silent hydration in contract (optional) |
| `src/main/agent/ChatHydrationDetector.test.ts` | **Create** | Unit tests for detection |
| `src/main/chatKnowledge/ChatKnowledgeStore.test.ts` | **Modify** | Tests for silent methods |

---

## Success Criteria

✅ **Chat context is automatically loaded when needed**
- Follow-up messages receive prior context without explicit tool calls
- Context is loaded only when necessary (lazy)

✅ **Silent injection (no visible traces)**
- No "Conversation Memory" header in prompts
- No "loading from cache" messages to model
- Model receives context as if it was always present

✅ **Token efficient**
- Context injection respects budget limits
- Minimal context loaded for simple follow-ups
- Tool results compressed for verbosity

✅ **Backward compatible**
- Existing chat tools still work
- User can still explicitly call chat.read_last, chat.search
- No breaking changes to API

✅ **Well tested**
- Detection heuristics validated
- Silent injection verified
- E2E tests confirm follow-ups work

---

## Future Enhancements

1. **Semantic indexing** — build vector embeddings for better search
2. **Smart summarization** — auto-summarize long exchanges for compression
3. **Context relevance scoring** — weight recent/relevant context higher
4. **Per-message hydration** — different strategies for different message types
5. **Multi-run context** — hydrate across multiple invocations/runs seamlessly

