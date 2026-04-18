import { type ProviderId } from '../../shared/types/model';
import { AgentProvider, AgentProviderRequest, AgentProviderResult } from './AgentTypes';
type CodexProviderOptions = {
    providerId?: ProviderId;
    modelId?: string;
};
export declare class CodexProvider implements AgentProvider {
    readonly providerId: ProviderId;
    readonly modelId: string;
    readonly supportsAppToolExecutor = true;
    private aborted;
    private activeProcess;
    constructor(options?: CodexProviderOptions);
    static isAvailable(): {
        available: boolean;
        error?: string;
    };
    abort(): void;
    invoke(request: AgentProviderRequest): Promise<AgentProviderResult>;
    private invokeCodexTurn;
    private itemPrefix;
}
export {};
