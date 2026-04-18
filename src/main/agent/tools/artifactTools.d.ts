import type { AgentToolDefinition } from '../AgentTypes';
export declare const ARTIFACT_TOOL_NAMES: readonly ["artifact.list", "artifact.get", "artifact.get_active", "artifact.read", "artifact.create", "artifact.delete", "artifact.replace_content", "artifact.append_content"];
export declare function createArtifactToolDefinitions(): AgentToolDefinition[];
