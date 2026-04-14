import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { generateId } from '../../shared/utils/ids';
import type { AnyProviderId } from '../../shared/types/model';

export type ChatMessageRole = 'user' | 'assistant' | 'tool' | 'system';

export type ChatMessageMeta = {
  id: string;
  taskId: string;
  role: ChatMessageRole;
  providerId?: AnyProviderId;
  runId?: string;
  createdAt: number;
  charCount: number;
  tokenEstimate: number;
  preview: string;
  anchors: string[];
};

export type ChatSearchResult = {
  messageId: string;
  role: ChatMessageRole;
  providerId?: AnyProviderId;
  createdAt: number;
  preview: string;
  snippet: string;
  anchors: string[];
  score: number;
};

type ThreadIndex = {
  taskId: string;
  messages: ChatMessageMeta[];
  summary: string;
  updatedAt: number | null;
};

const CHAT_CACHE_DIR = 'chat-cache';
const THREAD_INDEX_FILE = 'thread.json';
const MAX_MESSAGES_PER_THREAD = 500;
const PREVIEW_CHARS = 260;
const SUMMARY_CHARS = 1500;
const DEFAULT_READ_CHARS = 3000;
const DEFAULT_SEARCH_LIMIT = 5;
const STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'and', 'are', 'because', 'been', 'before', 'being',
  'can', 'could', 'did', 'does', 'doing', 'done', 'for', 'from', 'had', 'has', 'have',
  'how', 'into', 'just', 'last', 'like', 'more', 'need', 'needs', 'now', 'our', 'out',
  'please', 'should', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'this',
  'those', 'was', 'what', 'when', 'where', 'which', 'while', 'with', 'would', 'you',
]);

function cacheRoot(): string {
  return path.join(app.getPath('userData'), CHAT_CACHE_DIR);
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function truncate(text: string, maxChars: number, suffix = '...[truncated]'): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - suffix.length))}${suffix}`;
}

function normalizeTerms(query: string): string[] {
  return Array.from(new Set(
    query.toLowerCase()
      .split(/[^a-z0-9_.$/@:-]+/)
      .filter(term => term.length >= 2 && !STOP_WORDS.has(term)),
  ));
}

function extractAnchors(text: string): string[] {
  const anchors = new Set<string>();
  const patterns = [
    /(?:^|\s)([\w./-]+\.(?:ts|tsx|js|jsx|json|md|css|html|yml|yaml|py|go|rs|java|kt|swift|txt))(?=$|\s|[:),.;])/gi,
    /\b(?:https?:\/\/|www\.)[^\s)]+/gi,
    /\b[A-Z][A-Z0-9_]{2,}\b/g,
    /\b(?:[A-Za-z_$][\w$]*\.)?[A-Za-z_$][\w$]*\(\)/g,
    /\b(?:error|exception|failed|failure|warning|todo|fixme|decision|plan|next step|follow-up)\b/gi,
  ];

  for (const pattern of patterns) {
    const matches = text.match(pattern) || [];
    for (const match of matches) {
      const cleaned = match.trim().replace(/^[\s"'`([]+|[\s"'`),.;\]]+$/g, '');
      if (cleaned.length >= 3 && cleaned.length <= 140) anchors.add(cleaned);
      if (anchors.size >= 40) break;
    }
    if (anchors.size >= 40) break;
  }

  return Array.from(anchors);
}

function makeSnippet(text: string, terms: string[], maxChars: number): string {
  const compact = compactWhitespace(text);
  if (terms.length === 0) return truncate(compact, maxChars);
  const lower = compact.toLowerCase();
  const positions = terms.map(term => lower.indexOf(term)).filter(index => index >= 0);
  const first = positions.length > 0 ? Math.min(...positions) : 0;
  const start = Math.max(0, first - 120);
  const snippet = compact.slice(start, start + maxChars);
  return `${start > 0 ? '...' : ''}${snippet}${start + maxChars < compact.length ? '...' : ''}`;
}

function scoreMessage(meta: ChatMessageMeta, text: string, query: string, terms: string[], now: number): number {
  const lowerText = text.toLowerCase();
  const lowerPreview = meta.preview.toLowerCase();
  const lowerAnchors = meta.anchors.join(' ').toLowerCase();
  const lowerQuery = query.toLowerCase().trim();
  let score = 0;

  if (lowerQuery && lowerText.includes(lowerQuery)) score += 12;
  for (const term of terms) {
    if (lowerPreview.includes(term)) score += 4;
    if (lowerAnchors.includes(term)) score += 6;
    const matches = lowerText.split(term).length - 1;
    score += Math.min(matches, 5);
  }

  if (meta.role === 'user') score += 3;
  if (meta.role === 'assistant') score += 2;
  if (meta.role === 'tool') score -= 4;

  const ageHours = Math.max(0, (now - meta.createdAt) / 3_600_000);
  score += Math.max(0, 4 - Math.floor(ageHours / 24));
  return score;
}

