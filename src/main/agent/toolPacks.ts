import type { AgentToolDefinition, AgentToolName } from './AgentTypes';
import type { AgentTaskKind, AgentToolPackPreset } from '../../shared/types/model';
import type { ToolPackManifest } from './tool-packs/types';
import { researchToolPack } from './tool-packs/research';
import { implementationToolPack } from './tool-packs/implementation';
import { debugToolPack } from './tool-packs/debug';
import { reviewToolPack } from './tool-packs/review';
import { orchestrationToolPack } from './tool-packs/orchestration';
import { generalToolPack } from './tool-packs/general';
import { browserAutomationToolPack } from './tool-packs/browserAutomation';
import { browserAdvancedToolPack } from './tool-packs/browserAdvanced';
import { artifactsToolPack } from './tool-packs/artifacts';
import { terminalHeavyToolPack } from './tool-packs/terminalHeavy';
import { fileEditToolPack } from './tool-packs/fileEdit';
import { fileCacheToolPack } from './tool-packs/fileCache';
import { chatRecallToolPack } from './tool-packs/chatRecall';
import { allToolsToolPack } from './tool-packs/allTools';

type NormalizedTaskKind =
  | 'orchestration'
  | 'research'
  | 'browser-automation'
  | 'implementation'
  | 'debug'
  | 'review'
  | 'general';

type ToolPackExpansion = {
  pack: string;
  description: string;
  tools: AgentToolName[];
  scope: 'named' | 'all';
  relatedPackIds: string[];
};

export type AutoToolPackExpansion = ToolPackExpansion & {
  reason: string;
};

export type PreflightToolPackExpansion = ToolPackExpansion & {
  reason: string;
};

export type ToolSearchMatch = {
  name: AgentToolName;
  description: string;
  category: string;
  relatedPackIds: string[];
  bindingState: 'discoverable' | 'callable';
  callableNow: boolean;
  invokableNow: boolean;
  invocationMethod: 'direct' | 'runtime.invoke_tool';
  availableNextTurn: boolean;
  score: number;
  reason: string;
};

export const DEFAULT_TOOL_PACK_PRESET: AgentToolPackPreset = 'mode-6';
export const RUNTIME_SEARCH_TOOLS_TOOL_NAME = 'runtime.search_tools' as const;
export const RUNTIME_REQUIRE_TOOLS_TOOL_NAME = 'runtime.require_tools' as const;
export const RUNTIME_INVOKE_TOOL_NAME = 'runtime.invoke_tool' as const;
export const RUNTIME_REQUEST_TOOL_NAME = 'runtime.request_tool_pack' as const;
export const RUNTIME_LIST_TOOL_PACKS_TOOL_NAME = 'runtime.list_tool_packs' as const;
export const LOCAL_FILES_INITIAL_SURFACE_TOOLS: AgentToolName[] = [
  'filesystem.list',
  'filesystem.search',
  'filesystem.read',
];
export const BROWSER_INITIAL_SURFACE_PACK_IDS = [
  'research',
  'browser-automation',
  'browser-advanced',
] as const;

const TASK_PACK_BY_KIND: Record<NormalizedTaskKind, ToolPackManifest> = {
  orchestration: orchestrationToolPack,
  research: researchToolPack,
  'browser-automation': browserAutomationToolPack,
  implementation: implementationToolPack,
  debug: debugToolPack,
  review: reviewToolPack,
  general: generalToolPack,
};

const ALL_TOOL_PACKS: ToolPackManifest[] = [
  researchToolPack,
  implementationToolPack,
  debugToolPack,
  reviewToolPack,
  orchestrationToolPack,
  generalToolPack,
  browserAutomationToolPack,
  browserAdvancedToolPack,
  artifactsToolPack,
  terminalHeavyToolPack,
  fileEditToolPack,
  fileCacheToolPack,
  chatRecallToolPack,
  allToolsToolPack,
];

const TOOL_PACKS_BY_ID = new Map(ALL_TOOL_PACKS.map((pack) => [pack.id, pack]));

