import type { AgentProviderRequest, AgentToolBinding, AgentToolName, AgentToolDefinition } from './AgentTypes';

type ToolSchema = Pick<AgentToolDefinition, 'name' | 'description' | 'inputSchema'>;

export function createToolBindings(initialTools: ToolSchema[]): AgentToolBinding[] {
  return initialTools.map((tool) => ({
    ...tool,
    state: 'callable',
  }));
}

export function promoteQueuedBindings(bindings: AgentToolBinding[]): AgentToolBinding[] {
  return bindings.map((binding) => (
    binding.state === 'queued_next_turn'
      ? { ...binding, state: 'callable' }
      : binding
  ));
}

export function listCallableTools(bindings: AgentToolBinding[]): ToolSchema[] {
  return bindings
    .filter((binding) => binding.state === 'callable')
    .map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

export function queueExpandedBindings(
  bindings: AgentToolBinding[],
  toolCatalog: ToolSchema[],
  toolNames: AgentToolName[],
): AgentToolBinding[] {
  const bindingsByName = new Map(bindings.map((binding) => [binding.name, binding]));
  const catalogByName = new Map(toolCatalog.map((tool) => [tool.name, tool]));
  const nextBindings = [...bindings];

  for (const toolName of toolNames) {
    const existing = bindingsByName.get(toolName);
    if (existing) {
      if (existing.state === 'discoverable' || existing.state === 'failed' || existing.state === 'evicted') {
        const updated = { ...existing, state: 'queued_next_turn' as const, failureReason: undefined };
        nextBindings[nextBindings.findIndex((binding) => binding.name === toolName)] = updated;
        bindingsByName.set(toolName, updated);
      }
      continue;
    }

    const schema = catalogByName.get(toolName);
    if (!schema) continue;
    const queued: AgentToolBinding = {
      ...schema,
      state: 'queued_next_turn',
    };
    nextBindings.push(queued);
    bindingsByName.set(toolName, queued);
  }

  return nextBindings;
}

export class AgentToolBindingStore {
  private bindings: AgentToolBinding[];

  constructor(
    initialBindings: AgentToolBinding[],
    private readonly toolCatalog: ToolSchema[],
  ) {
    this.bindings = initialBindings.map((binding) => ({ ...binding }));
  }

  static fromTools(initialTools: ToolSchema[], toolCatalog: ToolSchema[]): AgentToolBindingStore {
    return new AgentToolBindingStore(createToolBindings(initialTools), toolCatalog);
  }

  static fromBindings(initialBindings: AgentToolBinding[], toolCatalog: ToolSchema[]): AgentToolBindingStore {
    return new AgentToolBindingStore(initialBindings, toolCatalog);
  }

  beginTurn(): ToolSchema[] {
    this.bindings = promoteQueuedBindings(this.bindings);
    return this.getCallableTools();
  }

  getCallableTools(): ToolSchema[] {
    return listCallableTools(this.bindings);
  }

  getBindings(): AgentToolBinding[] {
    return this.bindings.map((binding) => ({ ...binding }));
  }

  queueTools(toolNames: AgentToolName[]): void {
    this.bindings = queueExpandedBindings(this.bindings, this.toolCatalog, toolNames);
  }
}

export function createToolBindingStore(
  initialTools: ToolSchema[],
  toolCatalog: ToolSchema[],
): AgentToolBindingStore {
  return AgentToolBindingStore.fromTools(initialTools, toolCatalog);
}

export function createRequestToolBindingStore(
  request: Pick<AgentProviderRequest, 'toolBindings' | 'toolCatalog' | 'promptTools'>,
): AgentToolBindingStore {
  return AgentToolBindingStore.fromBindings(request.toolBindings, request.toolCatalog);
}

export function listCallableRequestTools(
  request: Pick<AgentProviderRequest, 'toolBindings' | 'toolCatalog' | 'promptTools'>,
): ToolSchema[] {
  return createRequestToolBindingStore(request).getCallableTools();
}
