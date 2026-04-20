# Browser Tool Catalog — Design Spec
**Date:** 2026-04-20  
**Status:** Draft

---

## Problem

Every agent turn sends tool schemas to Anthropic as part of the request body. Even with tool packs limiting to 4–6 tools per task, those schemas are re-sent on every single turn — compounding across long sessions. The current system also requires `runtime.search_tools` and `runtime.load_tools` calls when the agent needs tools outside its initial scope, which costs additional turns and tokens.

The goal is: **all 91 tools available to the agent every turn, with Anthropic only ever seeing 2–3 tool schemas.**

---

## Architecture

### Core Idea

Move tool knowledge out of the prompt and onto disk. A lightweight local process writes the full tool catalog to disk once at startup. The agent reads what it needs from disk and executes tools via `browser.evaluate_js` against a local runtime page. Anthropic never sees tool schemas — only `fs.read` and `browser.evaluate_js`.

### Three Components

```
┌─────────────────────────────────────────────────────────┐
│ 1. CatalogWriter (runs at app startup, offline)         │
│    Reads AgentToolExecutor registry                     │
│    Chunks by category, writes JSON + manifest to disk   │
│    Hashes tool signatures — skips write if unchanged    │
└────────────────────┬────────────────────────────────────┘
                     │ writes once
                     ▼
┌─────────────────────────────────────────────────────────┐
│ 2. Tool Catalog on Disk (userData/tool-catalog/)        │
│    catalog-manifest.json  — chunk index + hashes        │
│    catalog-browser.json   — 45 browser tool schemas     │
│    catalog-filesystem.json                              │
│    catalog-terminal.json                                │
│    catalog-chat.json                                    │
│    catalog-runtime.json                                 │
│    catalog-session.json                                 │
│    catalog-subagent.json                                │
│    catalog-attachments.json                             │
└────────────────────┬────────────────────────────────────┘
                     │ agent reads relevant chunk
                     ▼
┌─────────────────────────────────────────────────────────┐
│ 3. BrowserToolRuntime (local page at app startup)       │
│    All 91 tools wired as window.tools.* JS functions    │
│    Each function calls workspaceAPI.* IPC internally    │
│    Agent calls tools via browser.evaluate_js            │
└─────────────────────────────────────────────────────────┘
```

---

## Component 1: CatalogWriter

**Location:** `src/main/agent/CatalogWriter.ts`

**When it runs:** Called from `AgentModelService.init()` immediately after `agentToolExecutor.registerMany()` — tools are registered, catalog is written before any task runs.

**What it does:**
1. Reads all tools from `agentToolExecutor.list()`
2. Groups by prefix (`browser.*`, `filesystem.*`, etc.)
3. For each group, builds a catalog entry:
   ```json
   {
     "name": "browser.extract_page",
     "description": "...",
     "inputSchema": { ... },
     "jsCall": "window.tools.browser.extract_page"
   }
   ```
4. Computes a SHA1 signature of the group using the existing `stableStringify` pattern
5. Reads the existing manifest — if signature matches, skips writing that chunk
6. Writes changed chunks + updated manifest to `userData/tool-catalog/`

**Manifest shape:**
```json
{
  "version": 1,
  "writtenAt": 1713600000000,
  "chunks": [
    {
      "file": "catalog-browser.json",
      "category": "browser",
      "toolCount": 45,
      "signature": "a3f9...",
      "tokenEstimate": 4200
    }
  ]
}
```

**Token estimates:** Each tool entry is pre-estimated at write time (`name + description + schema` / 4). Agent uses this to decide which chunks to load without reading them first.

---

## Component 2: Tool Catalog on Disk

**Location:** `userData/tool-catalog/` (via `app.getPath('userData')`)

**Written by:** CatalogWriter at startup  
**Read by:** Agent via `workspaceAPI.fs.read()` — the IPC bridge we already built  
**Invalidated by:** CatalogWriter detecting a signature change (tool added, description changed, schema changed)

Each chunk file is a JSON array of tool entries. The agent reads the manifest first (tiny, ~500 bytes), picks the relevant chunks by category, reads those files. For a browser research task it reads `catalog-browser.json` — one `fs.read` call, all 45 browser tool schemas available, zero tokens sent to Anthropic.

**The agent's reading pattern:**
```
Turn 1: fs.read('tool-catalog/catalog-manifest.json')  → knows what exists
Turn 1: fs.read('tool-catalog/catalog-browser.json')   → has all browser tools
Turn 2+: already in context, never re-read
```

---

## Component 3: BrowserToolRuntime Page

**Location:** `src/renderer/tool-runtime.html`  
**Served by:** Electron's existing file serving — agent navigates to `file:///...dist/renderer/tool-runtime.html`  
**Loaded:** Agent navigates once per session, page persists

**What the page contains:**

A script block that wires all 91 tools as `window.tools.*` functions using `window.workspaceAPI`:

