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
import { terminalHeavyToolPack } from './tool-packs/terminalHeavy';
import { fileEditToolPack } from './tool-packs/fileEdit';
import { chatRecallToolPack } from './tool-packs/chatRecall';
import { allToolsToolPack } from './tool-packs/allTools';

type NormalizedTaskKind =
  | 'orchestration'
  | 'research'
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

export const DEFAULT_TOOL_PACK_PRESET: AgentToolPackPreset = 'mode-6';
export const RUNTIME_REQUEST_TOOL_NAME = 'runtime.request_tool_pack' as const;

const TASK_PACK_BY_KIND: Record<NormalizedTaskKind, ToolPackManifest> = {
  orchestration: orchestrationToolPack,
  research: researchToolPack,
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
  terminalHeavyToolPack,
  fileEditToolPack,
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
    case 'local-code':
      return 'implementation';
    default:
      return kind;
  }
}

function withRuntimeRequestTool(tools: AgentToolName[]): AgentToolName[] {
  return [RUNTIME_REQUEST_TOOL_NAME, ...tools];
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
  const packs = ALL_TOOL_PACKS
    .map((pack) => `- ${pack.id}: ${pack.description}`)
    .join('\n');
  return [
    'Request an additional host-managed tool pack when the current scope is insufficient.',
    'Use this immediately when you are blocked by missing tools instead of guessing or continuing with degraded output.',
    'Available packs:',
    packs,
  ].join('\n');
}

export function resolveAllowedToolsForTaskKind(
  kind: AgentTaskKind,
  preset: AgentToolPackPreset = DEFAULT_TOOL_PACK_PRESET,
): 'all' | AgentToolName[] {
  if (preset === 'all') return 'all';
  const manifest = TASK_PACK_BY_KIND[normalizeTaskKind(kind)];
  return uniqueToolNames(withRuntimeRequestTool(requiredBaselineTools(manifest, preset)));
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