export class ChatKnowledgeStore {
  private indexes = new Map<string, ThreadIndex>();

  recordUserMessage(taskId: string, text: string): ChatMessageMeta {
    return this.recordMessage({ taskId, role: 'user', text });
  }

  recordAssistantMessage(taskId: string, text: string, providerId?: AnyProviderId, runId?: string): ChatMessageMeta {
    return this.recordMessage({ taskId, role: 'assistant', providerId, runId, text });
  }

  recordToolMessage(taskId: string, text: string, providerId?: AnyProviderId, runId?: string): ChatMessageMeta {
    return this.recordMessage({ taskId, role: 'tool', providerId, runId, text });
  }

  recordMessage(input: {
    taskId: string;
    role: ChatMessageRole;
    text: string;
    providerId?: AnyProviderId;
    runId?: string;
  }): ChatMessageMeta {
    const text = input.text || '';
    const meta: ChatMessageMeta = {
      id: generateId('msg'),
      taskId: input.taskId,
      role: input.role,
      providerId: input.providerId,
      runId: input.runId,
      createdAt: Date.now(),
      charCount: text.length,
      tokenEstimate: estimateTokens(text),
      preview: truncate(compactWhitespace(text), PREVIEW_CHARS),
      anchors: extractAnchors(text),
    };

    this.ensureMessagesDir(input.taskId);
    fs.writeFileSync(this.messagePath(input.taskId, meta.id), text, 'utf-8');

    const index = this.loadIndex(input.taskId);
    index.messages = [...index.messages, meta].slice(-MAX_MESSAGES_PER_THREAD);
    index.updatedAt = meta.createdAt;
    index.summary = this.buildSummary(index);
    this.saveIndex(index);
    this.indexes.set(input.taskId, index);
    return { ...meta };
  }

  buildInvocationContext(taskId: string, currentMessageId?: string): string | null {
    const current = currentMessageId
      ? this.readMessage(taskId, currentMessageId, 1200)
      : null;
    const summary = this.threadSummary(taskId);
    const recent = this.readLast(taskId, {
      count: 2,
      maxChars: 1000,
      excludeMessageIds: currentMessageId ? [currentMessageId] : [],
    });
    if (!current?.text && !summary && !recent.text) return null;

    const sections = [
      '## Conversation Memory',
      'Full chat history is cached on disk. Use chat.read_last for immediate follow-ups, chat.search for older context, and chat.read_window/read_message only when needed. Do not ask the user to repeat prior context until chat recall has failed.',
    ];
    if (current?.text) sections.push('', '### Current User Message', current.text);
    if (summary) sections.push('', '### Thread Summary', summary);
    if (recent.text) sections.push('', '### Recent Prior Messages', recent.text);
    return sections.join('\n');
  }

  threadSummary(taskId: string): string | null {
    const index = this.loadIndex(taskId);
    return index.summary || null;
  }

  readLast(taskId: string, input?: {
    count?: number;
    maxChars?: number;
    role?: ChatMessageRole;
    excludeMessageIds?: string[];
  }): { text: string; messages: ChatMessageMeta[]; tokenEstimate: number; truncated: boolean } {
    const index = this.loadIndex(taskId);
    const count = Math.min(Math.max(input?.count || 2, 1), 20);
    const maxChars = Math.min(Math.max(input?.maxChars || DEFAULT_READ_CHARS, 200), 12_000);
    const excluded = new Set(input?.excludeMessageIds || []);
    const candidates = index.messages
      .filter(meta => !excluded.has(meta.id))
      .filter(meta => !input?.role || meta.role === input.role)
      .slice(-count);
    return this.renderMessages(taskId, candidates, maxChars);
  }

