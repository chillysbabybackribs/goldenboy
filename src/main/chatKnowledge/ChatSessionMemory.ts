import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { generateId } from '../../shared/utils/ids';

/**
 * ChatSessionMemory: Persistent cross-session memory for the last N messages
 * Automatically saves the last 10 messages from each chat session and
 * retrieves them to inject as context in subsequent sessions.
 */

export type SessionMessage = {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  createdAt: number;
  taskId: string;
};

export type SessionMemoryEntry = {
  sessionId: string;
  messages: SessionMessage[];
  savedAt: number;
  sessionStartedAt: number;
  sessionEndedAt?: number;
};

const CHAT_SESSIONS_DIR = 'chat-sessions';
const SESSION_MEMORY_FILE = 'session-memory.json';
const MAX_MESSAGES_TO_RETAIN = 10;
const MAX_SESSIONS_TO_STORE = 20;

function sessionRoot(): string {
  return path.join(app.getPath('userData'), CHAT_SESSIONS_DIR);
}

function sessionMemoryPath(): string {
  return path.join(sessionRoot(), SESSION_MEMORY_FILE);
}

function ensureSessionDir(): void {
  const dir = sessionRoot();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export class ChatSessionMemory {
  private currentSessionId: string | null = null;
  private currentSessionStartedAt: number | null = null;
  private currentSessionMessages: SessionMessage[] = [];
  private sessionHistory: Map<string, SessionMemoryEntry> = new Map();

  constructor() {
    this.loadSessionMemory();
  }

  /**
   * Start a new chat session
   */
  startSession(): string {
    // If a session is already active, save it
    if (this.currentSessionId) {
      this.endSession();
    }

    this.currentSessionId = generateId('session');
    this.currentSessionStartedAt = Date.now();
    this.currentSessionMessages = [];
    return this.currentSessionId;
  }

  /**
   * Get the current session ID
   */
  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * End the current session and persist the last N messages
   */
  endSession(): void {
    if (!this.currentSessionId) {
      return;
    }

    // Retain only the last MAX_MESSAGES_TO_RETAIN messages
    const messagesToSave = this.currentSessionMessages.slice(-MAX_MESSAGES_TO_RETAIN);

    const entry: SessionMemoryEntry = {
      sessionId: this.currentSessionId,
      messages: messagesToSave,
      savedAt: Date.now(),
      sessionStartedAt: this.currentSessionStartedAt ?? Date.now(),
      sessionEndedAt: Date.now(),
    };

    // Add to history
    this.sessionHistory.set(this.currentSessionId, entry);

    // Keep only the most recent sessions
    if (this.sessionHistory.size > MAX_SESSIONS_TO_STORE) {
      const oldestSession = Array.from(this.sessionHistory.keys())[0];
      this.sessionHistory.delete(oldestSession);
    }

    // Persist to disk
    this.saveSessionMemory();

    this.currentSessionId = null;
    this.currentSessionStartedAt = null;
    this.currentSessionMessages = [];
  }

  /**
   * Record a message in the current session
   */
  recordMessage(role: 'user' | 'assistant' | 'tool' | 'system', content: string, taskId: string): SessionMessage {
    const message: SessionMessage = {
      id: generateId('msg'),
      role,
      content,
      createdAt: Date.now(),
      taskId,
    };

    this.currentSessionMessages.push(message);
    return message;
  }

  /**
   * Get the last N messages from the previous session (for context injection)
   */
  getPreviousSessionContext(count: number = MAX_MESSAGES_TO_RETAIN): SessionMessage[] {
    if (this.sessionHistory.size === 0) {
      return [];
    }

    // Get the most recent session
    const sessions = Array.from(this.sessionHistory.values())
      .sort((a, b) => (b.sessionEndedAt || b.savedAt) - (a.sessionEndedAt || a.savedAt));

    if (sessions.length === 0) {
      return [];
    }

    const mostRecentSession = sessions[0];
    return mostRecentSession.messages.slice(-count);
  }

  /**
   * Build a context injection string from previous session messages
   */
  buildContextInjectionString(previousMessages: SessionMessage[] = []): string {
    if (previousMessages.length === 0) {
      return '';
    }

    const lines = ['## Previous Session Context (Last Chat)'];
    for (const msg of previousMessages) {
      const role = msg.role.toUpperCase();
      const contentPreview = msg.content.length > 150 
        ? msg.content.slice(0, 150) + '...[truncated]'
        : msg.content;
      lines.push(`[${role}] ${contentPreview}`);
    }

    return lines.join('\n');
  }

  /**
   * Clear all stored sessions
   */
  clearAllSessions(): void {
    this.sessionHistory.clear();
    this.currentSessionId = null;
    this.currentSessionStartedAt = null;
    this.currentSessionMessages = [];
    this.saveSessionMemory();
  }

  /**
   * Get all session history
   */
  getAllSessions(): SessionMemoryEntry[] {
    return Array.from(this.sessionHistory.values());
  }

  /**
   * Get session count
   */
  getSessionCount(): number {
    return this.sessionHistory.size;
  }

  /**
   * Get current session message count
   */
  getCurrentSessionMessageCount(): number {
    return this.currentSessionMessages.length;
  }

  /**
   * Load session memory from disk
   */
  private loadSessionMemory(): void {
    try {
      ensureSessionDir();
      const filepath = sessionMemoryPath();

      if (!fs.existsSync(filepath)) {
        return; // No previous sessions
      }

      const content = fs.readFileSync(filepath, 'utf-8');
      const data = JSON.parse(content);

      if (Array.isArray(data)) {
        for (const entry of data) {
          this.sessionHistory.set(entry.sessionId, entry);
        }
      }
    } catch (error) {
      console.warn('Failed to load session memory:', error);
      // Continue with empty history on load failure
    }
  }

  /**
   * Save session memory to disk
   */
  private saveSessionMemory(): void {
    try {
      ensureSessionDir();
      const filepath = sessionMemoryPath();

      const sessions = Array.from(this.sessionHistory.values());
      const content = JSON.stringify(sessions, null, 2);
      fs.writeFileSync(filepath, content, 'utf-8');
    } catch (error) {
      console.error('Failed to save session memory:', error);
      throw new Error(`Failed to persist chat session memory: ${error}`);
    }
  }

  /**
   * Get statistics about session memory
   */
  getMemoryStats() {
    return {
      sessionCount: this.sessionHistory.size,
      currentSessionId: this.currentSessionId,
      currentSessionMessageCount: this.currentSessionMessages.length,
      totalMessageCount: Array.from(this.sessionHistory.values())
        .reduce((sum, session) => sum + session.messages.length, 0),
      memoryPath: sessionMemoryPath(),
    };
  }
}

// Singleton instance
let instance: ChatSessionMemory | null = null;

export function getChatSessionMemory(): ChatSessionMemory {
  if (!instance) {
    instance = new ChatSessionMemory();
  }
  return instance;
}

export function createNewChatSessionMemory(): ChatSessionMemory {
  return new ChatSessionMemory();
}
