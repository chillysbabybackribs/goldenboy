import { type ProviderId } from '../../shared/types/model';
import type { AgentProvider, AgentProviderRequest, AgentProviderResult } from './AgentTypes';
import type { AppServerProcess } from './AppServerProcess';
type ThreadEntry = {
    threadId: string;
    savedAt: number;
};
type ThreadRegistry = Record<string, ThreadEntry>;
export declare function pruneExpiredEntries(entries: ThreadRegistry, now: number): ThreadRegistry;
export declare function loadThreadRegistry(): ThreadRegistry;
export declare function saveThreadRegistry(registry: ThreadRegistry): void;
type AppServerProviderOptions = {
    providerId?: ProviderId;
    modelId?: string;
    process: AppServerProcess;
    contextPath?: string;
};
export declare class AppServerProvider implements AgentProvider {
    private readonly options;
    readonly providerId: ProviderId;
    readonly modelId: string;
    readonly supportsAppToolExecutor = true;
    private aborted;
    private abortCurrentTurn;
    private ws;
    private threadRegistry;
    private nextId;
    private readonly contextPath;
    constructor(options: AppServerProviderOptions);
    abort(): void;
    connect(wsPort: number): Promise<void>;
    invoke(request: AgentProviderRequest): Promise<AgentProviderResult>;
    private acquireThread;
    private startThread;
    private resumeThread;
    private runOneTurn;
    private writeContextFile;
    private itemPrefix;
    private buildTurnStartInput;
}
export {};
