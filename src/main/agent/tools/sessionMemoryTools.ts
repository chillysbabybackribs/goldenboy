import { AgentToolDefinition } from '../AgentTypes';
import { getChatSessionMemory } from '../../chatKnowledge/ChatSessionMemory';
import { appStateStore } from '../../state/appStateStore';
import { ActionType } from '../../state/actions';
import { generateId } from '../../../shared/utils/ids';

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
      name: 'session.start',
      description: 'Start a new chat session. Returns the session ID.',
      inputSchema: { type: 'object' },
      async execute() {
        const sessionMemory = getChatSessionMemory();
        const sessionId = sessionMemory.startSession();
        logSessionMemory(`Started session: ${sessionId}`);
        return {
          summary: 'Chat session started',
          data: { sessionId },
        };
      },
    },
    {
      name: 'session.end',
      description: 'End the current session and persist the last messages. Should be called before closing a chat.',
      inputSchema: { type: 'object' },
      async execute() {
        const sessionMemory = getChatSessionMemory();
        const sessionId = sessionMemory.getCurrentSessionId();
        const messageCount = sessionMemory.getCurrentSessionMessageCount();
        sessionMemory.endSession();
        logSessionMemory(`Ended session: ${sessionId} with ${messageCount} messages`);
        return {
          summary: 'Session ended and persisted',
          data: { sessionId, messageCount },
        };
      },
    },
    {
      name: 'session.record_message',
      description: 'Record a message in the current session.',
      inputSchema: {
        type: 'object',
        required: ['role', 'content', 'taskId'],
        properties: {
          role: { type: 'string', enum: ['user', 'assistant', 'tool', 'system'] },
          content: { type: 'string' },
          taskId: { type: 'string' },
        },
      },
      async execute(input) {
        const sessionMemory = getChatSessionMemory();
        const obj = objectInput(input);
        
        const role = obj.role as 'user' | 'assistant' | 'tool' | 'system';
        const content = typeof obj.content === 'string' ? obj.content : '';
        const taskId = typeof obj.taskId === 'string' ? obj.taskId : '';

        if (!role || !content || !taskId) {
          throw new Error('Missing required fields: role, content, taskId');
        }

        const message = sessionMemory.recordMessage(role, content, taskId);
        return {
          summary: 'Message recorded in session',
          data: { messageId: message.id },
        };
      },
    },
    {
      name: 'session.get_previous_context',
      description: 'Retrieve the last N messages from the previous session to inject as context.',
      inputSchema: {
        type: 'object',
        properties: {
          count: { type: 'number' },
        },
      },
      async execute(input) {
        const sessionMemory = getChatSessionMemory();
        const obj = objectInput(input);
        const count = optionalNumber(obj, 'count', 10);

        const previousMessages = sessionMemory.getPreviousSessionContext(count);
        const contextString = sessionMemory.buildContextInjectionString(previousMessages);

        logSessionMemory(`Retrieved ${previousMessages.length} messages from previous session`);

        return {
          summary: `Retrieved ${previousMessages.length} messages from previous session`,
          data: {
            messages: previousMessages,
            contextString,
            messageCount: previousMessages.length,
          },
        };
      },
    },
    {
      name: 'session.get_context_string',
      description: 'Get a formatted string of previous session context ready for injection.',
      inputSchema: {
        type: 'object',
        properties: {
          count: { type: 'number' },
        },
      },
      async execute(input) {
        const sessionMemory = getChatSessionMemory();
        const obj = objectInput(input);
        const count = optionalNumber(obj, 'count', 10);

        const previousMessages = sessionMemory.getPreviousSessionContext(count);
        const contextString = sessionMemory.buildContextInjectionString(previousMessages);

        return {
          summary: 'Generated context injection string',
          data: {
            contextString,
            messageCount: previousMessages.length,
            isEmpty: previousMessages.length === 0,
          },
        };
      },
    },
    {
      name: 'session.get_all_sessions',
      description: 'Get all stored session history.',
      inputSchema: { type: 'object' },
      async execute() {
        const sessionMemory = getChatSessionMemory();
        const sessions = sessionMemory.getAllSessions();

        return {
          summary: `Retrieved ${sessions.length} sessions`,
          data: {
            sessions,
            sessionCount: sessions.length,
          },
        };
      },
    },
    {
      name: 'session.clear_all',
      description: 'Clear all stored session memory. Use with caution.',
      inputSchema: { type: 'object' },
      async execute() {
        const sessionMemory = getChatSessionMemory();
        sessionMemory.clearAllSessions();
        logSessionMemory('All sessions cleared', 'warn');

        return {
          summary: 'All sessions cleared',
          data: { success: true },
        };
      },
    },
    {
      name: 'session.stats',
      description: 'Get statistics about the session memory system.',
      inputSchema: { type: 'object' },
      async execute() {
        const sessionMemory = getChatSessionMemory();
        const stats = sessionMemory.getMemoryStats();

        return {
          summary: 'Session memory stats retrieved',
          data: stats,
        };
      },
    },
  ];
}