function normalizeTaskKind(kind: AgentTaskKind): NormalizedTaskKind {
  switch (kind) {
    case 'delegation':
      return 'orchestration';
    case 'browser-search':
      return 'research';
    case 'browser-automation':
      return 'browser-automation';
    case 'local-code':
      return 'implementation';
    default:
      return kind;
  }
}

function withRuntimeScopeTools(tools: AgentToolName[]): AgentToolName[] {
  return [
    RUNTIME_SEARCH_TOOLS_TOOL_NAME,
    RUNTIME_REQUIRE_TOOLS_TOOL_NAME,
    RUNTIME_INVOKE_TOOL_NAME,
    RUNTIME_REQUEST_TOOL_NAME,
    RUNTIME_LIST_TOOL_PACKS_TOOL_NAME,
    ...tools,
  ];
}

function uniqueToolNames(tools: AgentToolName[]): AgentToolName[] {
  return Array.from(new Set(tools));
}

function requiredBaselineTools(manifest: ToolPackManifest, preset: AgentToolPackPreset): AgentToolName[] {
  if (preset === 'mode-4') return manifest.baseline4 ?? manifest.tools.slice(0, 3);
  return manifest.baseline6 ?? manifest.tools.slice(0, 5);
}

export function listToolPacks(): ToolPackManifest[] {
  return ALL_TOOL_PACKS.map((pack) => ({ ...pack }));
}

export function getToolPack(packId: string): ToolPackManifest | null {
  const pack = TOOL_PACKS_BY_ID.get(packId);
  return pack ? { ...pack } : null;
}

export function buildRuntimeRequestToolDescription(): string {
  return [
    'Request an additional host-managed tool pack when the current scope is insufficient.',
    'Prefer runtime.search_tools first when you only need a few exact tools; request a whole pack only when you need a broad surface.',
    'If you are unsure which pack contains the needed capability, call runtime.list_tool_packs first.',
    'Use this immediately when you need a broad category of tools instead of guessing or continuing with degraded output.',
    'Requested pack tools become callable on the next turn unless they are already in the current scope.',
    'Pass the pack id in `pack`. The input schema already validates the available pack ids.',
  ].join('\n');
}

function packIdsForTool(name: AgentToolName): string[] {
  return ALL_TOOL_PACKS
    .filter((pack) => pack.scope !== 'all' && pack.tools.includes(name))
    .map((pack) => pack.id);
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[._/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSearchTerms(query: string): string[] {
  return Array.from(new Set(
    normalizeSearchText(query)
      .split(' ')
      .map((term) => term.trim())
      .filter((term) => term.length >= 2),
  ));
}

function scoreToolMatch(
  query: string,
  tool: Pick<AgentToolDefinition, 'name' | 'description'>,
): { score: number; reason: string } {
  const normalizedQuery = normalizeSearchText(query);
  const terms = extractSearchTerms(query);
  const normalizedName = normalizeSearchText(tool.name);
  const normalizedDescription = normalizeSearchText(tool.description);
  const searchText = `${normalizedName} ${normalizedDescription}`;
  let score = 0;
  const matchedReasons: string[] = [];

  if (normalizedName === normalizedQuery) {
    score += 180;
    matchedReasons.push('exact tool name match');
  } else if (normalizedName.includes(normalizedQuery) && normalizedQuery.length >= 3) {
    score += 120;
    matchedReasons.push('tool name contains the query');
  }

  for (const term of terms) {
    if (normalizedName.includes(term)) {
      score += 35;
      if (matchedReasons.length < 2) matchedReasons.push(`name matches "${term}"`);
      continue;
    }
    if (normalizedDescription.includes(term)) {
      score += 12;
      if (matchedReasons.length < 2) matchedReasons.push(`description matches "${term}"`);
      continue;
    }
    if (searchText.includes(term)) {
      score += 6;
    }
  }

  return {
    score,
    reason: matchedReasons[0] ?? 'semantic match',
  };
}

export function searchToolCatalog(
  query: string,
  toolCatalog: Array<Pick<AgentToolDefinition, 'name' | 'description'>>,
  options?: {
    currentTools?: Array<Pick<AgentToolDefinition, 'name'>>;
    limit?: number;
  },
): ToolSearchMatch[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];

  const currentToolNames = new Set((options?.currentTools ?? []).map((tool) => tool.name));
  const limit = Math.min(Math.max(Math.floor(options?.limit ?? 5), 1), 10);

  return toolCatalog
    .filter((tool) => tool.name !== RUNTIME_SEARCH_TOOLS_TOOL_NAME)
    .map((tool) => {
      const { score, reason } = scoreToolMatch(query, tool);
      return {
        name: tool.name,
        description: tool.description,
        category: tool.name.split('.')[0] ?? 'general',
        relatedPackIds: packIdsForTool(tool.name),
        bindingState: currentToolNames.has(tool.name) ? 'callable' : 'discoverable',
        callableNow: currentToolNames.has(tool.name),
        invokableNow: true,
        invocationMethod: currentToolNames.has(tool.name) ? 'direct' : 'runtime.invoke_tool',
        availableNextTurn: !currentToolNames.has(tool.name),
        score,
        reason,
      } satisfies ToolSearchMatch;
    })
    .filter((match) => match.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (left.callableNow !== right.callableNow) return Number(left.callableNow) - Number(right.callableNow);
      return left.name.localeCompare(right.name);
    })
    .slice(0, limit);
}

