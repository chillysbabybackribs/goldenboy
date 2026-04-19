import * as fs from 'fs';
import * as os from 'os';
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
const RECENT_CONVERSATION_MESSAGE_COUNT = 4;
const FULL_CONVERSATION_MESSAGE_COUNT = 6;
const STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'and', 'are', 'because', 'been', 'before', 'being',
  'can', 'could', 'did', 'does', 'doing', 'done', 'for', 'from', 'had', 'has', 'have',
  'how', 'into', 'just', 'last', 'like', 'more', 'need', 'needs', 'now', 'our', 'out',
  'please', 'should', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'this',
  'those', 'was', 'what', 'when', 'where', 'which', 'while', 'with', 'would', 'you',
]);

function cacheRoot(): string {
  const userDataRoot = typeof app?.getPath === 'function'
    ? app.getPath('userData')
    : (process.env.V2_TEST_USER_DATA || os.tmpdir());
  return path.join(userDataRoot, CHAT_CACHE_DIR);
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
    const recentMessages = this.selectHydrationMessages(taskId, {
      need: 'full',
      currentMessageId,
      includeToolResults: false,
    });
    const recent = this.renderHydrationMessages(taskId, recentMessages, 1400, { compactToolResults: true });
    if (!current?.text && !summary && !recent.trim()) return null;

    const sections = ['## Conversation Context'];
    if (current?.text) sections.push('', '### Current User Message', current.text);
    if (summary) sections.push('', '### Thread Summary', summary);
    if (recent.trim()) sections.push('', '### Recent Conversation', recent);
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
    excludeMessageIds?: string[];
  }): { query: string; results: ChatSearchResult[]; tokenEstimate: number } {
    const index = this.loadIndex(taskId);
    const terms = normalizeTerms(input.query);
    const limit = Math.min(Math.max(input.limit || DEFAULT_SEARCH_LIMIT, 1), 20);
    const maxSnippetChars = Math.min(Math.max(input.maxSnippetChars || 420, 120), 1200);
    const now = Date.now();
    const excluded = new Set(input.excludeMessageIds || []);

    const results = index.messages
      .filter(meta => !excluded.has(meta.id))
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
    excludeMessageIds?: string[];
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
    const excluded = input.excludeMessageIds || [];
    const looksRecent = /\b(last|previous|prior|again|continue|that|this|it|same|above)\b/.test(lower)
      || input.intent === 'follow_up'
      || input.intent === 'recent';

    if (looksRecent) {
      const recentMessages = this.selectHydrationMessages(taskId, {
        need: 'recent',
        excludeMessageIds: excluded,
        includeToolResults: true,
      });
      const text = this.renderHydrationMessages(taskId, recentMessages, maxChars, { compactToolResults: true });
      return {
        strategy: 'recent',
        summary,
        text,
        matches: [],
        tokenEstimate: estimateTokens(text),
        truncated: text.length >= maxChars,
      };
    }

    const search = this.search(taskId, { query: input.query, limit: 4, excludeMessageIds: excluded });
    if (search.results.length === 0) {
      const recentMessages = this.selectHydrationMessages(taskId, {
        need: 'recent',
        excludeMessageIds: excluded,
        includeToolResults: true,
      });
      const text = this.renderHydrationMessages(taskId, recentMessages, maxChars, { compactToolResults: true });
      return {
        strategy: 'recent-fallback',
        summary,
        text,
        matches: [],
        tokenEstimate: estimateTokens(text),
        truncated: text.length >= maxChars,
      };
    }

    const windowMessages = this.selectHydrationMessages(taskId, {
      need: 'searched',
      searchQuery: input.query,
      excludeMessageIds: excluded,
      includeToolResults: true,
    });
    const text = this.renderHydrationMessages(taskId, windowMessages, maxChars, { compactToolResults: true });
    return {
      strategy: 'search-window',
      summary,
      text,
      matches: search.results,
      tokenEstimate: estimateTokens(text) + search.tokenEstimate,
      truncated: text.length >= maxChars,
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

  /**
   * Build silent hydration context for invisible injection into prompts.
   *
   * Returns ONLY the content without headers, labels, or metadata.
   * Designed to be prepended to contextPrompt with no visible markers.
   *
   * Returns null if nothing meaningful to inject.
   */
  buildSilentHydrationContext(taskId: string, input: {
    need: 'recent' | 'full' | 'searched';
    searchQuery?: string;
    maxChars?: number;
    currentMessageId?: string;
    excludeToolResults?: boolean;
  }): string | null {
    const maxChars = Math.min(Math.max(input.maxChars || 2000, 200), 12_000);
    const candidates = this.selectHydrationMessages(taskId, {
      need: input.need,
      searchQuery: input.searchQuery,
      currentMessageId: input.currentMessageId,
      includeToolResults: input.excludeToolResults !== true,
    });

    if (candidates.length === 0) {
      return null;
    }

    const rendered = this.renderSilentHydrationMessages(taskId, candidates, maxChars, {
      compactToolResults: input.excludeToolResults !== false,
    });
    if (!rendered.trim()) {
      return null;
    }

    if (input.need === 'full') {
      const summary = this.buildSilentSummary(this.loadIndex(taskId));
      if (summary) {
        return truncate(`${summary}\n\n${rendered}`, maxChars, '\n...[conversation truncated]');
      }
    }

    return rendered;
  }

  private buildSilentSummary(index: ThreadIndex): string | null {
    const users = index.messages.filter(message => message.role === 'user');
    const assistants = index.messages.filter(message => message.role === 'assistant');
    const firstUser = users[0]?.preview?.trim();
    const latestUser = users[users.length - 1]?.preview?.trim();
    const latestAssistant = assistants[assistants.length - 1]?.preview?.trim();
    const parts: string[] = [];

    if (firstUser) parts.push(`The task began with the request: ${firstUser}`);
    if (latestUser && latestUser !== firstUser) parts.push(`Most recently, the user asked: ${latestUser}`);
    if (latestAssistant) parts.push(`The latest assistant result was: ${latestAssistant}`);

    return parts.length > 0 ? parts.join('\n') : null;
  }

  private buildSummary(index: ThreadIndex): string {
    const users = index.messages.filter(message => message.role === 'user');
    const assistants = index.messages.filter(message => message.role === 'assistant');
    const recentConversation = index.messages.filter(message => message.role !== 'tool').slice(-6);
    const recentTools = index.messages.filter(message => message.role === 'tool').slice(-3);
    const firstUser = users[0]?.preview || '';
    const latestUser = users[users.length - 1]?.preview || '';
    const latestAssistant = assistants[assistants.length - 1]?.preview || '';
    const recent = recentConversation
      .map(message => `${this.messageRoleLabel(message)}: ${message.preview}`)
      .join('\n');
    const recentToolPreview = recentTools.map(message => message.preview).filter(Boolean).join(' | ');
    const anchors = Array.from(new Set(index.messages.flatMap(message => message.anchors))).slice(-12);
    const sections: string[] = [];
    if (firstUser) sections.push(`Initial goal: ${firstUser}`);
    if (latestUser) sections.push(`Latest user intent: ${latestUser}`);
    if (latestAssistant) sections.push(`Latest assistant result: ${latestAssistant}`);
    sections.push(`Messages cached: ${index.messages.length} (${users.length} user, ${assistants.length} assistant).`);
    if (recent) sections.push(`Recent conversation:\n${recent}`);
    if (recentToolPreview) sections.push(`Recent tool activity: ${recentToolPreview}`);
    if (anchors.length > 0) sections.push(`Active references: ${anchors.join(', ')}`);
    return truncate(sections.join('\n'), SUMMARY_CHARS);
  }

  private selectHydrationMessages(taskId: string, input: {
    need: 'recent' | 'full' | 'searched';
    searchQuery?: string;
    currentMessageId?: string;
    excludeMessageIds?: string[];
    includeToolResults?: boolean;
  }): ChatMessageMeta[] {
    const index = this.loadIndex(taskId);
    const excluded = new Set([
      ...(input.excludeMessageIds || []),
      ...(input.currentMessageId ? [input.currentMessageId] : []),
    ]);
    const includeToolResults = input.includeToolResults === true;
    const recentCount = input.need === 'full' ? FULL_CONVERSATION_MESSAGE_COUNT : RECENT_CONVERSATION_MESSAGE_COUNT;

    const selectRecent = (): ChatMessageMeta[] => {
      const preferred = index.messages
        .filter(meta => !excluded.has(meta.id))
        .filter(meta => includeToolResults || meta.role !== 'tool')
        .slice(-recentCount);
      if (preferred.length > 0) return preferred;
      return index.messages
        .filter(meta => !excluded.has(meta.id))
        .slice(-recentCount);
    };

    if (input.need === 'recent' || input.need === 'full') {
      return selectRecent();
    }

    if (!input.searchQuery?.trim()) {
      return selectRecent();
    }

    const result = this.search(taskId, {
      query: input.searchQuery,
      includeTools: includeToolResults,
      limit: 4,
      maxSnippetChars: 400,
      excludeMessageIds: Array.from(excluded),
    });
    if (result.results.length === 0) {
      return selectRecent();
    }

    const selectedIds = new Set<string>();
    for (const match of result.results) {
      const center = index.messages.findIndex(message => message.id === match.messageId);
      if (center < 0) continue;

      for (let offset = -1; offset <= 1; offset += 1) {
        const candidate = index.messages[center + offset];
        if (!candidate || excluded.has(candidate.id)) continue;
        if (!includeToolResults && candidate.role === 'tool') continue;
        selectedIds.add(candidate.id);
      }

      if (!includeToolResults && index.messages[center]?.role === 'tool') {
        const previousConversation = [...index.messages.slice(0, center)]
          .reverse()
          .find(message => !excluded.has(message.id) && message.role !== 'tool');
        const nextConversation = index.messages
          .slice(center + 1)
          .find(message => !excluded.has(message.id) && message.role !== 'tool');
        if (previousConversation) selectedIds.add(previousConversation.id);
        if (nextConversation) selectedIds.add(nextConversation.id);
      }
    }

    const selected = index.messages.filter(message => selectedIds.has(message.id));
    return selected.length > 0 ? selected.slice(-FULL_CONVERSATION_MESSAGE_COUNT) : selectRecent();
  }

  private renderHydrationMessages(
    taskId: string,
    messages: ChatMessageMeta[],
    maxChars: number,
    input?: { compactToolResults?: boolean },
  ): string {
    if (messages.length === 0) return '';

    const parts = messages.map((meta) => {
      const raw = this.readRawMessage(taskId, meta.id) || meta.preview;
      const body = meta.role === 'tool' && input?.compactToolResults !== false ? meta.preview : raw.trim();
      const maxMessageChars = meta.role === 'assistant'
        ? 700
        : meta.role === 'user'
          ? 420
          : 260;
      const text = truncate(body, maxMessageChars, '\n...[message truncated]');
      const label = `${this.messageRoleLabel(meta)}:`;
      return text.includes('\n') ? `${label}\n${text}` : `${label} ${text}`;
    });

    return truncate(parts.join('\n\n'), maxChars, '\n...[conversation truncated]');
  }

  private renderSilentHydrationMessages(
    taskId: string,
    messages: ChatMessageMeta[],
    maxChars: number,
    input?: { compactToolResults?: boolean },
  ): string {
    if (messages.length === 0) return '';

    const parts = messages.map((meta, index) => {
      const raw = this.readRawMessage(taskId, meta.id) || meta.preview;
      const body = meta.role === 'tool' && input?.compactToolResults !== false ? meta.preview : raw.trim();
      const maxMessageChars = meta.role === 'assistant'
        ? 700
        : meta.role === 'user'
          ? 420
          : 260;
      const text = truncate(body, maxMessageChars, '\n...[message truncated]');
      const intro = index === 0 ? 'Earlier' : 'Then';

      if (meta.role === 'user') {
        return text.includes('\n')
          ? `${intro}, the user said:\n${text}`
          : `${intro}, the user said: ${text}`;
      }

      if (meta.role === 'assistant') {
        return text.includes('\n')
          ? `${intro}, the assistant replied:\n${text}`
          : `${intro}, the assistant replied: ${text}`;
      }

      return text.includes('\n')
        ? `${intro}, a tool produced:\n${text}`
        : `${intro}, a tool produced: ${text}`;
    });

    return truncate(parts.join('\n\n'), maxChars, '\n...[conversation truncated]');
  }

  private messageRoleLabel(meta: ChatMessageMeta): string {
    const role = meta.role.charAt(0).toUpperCase() + meta.role.slice(1);
    if ((meta.role === 'assistant' || meta.role === 'tool') && meta.providerId) {
      return `${role} (${meta.providerId})`;
    }
    return role;
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
