import type { AgentToolDefinition, AgentToolName } from './AgentTypes';
import type { AgentTaskKind, AgentToolPackPreset } from '../../shared/types/model';
import type { ToolPackManifest } from './tool-packs/types';
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
export declare const DEFAULT_TOOL_PACK_PRESET: AgentToolPackPreset;
export declare const RUNTIME_SEARCH_TOOLS_TOOL_NAME: "runtime.search_tools";
export declare const RUNTIME_REQUIRE_TOOLS_TOOL_NAME: "runtime.require_tools";
export declare const RUNTIME_INVOKE_TOOL_NAME: "runtime.invoke_tool";
export declare const RUNTIME_REQUEST_TOOL_NAME: "runtime.request_tool_pack";
export declare const RUNTIME_LIST_TOOL_PACKS_TOOL_NAME: "runtime.list_tool_packs";
export declare const LOCAL_FILES_INITIAL_SURFACE_TOOLS: AgentToolName[];
export declare const BROWSER_INITIAL_SURFACE_PACK_IDS: readonly ["research", "browser-automation", "browser-advanced"];
export declare function listToolPacks(): ToolPackManifest[];
export declare function getToolPack(packId: string): ToolPackManifest | null;
export declare function buildRuntimeRequestToolDescription(): string;
export declare function searchToolCatalog(query: string, toolCatalog: Array<Pick<AgentToolDefinition, 'name' | 'description'>>, options?: {
    currentTools?: Array<Pick<AgentToolDefinition, 'name'>>;
    limit?: number;
}): ToolSearchMatch[];
export declare function resolveAllowedToolsForTaskKind(kind: AgentTaskKind, preset?: AgentToolPackPreset): 'all' | AgentToolName[];
export declare function resolveFullSurfaceTools(packId: string): AgentToolName[] | null;
export declare function resolveLocalFilesInitialSurfaceTools(): AgentToolName[];
export declare function resolveBrowserInitialSurfaceTools(): AgentToolName[];
export declare function resolveRequestedToolPack(packId: string, toolCatalog: Array<Pick<AgentToolDefinition, 'name'>>): ToolPackExpansion | null;
export declare function mergeExpandedTools(currentTools: Array<Pick<AgentToolDefinition, 'name' | 'description' | 'inputSchema'>>, toolCatalog: Array<Pick<AgentToolDefinition, 'name' | 'description' | 'inputSchema'>>, expansion: ToolPackExpansion): Array<Pick<AgentToolDefinition, 'name' | 'description' | 'inputSchema'>>;
export declare function resolveAutoExpandedToolPack(message: string, currentTools: Array<Pick<AgentToolDefinition, 'name'>>, toolCatalog: Array<Pick<AgentToolDefinition, 'name' | 'description' | 'inputSchema'>>): AutoToolPackExpansion | null;
export declare function resolvePreflightToolPackExpansions(task: string, currentTools: Array<Pick<AgentToolDefinition, 'name'>>, toolCatalog: Array<Pick<AgentToolDefinition, 'name' | 'description' | 'inputSchema'>>, maxPacks?: number): PreflightToolPackExpansion[];
export {};