export function resolveAllowedToolsForTaskKind(
  kind: AgentTaskKind,
  preset: AgentToolPackPreset = DEFAULT_TOOL_PACK_PRESET,
): 'all' | AgentToolName[] {
  if (preset === 'all') return 'all';
  const manifest = TASK_PACK_BY_KIND[normalizeTaskKind(kind)];
  return uniqueToolNames(withRuntimeScopeTools(requiredBaselineTools(manifest, preset)));
}

export function resolveFullSurfaceTools(packId: string): AgentToolName[] | null {
  const pack = TOOL_PACKS_BY_ID.get(packId);
  if (!pack || pack.scope === 'all') return null;
  return uniqueToolNames(withRuntimeScopeTools(pack.tools));
}

export function resolveLocalFilesInitialSurfaceTools(): AgentToolName[] {
  return uniqueToolNames(withRuntimeScopeTools(LOCAL_FILES_INITIAL_SURFACE_TOOLS));
}

export function resolveBrowserInitialSurfaceTools(): AgentToolName[] {
  const combined = BROWSER_INITIAL_SURFACE_PACK_IDS.flatMap((packId) => {
    const pack = TOOL_PACKS_BY_ID.get(packId);
    return pack && pack.scope !== 'all' ? pack.tools : [];
  });
  return uniqueToolNames(withRuntimeScopeTools(combined));
}

export function resolveRequestedToolPack(
  packId: string,
  toolCatalog: Array<Pick<AgentToolDefinition, 'name'>>,
): ToolPackExpansion | null {
  const pack = TOOL_PACKS_BY_ID.get(packId);
  if (!pack) return null;
  if (pack.scope === 'all') {
    return {
      pack: pack.id,
      description: pack.description,
      tools: toolCatalog.map((tool) => tool.name),
      scope: 'all',
      relatedPackIds: pack.relatedPackIds ?? [],
    };
  }

  const available = new Set(toolCatalog.map((tool) => tool.name));
  const tools = pack.tools.filter((tool) => available.has(tool));
  return {
    pack: pack.id,
    description: pack.description,
    tools,
    scope: 'named',
    relatedPackIds: pack.relatedPackIds ?? [],
  };
}

