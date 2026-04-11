import { AgentProvider } from '../AgentTypes';
import { AgentRuntime } from '../AgentRuntime';

export class SubAgentRuntime extends AgentRuntime {
  constructor(provider: AgentProvider) {
    super(provider);
  }
}
