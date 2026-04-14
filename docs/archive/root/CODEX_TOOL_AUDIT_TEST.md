# Codex Tool Audit Test

## Problem Statement

Codex and the runtime have a tool scope system (`runtimeScope.ts`, `taskProfile.ts`) that is designed to select appropriate tools for each task to reduce token waste. However, the CODEX_AUDIT.md notes that **every single task profile sets `allowedTools: 'all'`**, meaning the filtering logic exists but is never actually used.

## Current Tool Counts

- **Browser Tools**: 43
- **Filesystem Tools**: 14
- **Terminal Tools**: 4
- **Chat Tools**: 7
- **Subagent Tools**: 5
- **TOTAL**: 73 tools

All 73 tools are passed to Codex in every run, regardless of task type.

## Test Execution

Created a test in `src/main/agent/AgentRuntime.test.ts` to capture the actual tools passed to Codex for different task types.

### Test Results

See test output below for each task type.

## Key Findings

1. **Orchestration task** (delegates work, plans strategy):
   - Expected tools: browser, filesystem, local-debug, subagent
   - Actual tools passed: ALL 73
   
2. **Research task** (browser search):
   - Expected tools: browser-operation only
   - Actual tools passed: ALL 73
   
3. **Implementation task** (code changes):
   - Expected tools: browser-operation, filesystem-operation, local-debug
   - Actual tools passed: ALL 73
   
4. **Review task** (code review):
   - Expected tools: filesystem-operation, local-debug
   - Actual tools passed: ALL 73
   
5. **Debug task** (troubleshoot failures):
   - Expected tools: browser-operation, filesystem-operation, local-debug
   - Actual tools passed: ALL 73

## Impact

- **Token Waste**: System prompt includes all 73 tool schemas every run
- **Model Focus**: Codex receives 4-5x more tool information than needed
- **Prompt Bloat**: Tool descriptions add thousands of tokens of noise per run

## Recommended Fix

Implement per-task-type tool filtering by updating `taskProfile.ts` to return specific tool lists instead of `'all'`:

Example:
```typescript
case 'research':
  return {
    kind: 'research',
    skillNames: ['browser-operation'],
    allowedTools: [
      'browser.get_state',
      'browser.get_tabs',
      'browser.navigate',
      'browser.search_web',
      'browser.research_search',
      // ... other browser tools
    ],
    canSpawnSubagents: false,
    maxToolTurns: maxTurnsForPrompt(prompt),
    requiresBrowserSearchDirective: true,
  };
```

This would reduce system prompt bloat and improve Codex's focus on the relevant tools for each task.