export function mergeExpandedTools(
  currentTools: Array<Pick<AgentToolDefinition, 'name' | 'description' | 'inputSchema'>>,
  toolCatalog: Array<Pick<AgentToolDefinition, 'name' | 'description' | 'inputSchema'>>,
  expansion: ToolPackExpansion,
): Array<Pick<AgentToolDefinition, 'name' | 'description' | 'inputSchema'>> {
  if (expansion.scope === 'all') return [...toolCatalog];

  const currentNames = new Set(currentTools.map((tool) => tool.name));
  const catalogByName = new Map(toolCatalog.map((tool) => [tool.name, tool]));
  const added = expansion.tools
    .map((name) => catalogByName.get(name))
    .filter((tool): tool is Pick<AgentToolDefinition, 'name' | 'description' | 'inputSchema'> => Boolean(tool))
    .filter((tool) => !currentNames.has(tool.name));

  return [...currentTools, ...added];
}

export function resolveAutoExpandedToolPack(
  message: string,
  currentTools: Array<Pick<AgentToolDefinition, 'name'>>,
  toolCatalog: Array<Pick<AgentToolDefinition, 'name' | 'description' | 'inputSchema'>>,
): AutoToolPackExpansion | null {
  const normalized = message.toLowerCase();
  if (!looksLikeMissingCapabilityMessage(normalized)) return null;

  const currentToolNames = new Set(currentTools.map((tool) => tool.name));
  const candidates = rankedAutoExpansionCandidates(normalized, currentToolNames);
  for (const candidate of candidates) {
    const expansion = resolveRequestedToolPack(candidate.packId, toolCatalog);
    if (!expansion || expansion.scope === 'all') continue;
    const addsNewTools = expansion.tools.some((tool) => !currentToolNames.has(tool));
    if (!addsNewTools) continue;
    return {
      ...expansion,
      reason: candidate.reason,
    };
  }

  return null;
}

export function resolvePreflightToolPackExpansions(
  task: string,
  currentTools: Array<Pick<AgentToolDefinition, 'name'>>,
  toolCatalog: Array<Pick<AgentToolDefinition, 'name' | 'description' | 'inputSchema'>>,
  maxPacks = 2,
): PreflightToolPackExpansion[] {
  const normalized = task.toLowerCase();
  const currentToolNames = new Set(currentTools.map((tool) => tool.name));
  const candidates: Array<{ packId: string; reason: string }> = [];
  const push = (packId: string, reason: string): void => {
    if (packId === 'all-tools') return;
    if (candidates.some((entry) => entry.packId === packId)) return;
    candidates.push({ packId, reason });
  };

  if (needsBrowserTabCreationCapability(normalized, currentToolNames)) {
    push('browser-automation', 'task text explicitly requests opening new or separate tabs');
  }
  if (needsBrowserTabActivationCapability(normalized, currentToolNames)) {
    push('browser-automation', 'task text explicitly requests switching or activating browser tabs');
  }
  if (needsBrowserAdvancedPack(normalized, currentToolNames)) {
    push('browser-advanced', 'task text requires advanced browser interaction or diagnostics');
  }
  if (needsBrowserAutomation(normalized, currentToolNames)) {
    push('browser-automation', 'task text requires browser interaction beyond the baseline scope');
  }
  if (needsResearchPack(normalized, currentToolNames)) {
    push('research', 'task text requires browser research capability');
  }
  if (needsImplementationPack(normalized, currentToolNames)) {
    push('implementation', 'task text requires local code or file change capability');
  }
  if (needsArtifactsPack(normalized, currentToolNames)) {
    push('artifacts', 'task text requires managed workspace artifact operations');
  }
  if (needsFileEditPack(normalized, currentToolNames)) {
    push('file-edit', 'task text requires focused file inspection or editing capability');
  }
  if (needsFileCachePack(normalized, currentToolNames)) {
    push('file-cache', 'task text requires indexed file cache search or chunk reads');
  }
  if (needsTerminalHeavyPack(normalized, currentToolNames)) {
    push('terminal-heavy', 'task text requires terminal execution or process control');
  }
  if (needsTerminalProcessControlPack(normalized, currentToolNames)) {
    push('terminal-heavy', 'task text explicitly requests terminal process control or interactive input');
  }
  if (needsChatRecallPack(normalized, currentToolNames)) {
    push('chat-recall', 'task text requires chat history recall capability');
  }
  if (needsOrchestrationPack(normalized, currentToolNames)) {
    push('orchestration', 'task text requires delegation or sub-agent coordination');
  }

  const expansions: PreflightToolPackExpansion[] = [];
  for (const candidate of candidates) {
    if (expansions.length >= maxPacks) break;
    const expansion = resolveRequestedToolPack(candidate.packId, toolCatalog);
    if (!expansion || expansion.scope === 'all') continue;
    const addsNewTools = expansion.tools.some((tool) => !currentToolNames.has(tool));
    if (!addsNewTools) continue;
    expansions.push({
      ...expansion,
      reason: candidate.reason,
    });
    for (const tool of expansion.tools) currentToolNames.add(tool);
  }

  return expansions;
}