```javascript
window.tools = {
  browser: {
    extract_page: (input) => window.workspaceAPI.browser.captureTabSnapshot(input.tabId),
    navigate: (input) => window.workspaceAPI.actions.submit({ type: 'browser.navigate', ...input }),
    evaluate_js: (input) => window.workspaceAPI.browser.captureTabSnapshot(input.tabId),
    // ... all 45 browser tools
  },
  filesystem: {
    read: (input) => window.workspaceAPI.fs.read(input.path),
    write: (input) => window.workspaceAPI.fs.write(input.path, input.content),
    // ... all 14 filesystem tools
  },
  // ... all categories
};

// Execution helper — returns structured result
window.runTool = async (category, name, input) => {
  try {
    const result = await window.tools[category][name](input);
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
};
```

**Agent call pattern:**
```javascript
// Single tool call
await window.runTool('filesystem', 'read', { path: '/some/file.ts' })

// Batch — multiple tools in one evaluate_js call
const [content, elements] = await Promise.all([
  window.runTool('browser', 'extract_page', { tabId }),
  window.runTool('browser', 'get_actionable_elements', { tabId }),
]);
await window.workspaceAPI.fs.write('/cache/result.json', JSON.stringify({ content, elements }));
```

**This is the key cost reduction:** one `evaluate_js` call can batch multiple tool executions. Currently each tool is a separate turn. With this model, a 3-tool research step becomes 1 turn.

---

## What Anthropic Sees

**Current system (per turn):**
- System prompt (cached after turn 1)
- 4–6 tool schemas (~2000–3000 chars)
- Full message history

**New system (per turn):**
- System prompt (cached)
- 2 tool schemas: `browser.evaluate_js` + `fs.read` (~400 chars total)
- Full message history

**Reduction:** ~85% fewer tool schema tokens per turn. On a 20-turn task that's previously 60,000 tool-schema chars → ~8,000.

---

## What Changes in the Existing Runtime

**AgentModelService.ts:**
- Add `catalogWriter.write(agentToolExecutor.list())` call after `registerMany()`

**AgentRuntime.ts / toolPacks.ts:**
- Tool pack selection still runs — but now it controls which catalog chunks the agent is prompted to read, not which schemas to inject
- System prompt addendum tells agent: "Tool catalog available at `userData/tool-catalog/`. Read manifest first, then load relevant chunks."

**AgentPromptBuilder.ts:**
- New section: `## Tool Catalog\n\nFull tool catalog on disk. Read \`tool-catalog/catalog-manifest.json\` to discover available chunks. Load only what your task needs.`
- Tool schema injection (`buildToolPromptSummary`) replaced with catalog pointer for tasks using this system

**Constraint validation:**
- Unchanged — `ConstraintValidator` still runs after every `browser.evaluate_js` result
- Tool results written to disk by the agent are still readable by the validator

---

## What Does NOT Change

- `AgentToolExecutor` — tools still registered and executed the same way on the Node side
- `ConstraintValidator` — still runs, still authoritative
- `HaikuProvider` / `CodexProvider` — still handle the actual model calls
- `browserOperations` / `BrowserService` — unchanged
- The existing `browser.evaluate_js` tool — this system uses it, doesn't replace it

---

## Rollout Strategy

This is additive — nothing breaks if the catalog isn't read. The agent falls back to the existing tool pack system automatically if it doesn't use the catalog. 

**Phase 1:** CatalogWriter + disk writes only. No prompt changes. Verify catalog is written correctly at startup.

**Phase 2:** BrowserToolRuntime page. Verify `window.tools.*` calls work end-to-end via the fs-test pattern we already validated.

**Phase 3:** Prompt changes — tell the agent about the catalog. Measure token reduction.

**Phase 4:** Replace tool schema injection with catalog pointer for standard tasks.

---

## Open Questions

1. **Constraint validation for batched calls** — when the agent batches 3 tool calls in one `evaluate_js`, the validator sees one result block. Does that need a new validation pattern or is the existing one sufficient?

2. **Tool execution context** — `AgentToolContext` (runId, agentId, mode, taskId) is currently injected by the runtime. When tools execute via `window.tools.*` in the browser page, that context isn't available. Either the page needs to receive it on navigation, or tool results skip context-aware logging.

3. **Local model for catalog writing** — the CatalogWriter can be a pure Node.js function initially (no model needed — it's just serializing what's already in the registry). A local model becomes valuable later for writing human-language summaries and usage examples per tool. Not needed for Phase 1–3.

---

## Success Criteria

- All 91 tools accessible to agent without any being injected into the Anthropic request
- Token cost for tool schemas per turn drops from ~2500 chars to ~400 chars
- No regression in task completion quality
- Catalog written in <100ms at startup
- Agent can batch 2+ tool calls in a single `evaluate_js` turn
