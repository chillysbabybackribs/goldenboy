import type { ProviderId } from '../../shared/types/model';
import type { AgentProvider, AgentProviderRequest, AgentProviderResult } from './AgentTypes';
import type { AppServerProcess } from './AppServerProcess';
type AppServerBackedProviderOptions = {
    providerId: ProviderId;
    modelId: string;
    process?: AppServerProcess;
    wsPort?: number;
};
export declare class AppServerBackedProvider implements AgentProvider {
    private readonly options;
    readonly supportsAppToolExecutor = true;
    private delegate;
    private connectPromise;
    private pendingAbort;
    private ownedBridge;
    private ownedProcess;
    private ownedContextPath;
    constructor(options: AppServerBackedProviderOptions);
    prewarm(): Promise<void>;
    invoke(request: AgentProviderRequest): Promise<AgentProviderResult>;
    abort(): void;
    dispose(): Promise<void>;
    private getDelegate;
    private startOwnedSession;
}
export {};