function looksLikeMissingCapabilityMessage(message: string): boolean {
  return [
    /\bcurrent scope\b/,
    /\btool scope\b/,
    /\bmissing tool/,
    /\bmissing capability/,
    /\bneed more tools\b/,
    /\bneed additional tools\b/,
    /\bdon'?t have\b/,
    /\bdo not have\b/,
    /\bnot available in (?:this|the) runtime scope\b/,
    /\bno access to\b/,
    /\bunable to continue without\b/,
    /\bcan'?t continue without\b/,
    /\bcannot continue without\b/,
    /\bneed .*tool pack\b/,
  ].some((pattern) => pattern.test(message));
}

function rankedAutoExpansionCandidates(
  message: string,
  currentToolNames: Set<AgentToolName>,
): Array<{ packId: string; reason: string }> {
  const candidates: Array<{ packId: string; reason: string }> = [];
  const push = (packId: string, reason: string): void => {
    if (packId === 'all-tools') return;
    if (candidates.some((entry) => entry.packId === packId)) return;
    candidates.push({ packId, reason });
  };

  for (const related of inferRelatedPacksFromCurrentTools(currentToolNames)) {
    push(related.packId, related.reason);
  }

  if (/\b(browser|tab|tabs|page|pages|url|link|links|navigate|navigation|click|type|form|upload|download|login|sign in)\b/.test(message)) {
    push('browser-automation', 'message referenced missing browser interaction capability');
  }
  if (/\b(search|look up|lookup|find online|research|latest|current|news|web)\b/.test(message)) {
    push('research', 'message referenced missing search or research capability');
  }
  if (/\b(file|files|directory|folder|workspace|repo|repository|codebase|read|write|edit|patch|rename|mkdir|move)\b/.test(message)) {
    push('file-edit', 'message referenced missing file editing or file inspection capability');
    push('implementation', 'message referenced missing code or file change capability');
  }
  if (/\b(terminal|shell|command|process|npm|pnpm|yarn|node|build|test|server|stdout|stderr|logs?)\b/.test(message)) {
    push('terminal-heavy', 'message referenced missing terminal or process capability');
    push('debug', 'message referenced missing debugging or log inspection capability');
  }
  if (/\b(stop|kill|interrupt|ctrl\+c|terminate|cancel|respond|input|password|prompt|confirm)\b/.test(message)) {
    push('terminal-heavy', 'message referenced missing terminal process control or interactive input capability');
  }
  if (/\b(history|prior|previous|earlier|conversation|thread|recall|context window|chat history)\b/.test(message)) {
    push('chat-recall', 'message referenced missing chat recall capability');
  }
  if (/\b(subagent|sub-agent|delegate|delegation|parallel|worker|workers)\b/.test(message)) {
    push('orchestration', 'message referenced missing delegation capability');
  }

  return candidates;
}

