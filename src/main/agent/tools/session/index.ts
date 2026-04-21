import { AgentToolDefinition } from '../../AgentTypes';
import { getChatSessionMemory } from '../../../chatKnowledge/ChatSessionMemory';
import { appStateStore } from '../../../state/appStateStore';
import { ActionType } from '../../../state/actions';
import { generateId } from '../../../../shared/utils/ids';

function objectInput(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? input as Record<string, unknown> : {};
}

function optionalNumber(input: Record<string, unknown>, key: string, fallback: number): number {
  const value = input[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function logSessionMemory(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
  appStateStore.dispatch({
    type: ActionType.ADD_LOG,
    log: {
      id: generateId('log'),
      timestamp: Date.now(),
      level,
      source: 'session-memory',
      message,
    },
  });
}

export function createSessionMemoryToolDefinitions(): AgentToolDefinition[] {
  return [
    {
      name: 'session.resume_previous',
      description: 'Fetch the last N messages from the previous chat session as opt-in resume context. Call only when the user asks to continue prior work.',
      inputSchema: {
        type: 'object',
        properties: { count: { type: 'number' } },
      },
      async execute(input) {
        const sessionMemory = getChatSessionMemory();
        const count = optionalNumber(objectInput(input), 'count', 10);
        const messages = sessionMemory.getPreviousSessionContext(count);
        const contextString = sessionMemory.buildContextInjectionString(messages);
        logSessionMemory(`Retrieved ${messages.length} messages from previous session`);
        return {
          summary: `Retrieved ${messages.length} messages from previous session`,
          data: { messages, contextString, messageCount: messages.length },
        };
      },
    },
  ];
}
