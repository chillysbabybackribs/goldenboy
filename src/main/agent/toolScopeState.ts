import type { AgentToolName, AgentToolSchemaSummary, AgentToolScopeState } from './AgentTypes';

export function createToolScopeState(
  activeTools: AgentToolSchemaSummary[] | undefined,
): AgentToolScopeState {
  const normalizedActiveTools = Array.isArray(activeTools) ? activeTools : [];
  return {
    activeTools: dedupeTools(normalizedActiveTools),
  };
}

export function listActiveTools(scope: AgentToolScopeState): AgentToolSchemaSummary[] {
  return [...scope.activeTools];
}

export function activeToolNames(scope: AgentToolScopeState): AgentToolName[] {
  return scope.activeTools.map((tool) => tool.name);
}

export function hasActiveTool(scope: AgentToolScopeState, toolName: AgentToolName): boolean {
  return scope.activeTools.some((tool) => tool.name === toolName);
}

// Mutates the scope in place by appending tool schemas that are not already active.
// Returns the names actually added (for logging / status reporting).
export function addActiveTools(
  scope: AgentToolScopeState,
  toolSummaries: AgentToolSchemaSummary[],
): AgentToolName[] {
  const existing = new Set<AgentToolName>(scope.activeTools.map((tool) => tool.name));
  const added: AgentToolName[] = [];
  for (const summary of toolSummaries) {
    if (existing.has(summary.name)) continue;
    existing.add(summary.name);
    scope.activeTools.push(summary);
    added.push(summary.name);
  }
  return added;
}

function dedupeTools(tools: AgentToolSchemaSummary[] | undefined): AgentToolSchemaSummary[] {
  const seen = new Set<AgentToolName>();
  const deduped: AgentToolSchemaSummary[] = [];
  for (const tool of tools ?? []) {
    if (seen.has(tool.name)) continue;
    seen.add(tool.name);
    deduped.push(tool);
  }
  return deduped;
}