function inferRelatedPacksFromCurrentTools(
  currentToolNames: Set<AgentToolName>,
): Array<{ packId: string; reason: string }> {
  const scored = ALL_TOOL_PACKS
    .filter((pack) => pack.scope !== 'all')
    .map((pack) => ({
      pack,
      overlap: pack.tools.filter((tool) => currentToolNames.has(tool)).length,
    }))
    .filter((entry) => entry.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap);

  const related: Array<{ packId: string; reason: string }> = [];
  for (const entry of scored) {
    for (const relatedPackId of entry.pack.relatedPackIds ?? []) {
      if (related.some((candidate) => candidate.packId === relatedPackId)) continue;
      related.push({
        packId: relatedPackId,
        reason: `current tool scope overlaps with ${entry.pack.id}, which relates to ${relatedPackId}`,
      });
    }
  }

  return related;
}

function hasAnyTool(currentToolNames: Set<AgentToolName>, tools: AgentToolName[]): boolean {
  return tools.some((tool) => currentToolNames.has(tool));
}

function needsBrowserAutomation(message: string, currentToolNames: Set<AgentToolName>): boolean {
  const browserIntent = /\b(browser|tab|tabs|page|pages|url|link|links|navigate|navigation|open|visit|click|type|fill|submit|login|log in|sign in|upload|download|checkout)\b/.test(message);
  const hasBrowserActions = hasAnyTool(currentToolNames, [
    'browser.get_tabs',
    'browser.navigate',
    'browser.create_tab',
    'browser.click',
    'browser.type',
    'browser.close_tab',
    'browser.activate_tab',
  ]);
  return browserIntent && !hasBrowserActions;
}

function needsBrowserTabCreationCapability(
  message: string,
  currentToolNames: Set<AgentToolName>,
): boolean {
  const explicitNewTabIntent = /\b(new|separate|another)\s+tabs?\b/.test(message);
  const countedTabIntent = /\b(open|create|launch)\b.*\b(two|three|four|five|six|seven|eight|nine|ten|\d+|multiple|several)\b.*\btabs?\b/.test(message);
  const hasCreateTab = currentToolNames.has('browser.create_tab');
  return (explicitNewTabIntent || countedTabIntent) && !hasCreateTab;
}

function needsBrowserTabActivationCapability(
  message: string,
  currentToolNames: Set<AgentToolName>,
): boolean {
  const tabSwitchIntent = /\b(switch|activate|focus|select)\b.*\btabs?\b/.test(message);
  const hasActivateTab = currentToolNames.has('browser.activate_tab');
  return tabSwitchIntent && !hasActivateTab;
}

function needsResearchPack(message: string, currentToolNames: Set<AgentToolName>): boolean {
  const researchIntent = /\b(search(?: the web| online)?|look up|lookup|find online|research|latest|current|today|news)\b/.test(message);
  const hasResearchTools = hasAnyTool(currentToolNames, [
    'browser.research_search',
    'browser.search_web',
    'browser.search_page_cache',
  ]);
  return researchIntent && !hasResearchTools;
}

function needsBrowserAdvancedPack(message: string, currentToolNames: Set<AgentToolName>): boolean {
  const advancedBrowserIntent = /\b(upload|download|drag|drop|hover|dialog|alert|confirm|prompt|console|network|evaluate js|javascript|js expression|checkout|intent|diagnostic|trace)\b/.test(message);
  const hasAdvancedBrowserTools = hasAnyTool(currentToolNames, [
    'browser.upload_file',
    'browser.download_url',
    'browser.drag',
    'browser.hover',
    'browser.get_dialogs',
    'browser.get_console_events',
    'browser.get_network_events',
    'browser.run_intent_program',
  ]);
  return advancedBrowserIntent && !hasAdvancedBrowserTools;
}

function needsImplementationPack(message: string, currentToolNames: Set<AgentToolName>): boolean {
  const implementationIntent = /\b(implement|patch|edit|modify|update|refactor|fix|rename|write code|change code|code change|apply patch)\b/.test(message);
  const hasImplementationTools = hasAnyTool(currentToolNames, [
    'filesystem.patch',
    'filesystem.write',
    'filesystem.move',
  ]);
  return implementationIntent && !hasImplementationTools;
}

