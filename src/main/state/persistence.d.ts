import { AppState, ExecutionSplitState } from '../../shared/types/appState';
import { ArtifactRecord } from '../../shared/types/artifacts';
type PersistedTaskRecord = {
    id: string;
    title: string;
    status: string;
    owner: string;
    artifactIds?: string[];
    createdAt: number;
    updatedAt: number;
};
type PersistedArtifactRecord = ArtifactRecord;
type PersistedState = {
    executionSplit: ExecutionSplitState;
    windows: AppState['windows'];
    tasks?: PersistedTaskRecord[];
    activeTaskId?: string | null;
    artifacts?: PersistedArtifactRecord[];
    activeArtifactId?: string | null;
    tokenUsage?: {
        inputTokens: number;
        outputTokens: number;
    };
};
export declare function loadPersistedState(): Partial<PersistedState>;
export declare function savePersistedState(state: AppState): void;
export declare function buildInitialState(): AppState;
export {};
