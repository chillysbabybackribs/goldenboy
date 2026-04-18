import type { ArtifactFormat, ArtifactRecord, ArtifactStatus } from '../../shared/types/artifacts';
import type { AgentToolName } from './AgentTypes';
export type ArtifactRoutingMutation = 'replace' | 'append' | 'delete';
export type ArtifactRoutingAction = 'create' | 'update' | 'delete';
export type ArtifactRoutingDecision = {
    applies: boolean;
    action: ArtifactRoutingAction;
    mutation: ArtifactRoutingMutation;
    reason: string;
    targetArtifactId: string | null;
    targetArtifactTitle: string | null;
    targetArtifactFormat: ArtifactFormat | null;
    targetArtifactStatus: ArtifactStatus | null;
    invalidReason: string | null;
};
export declare function buildArtifactRoutingDecision(prompt: string, activeArtifact: ArtifactRecord | null): ArtifactRoutingDecision | null;
export declare function buildArtifactRoutingInstructions(decision: ArtifactRoutingDecision | null): string | null;
export declare function withArtifactRoutingAllowedTools(allowedTools: 'all' | AgentToolName[], decision: ArtifactRoutingDecision | null, fullToolCatalogNames?: AgentToolName[]): 'all' | AgentToolName[];
