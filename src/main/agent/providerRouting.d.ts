import { type AgentTaskKind, type AgentTaskProfileOverride, type ProviderId } from '../../shared/types/model';
export type PrimaryProviderBackend = 'exec' | 'app-server';
export type ProviderRoutingCapabilities = Partial<Record<ProviderId, {
    supportsV2ToolRuntime: boolean;
}>>;
export declare function taskKindRequiresV2ToolRuntime(kind: AgentTaskKind): boolean;
export declare function shouldPreferExecForTaskKind(taskKind: AgentTaskKind): boolean;
export declare function resolvePrimaryProviderBackend(taskKind: AgentTaskKind, configuredMode?: string | undefined, execAvailable?: boolean): PrimaryProviderBackend;
export declare function providerSupportsPrompt(providerId: ProviderId, prompt: string, overrides?: AgentTaskProfileOverride, capabilities?: ProviderRoutingCapabilities): boolean;
export declare function pickProviderForPrompt(prompt: string, availableProviders: Iterable<ProviderId>, overrides?: AgentTaskProfileOverride, capabilities?: ProviderRoutingCapabilities): ProviderId | null;
