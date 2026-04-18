import type { ProviderId, RuntimeLedgerEvent, RuntimeTaskEntitySnapshot, RuntimeTaskAwareness, TaskMemoryEntry } from '../../shared/types/model';
export declare class RuntimeLedgerStore {
    private events;
    constructor();
    listRecent(taskId?: string, limit?: number): RuntimeLedgerEvent[];
    append(event: Omit<RuntimeLedgerEvent, 'id'>): RuntimeLedgerEvent;
    recordTaskStatus(input: {
        taskId: string;
        providerId?: ProviderId;
        runId?: string;
        status: 'running' | 'completed' | 'failed';
        summary: string;
        metadata?: Record<string, unknown>;
    }): RuntimeLedgerEvent;
    recordProviderSwitch(taskId: string, fromProviderId: ProviderId, toProviderId: ProviderId): RuntimeLedgerEvent;
    recordArtifactEvent(input: {
        taskId?: string | null;
        providerId?: ProviderId;
        summary: string;
        metadata?: Record<string, unknown>;
    }): RuntimeLedgerEvent;
    recordToolEvent(input: {
        taskId?: string | null;
        providerId?: ProviderId;
        runId?: string;
        summary: string;
        metadata?: Record<string, unknown>;
    }): RuntimeLedgerEvent;
    recordBrowserEvent(input: {
        taskId?: string | null;
        summary: string;
        metadata?: Record<string, unknown>;
    }): RuntimeLedgerEvent;
    recordSubagentEvent(input: {
        taskId?: string | null;
        providerId?: ProviderId;
        runId?: string;
        summary: string;
        metadata?: Record<string, unknown>;
    }): RuntimeLedgerEvent;
    recordTaskMemoryEntry(entry: TaskMemoryEntry): RuntimeLedgerEvent;
    getTaskAwareness(taskId: string): RuntimeTaskAwareness;
    getTaskEntitySnapshot(taskId: string): RuntimeTaskEntitySnapshot;
    buildTaskSwitchContext(input: {
        taskId: string;
        prompt: string;
    }): string | null;
    buildHydrationContext(input: {
        taskId: string;
        currentProviderId: ProviderId;
        providerSwitched?: boolean;
    }): string | null;
    private attachBrowserEventListeners;
    private findRelevantPriorTaskAwareness;
    private deriveCurrentRunSnapshot;
    private deriveArtifactSnapshots;
    private deriveBrowserTabSnapshots;
    private deriveDecisionSnapshots;
    private deriveEvidenceSnapshots;
}
export declare const runtimeLedgerStore: RuntimeLedgerStore;
