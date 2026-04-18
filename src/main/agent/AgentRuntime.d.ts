import { AgentProvider, AgentRuntimeConfig, AgentProviderResult } from './AgentTypes';
import type { AgentProviderRequest } from './AgentTypes';
export declare class AgentRuntime {
    private readonly provider;
    constructor(provider: AgentProvider);
    abort(): void;
    run(config: AgentRuntimeConfig): Promise<AgentProviderResult>;
}
export declare function assertInitialBrowserScope(task: string, toolNames: AgentProviderRequest['promptTools'][number]['name'][], requireBrowserScope?: boolean): void;
