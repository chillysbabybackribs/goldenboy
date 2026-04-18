import { AgentProvider, AgentProviderRequest, AgentProviderResult } from './AgentTypes';
export declare class HaikuProvider implements AgentProvider {
    readonly modelId: string;
    readonly supportsAppToolExecutor = true;
    private readonly client;
    private aborted;
    private activeStream;
    constructor(apiKey?: string | null);
    abort(): void;
    invoke(request: AgentProviderRequest): Promise<AgentProviderResult>;
}
