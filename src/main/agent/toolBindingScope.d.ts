import type { AgentProviderRequest, AgentToolBinding, AgentToolName, AgentToolDefinition } from './AgentTypes';
type ToolSchema = Pick<AgentToolDefinition, 'name' | 'description' | 'inputSchema'>;
export declare function createToolBindings(initialTools: ToolSchema[]): AgentToolBinding[];
export declare function promoteQueuedBindings(bindings: AgentToolBinding[]): AgentToolBinding[];
export declare function listCallableTools(bindings: AgentToolBinding[]): ToolSchema[];
export declare function queueExpandedBindings(bindings: AgentToolBinding[], toolCatalog: ToolSchema[], toolNames: AgentToolName[]): AgentToolBinding[];
export declare class AgentToolBindingStore {
    private readonly toolCatalog;
    private bindings;
    constructor(initialBindings: AgentToolBinding[], toolCatalog: ToolSchema[]);
    static fromTools(initialTools: ToolSchema[], toolCatalog: ToolSchema[]): AgentToolBindingStore;
    static fromBindings(initialBindings: AgentToolBinding[], toolCatalog: ToolSchema[]): AgentToolBindingStore;
    beginTurn(): ToolSchema[];
    getCallableTools(): ToolSchema[];
    getBindings(): AgentToolBinding[];
    queueTools(toolNames: AgentToolName[]): void;
}
export declare function createToolBindingStore(initialTools: ToolSchema[], toolCatalog: ToolSchema[]): AgentToolBindingStore;
export declare function createRequestToolBindingStore(request: Pick<AgentProviderRequest, 'toolBindings' | 'toolCatalog' | 'promptTools'>): AgentToolBindingStore;
export declare function listCallableRequestTools(request: Pick<AgentProviderRequest, 'toolBindings' | 'toolCatalog' | 'promptTools'>): ToolSchema[];
export {};