function needsArtifactsPack(message: string, currentToolNames: Set<AgentToolName>): boolean {
  const artifactIntent = /\bartifact\b/.test(message)
    || /\b(create|make|write|draft|generate|update|replace|append|continue|revise|rewrite|rework|open)\b.*\b(markdown|md|html|txt|csv|document|note|report|sheet|table)\b/.test(message)
    || /\b(active artifact|current artifact|this artifact|this document|this note|this report|this csv|this sheet|append to this)\b/.test(message);
  const hasArtifactTools = hasAnyTool(currentToolNames, [
    'artifact.list',
    'artifact.get_active',
    'artifact.read',
    'artifact.create',
    'artifact.delete',
    'artifact.replace_content',
    'artifact.append_content',
  ]);
  return artifactIntent && !hasArtifactTools;
}

function needsFileEditPack(message: string, currentToolNames: Set<AgentToolName>): boolean {
  const fileIntent = /\b(file|files|directory|folder|workspace|repo|repository|codebase|read|write|edit|patch|rename|mkdir|move)\b/.test(message);
  const hasFileTools = hasAnyTool(currentToolNames, [
    'filesystem.list',
    'filesystem.search',
    'filesystem.read',
    'filesystem.patch',
    'filesystem.write',
  ]);
  return fileIntent && !hasFileTools;
}

function needsFileCachePack(message: string, currentToolNames: Set<AgentToolName>): boolean {
  const fileCacheIntent = /\b(index workspace|index the workspace|file cache|cached files|cached chunks|chunk id|read chunk|search cache|search indexed|index codebase)\b/.test(message);
  const codeAnalysisIntent = /\b(codebase|repo|repository|workspace|pull request|pr diff|diff|review|regression|debug|diagnose|investigate|root cause|inspect|look into|analy[sz]e|understand|trace|refactor|migration|architecture)\b/.test(message);
  const hasFileCacheTools = hasAnyTool(currentToolNames, [
    'filesystem.index_workspace',
    'filesystem.answer_from_cache',
    'filesystem.search_file_cache',
    'filesystem.read_file_chunk',
  ]);
  return !hasFileCacheTools && (fileCacheIntent || codeAnalysisIntent);
}

function needsTerminalHeavyPack(message: string, currentToolNames: Set<AgentToolName>): boolean {
  const terminalIntent = /\b(terminal|shell|command|process|npm|pnpm|yarn|node|build|test|server|run|start|stdout|stderr|logs?)\b/.test(message);
  const hasTerminalTools = hasAnyTool(currentToolNames, [
    'terminal.exec',
    'terminal.spawn',
    'terminal.write',
  ]);
  return terminalIntent && !hasTerminalTools;
}

function needsTerminalProcessControlPack(message: string, currentToolNames: Set<AgentToolName>): boolean {
  const processControlIntent = /\b(stop|kill|interrupt|ctrl\+c|terminate|cancel|respond|input|password|prompt|confirm|enter yes|enter no)\b/.test(message);
  const hasProcessControlTools = hasAnyTool(currentToolNames, [
    'terminal.write',
    'terminal.kill',
  ]);
  return processControlIntent && !hasProcessControlTools;
}

function needsChatRecallPack(message: string, currentToolNames: Set<AgentToolName>): boolean {
  const recallIntent = /\b(history|prior|previous|earlier|conversation|thread|recall|chat history|last message)\b/.test(message);
  const hasRecallTools = hasAnyTool(currentToolNames, [
    'chat.read_last',
    'chat.search',
    'chat.read_window',
    'chat.read_message',
    'chat.recall',
  ]);
  return recallIntent && !hasRecallTools;
}

function needsOrchestrationPack(message: string, currentToolNames: Set<AgentToolName>): boolean {
  const delegationIntent = /\b(subagent|sub-agent|delegate|delegation|parallel|worker|workers|multiple agents?|split the work)\b/.test(message);
  const hasOrchestrationTools = hasAnyTool(currentToolNames, [
    'subagent.spawn',
    'subagent.wait',
    'subagent.list',
  ]);
  return delegationIntent && !hasOrchestrationTools;
}
