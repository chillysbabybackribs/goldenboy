import { type AgentTaskKind, type ProviderId } from '../../shared/types/model';
export declare function buildStartupStatusMessages(input: {
    taskKind: AgentTaskKind;
    browserSurfaceReady: boolean;
}): string[];
export declare function resolveExecutionBackendLabel(providerId: ProviderId): string;