  search(taskId: string, input: {
    query: string;
    role?: ChatMessageRole;
    includeTools?: boolean;
    limit?: number;
    maxSnippetChars?: number;
  }): { query: string; results: ChatSearchResult[]; tokenEstimate: number } {
    const index = this.loadIndex(taskId);
    const terms = normalizeTerms(input.query);
    const limit = Math.min(Math.max(input.limit || DEFAULT_SEARCH_LIMIT, 1), 20);
    const maxSnippetChars = Math.min(Math.max(input.maxSnippetChars || 420, 120), 1200);
    const now = Date.now();

    const results = index.messages
      .filter(meta => !input.role || meta.role === input.role)
      .filter(meta => input.includeTools || meta.role !== 'tool')
      .map(meta => {
        const text = this.readRawMessage(taskId, meta.id) || meta.preview;
        return { meta, text, score: scoreMessage(meta, text, input.query, terms, now) };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || b.meta.createdAt - a.meta.createdAt)
      .slice(0, limit)
      .map(item => ({
        messageId: item.meta.id,
        role: item.meta.role,
        providerId: item.meta.providerId,
        createdAt: item.meta.createdAt,
        preview: item.meta.preview,
        snippet: makeSnippet(item.text, terms, maxSnippetChars),
        anchors: item.meta.anchors.slice(0, 10),
        score: item.score,
      }));

    const tokenEstimate = estimateTokens(results.map(result => result.snippet).join('\n'));
    return { query: input.query, results, tokenEstimate };
  }

  readMessage(taskId: string, messageId: string, maxChars = DEFAULT_READ_CHARS): {
    message: ChatMessageMeta;
    text: string;
    tokenEstimate: number;
    truncated: boolean;
  } | null {
    const index = this.loadIndex(taskId);
    const meta = index.messages.find(message => message.id === messageId);
    if (!meta) return null;
    const raw = this.readRawMessage(taskId, messageId);
    if (raw === null) return null;
    const clampedMax = Math.min(Math.max(maxChars, 200), 20_000);
    const text = truncate(raw, clampedMax);
    return {
      message: { ...meta },
      text,
      tokenEstimate: estimateTokens(text),
      truncated: raw.length > text.length,
    };
  }

  readWindow(taskId: string, input: {
    messageId?: string;
    before?: number;
    after?: number;
    maxChars?: number;
  }): { text: string; messages: ChatMessageMeta[]; tokenEstimate: number; truncated: boolean } {
    const index = this.loadIndex(taskId);
    const before = Math.min(Math.max(input.before ?? 2, 0), 10);
    const after = Math.min(Math.max(input.after ?? 2, 0), 10);
    const maxChars = Math.min(Math.max(input.maxChars || DEFAULT_READ_CHARS, 200), 20_000);
    const centerIndex = input.messageId
      ? index.messages.findIndex(message => message.id === input.messageId)
      : index.messages.length - 1;
    if (centerIndex < 0) {
      return { text: '', messages: [], tokenEstimate: 0, truncated: false };
    }
    const start = Math.max(0, centerIndex - before);
    const end = Math.min(index.messages.length, centerIndex + after + 1);
    return this.renderMessages(taskId, index.messages.slice(start, end), maxChars);
  }

  recall(taskId: string, input: {
    query: string;
    intent?: string;
    maxChars?: number;
  }): {
    strategy: string;
    summary: string | null;
    text: string;
    matches: ChatSearchResult[];
    tokenEstimate: number;
    truncated: boolean;
  } {
    const maxChars = Math.min(Math.max(input.maxChars || 3000, 500), 12_000);
    const summary = this.threadSummary(taskId);
    const lower = input.query.toLowerCase();
    const looksRecent = /\b(last|previous|prior|again|continue|that|this|it|same|above)\b/.test(lower)
      || input.intent === 'follow_up'
      || input.intent === 'recent';

    if (looksRecent) {
      const recent = this.readLast(taskId, { count: 4, maxChars });
      return {
        strategy: 'recent',
        summary,
        text: recent.text,
        matches: [],
        tokenEstimate: recent.tokenEstimate,
        truncated: recent.truncated,
      };
    }

    const search = this.search(taskId, { query: input.query, limit: 4 });
    if (search.results.length === 0) {
      const recent = this.readLast(taskId, { count: 3, maxChars });
      return {
        strategy: 'recent-fallback',
        summary,
        text: recent.text,
        matches: [],
        tokenEstimate: recent.tokenEstimate,
        truncated: recent.truncated,
      };
    }

    const first = search.results[0];
    const window = this.readWindow(taskId, {
      messageId: first.messageId,
      before: 1,
      after: 1,
      maxChars,
    });
    return {
      strategy: 'search-window',
      summary,
      text: window.text,
      matches: search.results,
      tokenEstimate: window.tokenEstimate + search.tokenEstimate,
      truncated: window.truncated,
    };
  }

  getStats(taskId: string): {
    taskId: string;
    messageCount: number;
    totalChars: number;
    totalTokenEstimate: number;
    updatedAt: number | null;
  } {
    const index = this.loadIndex(taskId);
    return {
      taskId,
      messageCount: index.messages.length,
      totalChars: index.messages.reduce((sum, message) => sum + message.charCount, 0),
      totalTokenEstimate: index.messages.reduce((sum, message) => sum + message.tokenEstimate, 0),
      updatedAt: index.updatedAt,
    };
  }

  private buildSummary(index: ThreadIndex): string {
    const users = index.messages.filter(message => message.role === 'user');
    const assistants = index.messages.filter(message => message.role === 'assistant');
    const firstUser = users[0]?.preview || '';
    const recent = index.messages.slice(-6)
      .map(message => `[${message.id} ${message.role}] ${message.preview}`)
      .join('\n');
    const anchors = Array.from(new Set(index.messages.flatMap(message => message.anchors))).slice(-20);
    const sections: string[] = [];
    if (firstUser) sections.push(`Initial goal: ${firstUser}`);
    sections.push(`Messages cached: ${index.messages.length} (${users.length} user, ${assistants.length} assistant).`);
    if (anchors.length > 0) sections.push(`Recent anchors: ${anchors.join(', ')}`);
    if (recent) sections.push(`Recent message index:\n${recent}`);
    return truncate(sections.join('\n'), SUMMARY_CHARS);
  }

  private renderMessages(taskId: string, messages: ChatMessageMeta[], maxChars: number): {
    text: string;
    messages: ChatMessageMeta[];
    tokenEstimate: number;
    truncated: boolean;
  } {
    let truncated = false;
    const rendered: string[] = [];
    for (const meta of messages) {
      const raw = this.readRawMessage(taskId, meta.id) || meta.preview;
      const header = `[${meta.id} ${meta.role}${meta.providerId ? ` ${meta.providerId}` : ''}]`;
      rendered.push(`${header}\n${raw.trim()}`);
    }
    const rawText = rendered.join('\n\n');
    const text = truncate(rawText, maxChars);
    truncated = rawText.length > text.length;
    return {
      text,
      messages: messages.map(message => ({ ...message })),
      tokenEstimate: estimateTokens(text),
      truncated,
    };
  }

  private loadIndex(taskId: string): ThreadIndex {
    const cached = this.indexes.get(taskId);
    if (cached) return { ...cached, messages: cached.messages.map(message => ({ ...message })) };

    const indexPath = this.indexPath(taskId);
    if (!fs.existsSync(indexPath)) {
      return { taskId, messages: [], summary: '', updatedAt: null };
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf-8')) as ThreadIndex;
      const index: ThreadIndex = {
        taskId,
        messages: Array.isArray(parsed.messages) ? parsed.messages.slice(-MAX_MESSAGES_PER_THREAD) : [],
        summary: typeof parsed.summary === 'string' ? parsed.summary : '',
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : null,
      };
      this.indexes.set(taskId, index);
      return { ...index, messages: index.messages.map(message => ({ ...message })) };
    } catch {
      return { taskId, messages: [], summary: '', updatedAt: null };
    }
  }

  private saveIndex(index: ThreadIndex): void {
    this.ensureTaskDir(index.taskId);
    fs.writeFileSync(this.indexPath(index.taskId), JSON.stringify(index, null, 2), 'utf-8');
  }

  private readRawMessage(taskId: string, messageId: string): string | null {
    const filePath = this.messagePath(taskId, messageId);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf-8');
  }

  private taskDir(taskId: string): string {
    return path.join(cacheRoot(), safeSegment(taskId));
  }

  private messagesDir(taskId: string): string {
    return path.join(this.taskDir(taskId), 'messages');
  }

  private indexPath(taskId: string): string {
    return path.join(this.taskDir(taskId), THREAD_INDEX_FILE);
  }

  private messagePath(taskId: string, messageId: string): string {
    return path.join(this.messagesDir(taskId), `${safeSegment(messageId)}.md`);
  }

  private ensureTaskDir(taskId: string): void {
    fs.mkdirSync(this.taskDir(taskId), { recursive: true });
  }

  private ensureMessagesDir(taskId: string): void {
    fs.mkdirSync(this.messagesDir(taskId), { recursive: true });
  }
}

export const chatKnowledgeStore = new ChatKnowledgeStore();
