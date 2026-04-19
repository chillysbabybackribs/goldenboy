import type { AgentTaskKind, ProviderId } from '../../shared/types/model';
import { HAIKU_PROVIDER_ID, PRIMARY_PROVIDER_ID } from '../../shared/types/model';
import type { HydrationNeed } from './ChatHydrationDetector';
import { contextPromptBudgetForTaskKind } from './invocationContextPolicy';
import { chatHydrationDetector } from './ChatHydrationDetector';
import { chatKnowledgeStore } from '../chatKnowledge/ChatKnowledgeStore';
import { taskMemoryStore } from '../models/taskMemoryStore';
import { appStateStore } from '../state/appStateStore';
import { AgentProvider } from './AgentTypes';
import {
  artifactService,
} from '../artifacts/ArtifactService';
import { fileKnowledgeStore } from '../fileKnowledge/FileKnowledgeStore';
import { AgentToolName } from './AgentTypes';
import { DOCUMENT_ATTACHMENT_TOOL_NAMES } from './tools/attachmentTools';
import type {
  CodexItem,
  CodexInvocationOverride,
  InvocationAttachment,
  PersistedTurnProcessEntry,
  AgentInvocationOptions,
} from '../../shared/types/model';
import type { DocumentInvocationAttachment } from '../../shared/types/attachments';

const PRIOR_CHAT_KEYWORDS = new Set([
  'previous',
  'prior',
  'earlier',
  'last',
  'chat',
  'thread',
  'conversation',
  'reference',
  'use',
]);

export type SubagentApprovalDecision = 'approve' | 'deny' | 'unclear';

export type { HydrationNeed };

export function isSupportedProvider(value: string): value is ProviderId {
  return value === PRIMARY_PROVIDER_ID || value === HAIKU_PROVIDER_ID;
}

export function hasDisposableProvider(provider: AgentProvider): provider is AgentProvider & { dispose(): Promise<void> | void } {
  return typeof (provider as { dispose?: unknown }).dispose === 'function';
}

export function normalizeStatusProcessEntry(status: string): PersistedTurnProcessEntry | null {
  if (status === 'thought-migrate') return null;
  if (status.startsWith('thought:')) {
    const text = status.slice('thought:'.length).trim();
    return text ? { kind: 'thought', text } : null;
  }
  const sparkToolStatus = normalizeSparkStatusTool(status);
  if (sparkToolStatus) {
    return { kind: 'tool', text: sparkToolStatus };
  }
  if (status.startsWith('tool-start:')) {
    const text = status.slice('tool-start:'.length).trim();
    return text ? { kind: 'tool', text } : null;
  }
  if (status.startsWith('tool-done:')) {
    const text = status.slice('tool-done:'.length).trim();
    return text ? { kind: 'tool', text } : null;
  }
  return null;
}

function normalizeSparkStatusTool(status: string): string | null {
  if (!/^\s*tool\b/i.test(status)) return null;

  const match = status.match(/^\s*tool(?:\s*[-_]?\s*(call|start|started|progress|result|done|completed|complete|error|failed))?\s*[:\-]?\s*(.+)$/i);
  if (!match) return null;

  const detail = String(match[2] || '').trim().replace(/^->\s*/, '');
  if (!detail) return null;

  return detail;
}

export function codexItemToProcessEntry(item: CodexItem): PersistedTurnProcessEntry | null {
  if (item.type === 'agent_message' || item.type === 'mcp_tool_call') return null;
  if (item.type === 'command_execution') {
    if (item.status === 'in_progress') return { kind: 'tool', text: `Run ${item.command}` };
    if (item.status === 'completed') {
      const detail = item.exit_code == null ? 'done' : (item.exit_code === 0 ? 'done' : `exit ${item.exit_code}`);
      return { kind: 'tool', text: `Run ${item.command} ... ${detail}` };
    }
    return { kind: 'tool', text: `Run ${item.command} ... failed` };
  }
  if (item.type === 'file_change') {
    if (item.status === 'completed') {
      const detail = item.changes.map((change) => `${change.kind} ${change.path}`).join(', ') || 'updated files';
      return { kind: 'tool', text: `File change ... ${detail}` };
    }
    if (item.status === 'failed') {
      return { kind: 'tool', text: 'File change ... error' };
    }
  }
  return null;
}

export function mergeProcessEntries(
  statusEntries: PersistedTurnProcessEntry[],
  codexItems?: CodexItem[],
): PersistedTurnProcessEntry[] {
  const merged: PersistedTurnProcessEntry[] = [];
  const seen = new Set<string>();
  for (const entry of statusEntries) {
    const key = `${entry.kind}:${entry.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  for (const item of codexItems || []) {
    const entry = codexItemToProcessEntry(item);
    if (!entry) continue;
    const key = `${entry.kind}:${entry.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  return merged;
}

export function normalizePromptText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

export function hasExplicitSubagentRequest(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  return /\b(?:use|run|spawn|launch|start|delegate(?: to)?|split)\b.*\b(?:sub-?agents?|multiple agents?|workers?)\b/.test(normalized)
    || /\bparallel(?:ize|ise)?\b/.test(normalized)
    || /\bsplit (?:the )?work\b/.test(normalized);
}

export function interpretSubagentApproval(prompt: string): SubagentApprovalDecision {
  const normalized = normalizePromptText(prompt).toLowerCase();
  if (!normalized) return 'unclear';

  if (
    /^(?:yes|y|yeah|yep|sure|ok|okay|please do|go ahead|do it|sounds good|that works)[.!]*$/.test(normalized)
    || /\b(?:go ahead|please do|run (?:the )?sub-?agents?|use (?:the )?sub-?agents?|spawn (?:the )?sub-?agents?)\b/.test(normalized)
  ) {
    return 'approve';
  }

  if (
    /^(?:no|n|nope|nah|not now|skip|skip it|no thanks)[.!]*$/.test(normalized)
    || /\b(?:do not|don't|without|skip) (?:use |run |spawn )?(?:the )?sub-?agents?\b/.test(normalized)
    || /\bsingle[- ]agent\b/.test(normalized)
  ) {
    return 'deny';
  }

  return 'unclear';
}

export function shouldOfferSubagentConfirmation(
  prompt: string,
  taskKind: AgentTaskKind,
  canSpawnSubagents: boolean,
  options?: AgentInvocationOptions,
): boolean {
  if (!canSpawnSubagents) return false;
  if (typeof options?.taskProfile?.canSpawnSubagents === 'boolean') return false;
  if (hasExplicitSubagentRequest(prompt)) return false;

  const normalized = normalizePromptText(prompt);
  const wordCount = normalized ? normalized.split(' ').length : 0;
  const verboseEnough = wordCount >= 24 || normalized.length >= 180;

  if (taskKind === 'orchestration') return true;
  if (!verboseEnough) return false;

  return taskKind === 'review'
    || taskKind === 'debug'
    || taskKind === 'research'
    || taskKind === 'implementation';
}

export function suggestedSubagentPlan(taskKind: AgentTaskKind): { reason: string; suggestedRoles: string[] } {
  switch (taskKind) {
    case 'orchestration':
      return {
        reason: 'the request looks like multi-part planning or coordination work',
        suggestedRoles: ['planner', 'explorer', 'worker'],
      };
    case 'review':
      return {
        reason: 'the request looks broad enough to split review and verification work',
        suggestedRoles: ['reviewer', 'verifier'],
      };
    case 'debug':
      return {
        reason: 'the task looks like debugging with multiple investigation branches',
        suggestedRoles: ['repro-runner', 'investigator'],
      };
    case 'research':
      return {
        reason: 'the task looks research-heavy enough to split evidence gathering and synthesis',
        suggestedRoles: ['researcher', 'verifier'],
      };
    case 'implementation':
      return {
        reason: 'the task has enough moving parts that delegation may help',
        suggestedRoles: ['explorer', 'implementer'],
      };
    default:
      return {
        reason: 'the task has enough moving parts that delegation may help',
        suggestedRoles: ['explorer', 'worker'],
      };
  }
}

export function buildSubagentConfirmationMessage(reason: string, suggestedRoles: string[]): string {
  const roleText = suggestedRoles.length > 0 ? suggestedRoles.join(', ') : 'specialists';
  return [
    'This task looks complex enough that subagents could help.',
    `Why: ${reason}.`,
    `Planned roles: ${roleText}.`,
    'Do you want me to run subagents? Reply yes to allow them, or no to keep this single-agent.',
  ].join('\n\n');
}

export function buildSubagentClarificationMessage(): string {
  return 'I have a pending subagent confirmation for this task. Reply yes to allow subagents, or no to keep it single-agent.';
}

export function mergeInvocationOptions(
  base: AgentInvocationOptions | undefined,
  patch: Partial<AgentInvocationOptions>,
): AgentInvocationOptions {
  return {
    ...base,
    ...patch,
    taskProfile: {
      ...(base?.taskProfile ?? {}),
      ...(patch.taskProfile ?? {}),
    },
  };
}

export function resolveCodexInvocationOverride(
  providerId: ProviderId,
  options: AgentInvocationOptions | undefined,
): CodexInvocationOverride | undefined {
  if (providerId !== PRIMARY_PROVIDER_ID) return undefined;
  const modelId = options?.codexConfig?.modelId?.trim();
  const reasoningEffort = options?.codexConfig?.reasoningEffort;
  if (!modelId && !reasoningEffort) return undefined;
  return {
    modelId: modelId || undefined,
    reasoningEffort,
  };
}

export function buildAttachmentSummary(attachments?: InvocationAttachment[]): string | null {
  if (!attachments?.length) return null;
  const images = attachments.filter((attachment) => attachment.type === 'image');
  const documents = attachments.filter((attachment): attachment is DocumentInvocationAttachment => attachment.type === 'document');
  const parts: string[] = [];

  if (images.length === 1) {
    parts.push(images[0].name?.trim() ? `[Attached image: ${images[0].name.trim()}]` : '[Attached image]');
  } else if (images.length > 1) {
    const names = images
      .map((attachment) => attachment.name?.trim())
      .filter((name): name is string => Boolean(name));
    if (names.length > 0) {
      const listed = names.slice(0, 3).join(', ');
      const suffix = names.length > 3 ? `, +${names.length - 3} more` : '';
      parts.push(`[Attached images: ${listed}${suffix}]`);
    } else {
      parts.push(`[Attached ${images.length} images]`);
    }
  }

  if (documents.length === 1) {
    parts.push(`[Attached document: ${documents[0].name}]`);
  } else if (documents.length > 1) {
    const listed = documents.slice(0, 3).map((document) => document.name).join(', ');
    const suffix = documents.length > 3 ? `, +${documents.length - 3} more` : '';
    parts.push(`[Attached documents: ${listed}${suffix}]`);
  }

  return parts.join('\n') || null;
}

export function buildChatUserMessageText(prompt: string, attachments?: InvocationAttachment[]): string {
  const text = prompt.trim();
  const attachmentSummary = buildAttachmentSummary(attachments);
  if (text && attachmentSummary) return `${text}\n${attachmentSummary}`;
  if (text) return text;
  return attachmentSummary || prompt;
}

export function buildDocumentAttachmentContext(attachments?: InvocationAttachment[]): string | null {
  const documents = attachments?.filter((attachment): attachment is DocumentInvocationAttachment => attachment.type === 'document') || [];
  if (documents.length === 0) return null;

  const sections = [
    '## Attached Documents',
    'One or more task documents were staged by the host. Use attachments.list to inspect them, attachments.search to find relevant passages, and attachments.read_chunk or attachments.read_document for details. Do not assume document contents from filenames alone.',
  ];

  for (const [index, document] of documents.slice(0, 5).entries()) {
    const detail = [
      document.mediaType,
      `${document.sizeBytes} bytes`,
      `status=${document.status}`,
      document.chunkCount > 0 ? `${document.chunkCount} chunks` : '',
    ].filter(Boolean).join(' • ');
    sections.push('', `${index + 1}. ${document.name} (${detail})`);
    if (document.excerpt) sections.push(document.excerpt);
  }

  if (documents.length > 5) {
    sections.push('', `...and ${documents.length - 5} more attached documents.`);
  }

  return sections.join('\n');
}

function formatArtifactTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

export function buildArtifactContext(): string | null {
  const state = appStateStore.getState();
  if (!state.artifacts.length) return null;

  const activeArtifact = state.activeArtifactId
    ? state.artifacts.find((artifact) => artifact.id === state.activeArtifactId) || null
    : null;
  const recentArtifacts = [...state.artifacts]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5);

  const sections = [
    '## Workspace Artifacts',
    'Managed workspace artifacts exist independently of tasks. For supported workspace documents (`md`, `txt`, `html`, `csv`), use artifact.* tools instead of filesystem.* tools.',
    'Use artifact.get_active to resolve requests like "update this document" or "append to this sheet". Use artifact.read before replacing existing content when you need the current artifact text.',
  ];

  if (activeArtifact) {
    let preview = '';
    try {
      const content = artifactService.readContent(activeArtifact.id).content.trim();
      if (content) {
        const trimmed = content.length > 600 ? `${content.slice(0, 600)}\n...[artifact preview truncated]` : content;
        preview = trimmed;
      }
    } catch {
      preview = '';
    }
    sections.push(
      '',
      `Active artifact: ${activeArtifact.title} [id=${activeArtifact.id}] (${activeArtifact.format}, status=${activeArtifact.status}, updated=${formatArtifactTimestamp(activeArtifact.updatedAt)})`,
    );
    if (preview) {
      sections.push('', 'Active artifact preview:', preview);
    }
  } else {
    sections.push('', 'Active artifact: none selected');
  }

  sections.push('', 'Recent artifacts:');
  for (const artifact of recentArtifacts) {
    sections.push(
      `- ${artifact.title} [id=${artifact.id}] (${artifact.format}, status=${artifact.status}, updated=${formatArtifactTimestamp(artifact.updatedAt)})`,
    );
  }

  return sections.join('\n');
}

export function withDocumentAttachmentTools(
  allowedTools: 'all' | AgentToolName[],
  attachments?: InvocationAttachment[],
): 'all' | AgentToolName[] {
  if (allowedTools === 'all') return 'all';
  const hasDocuments = attachments?.some((attachment) => attachment.type === 'document');
  if (!hasDocuments) return allowedTools;
  return Array.from(new Set([...allowedTools, ...DOCUMENT_ATTACHMENT_TOOL_NAMES]));
}

export function supportsFileCacheContext(taskKind: AgentTaskKind): boolean {
  return taskKind === 'implementation' || taskKind === 'debug' || taskKind === 'review';
}

export function buildFileCacheContext(taskKind: AgentTaskKind): string | null {
  if (!supportsFileCacheContext(taskKind)) return null;
  const stats = fileKnowledgeStore.getStats();
  const indexedAt = stats.indexedAt ? new Date(stats.indexedAt).toISOString() : null;

  if (stats.fileCount === 0 || stats.chunkCount === 0) {
    return [
      '## Indexed File Cache',
      'The indexed file cache is currently empty.',
      'If you need indexed repo search or chunk reads, call `filesystem.index_workspace` once before relying on `filesystem.search_file_cache` or `filesystem.read_file_chunk`.',
    ].join('\n');
  }

  return [
    '## Indexed File Cache',
    `The indexed file cache is already available with ${stats.fileCount} files and ${stats.chunkCount} chunks${indexedAt ? ` (indexed at ${indexedAt})` : ''}.`,
    'Prefer `filesystem.search_file_cache` and `filesystem.read_file_chunk` first.',
    'Avoid calling `filesystem.index_workspace` unless the cache is empty, clearly stale after file-changing commands, or you need a deliberate refresh.',
  ].join('\n');
}

export function buildContextPrompt(
  parts: Array<string | null | undefined>,
  taskKind: AgentTaskKind,
): string | null {
  return packContextSections(parts, contextPromptBudgetForTaskKind(taskKind), '\n...[context truncated]');
}

export function buildAutomaticTaskContinuationContext(
  taskId: string,
  prompt: string,
  currentMessageId?: string,
): string | null {
  if (!looksLikeContinuationPrompt(prompt) && !lastInvocationFailed(taskId)) {
    return null;
  }

  const recall = chatKnowledgeStore.recall(taskId, {
    query: prompt,
    intent: 'follow_up',
    maxChars: 1800,
    excludeMessageIds: currentMessageId ? [currentMessageId] : [],
  });
  const lastFailure = getLastFailureText(taskId);
  const sections = [
    '## Continuation Context',
    'This task is being resumed. Continue from prior evidence and prior tool work instead of restarting broad exploration unless the prior state is clearly insufficient.',
  ];

  if (lastFailure) {
    sections.push('', '### Last Failure', lastFailure);
  }
  if (recall.text) {
    sections.push('', '### Relevant Prior Work', recall.text);
  }

  return sections.join('\n');
}

export function looksLikeContinuationPrompt(prompt: string): boolean {
  return /\b(continue|resume|retry|pick up|keep going|go on|same task|that failed|fix that|where were we|carry on)\b/i.test(prompt)
    || prompt.trim().length <= 40 && /\b(this|that|it|same)\b/i.test(prompt);
}

export function lastInvocationFailed(taskId: string): boolean {
  const record = taskMemoryStore.get(taskId);
  const latestResult = [...record.entries].reverse().find(entry => entry.kind === 'model_result');
  return latestResult?.metadata?.success === false;
}

export function getLastInvocationProviderId(taskId: string): ProviderId | null {
  const record = taskMemoryStore.get(taskId);
  const latestResult = [...record.entries].reverse().find(
    (entry): entry is typeof entry & { providerId: ProviderId } => entry.kind === 'model_result' && Boolean(entry.providerId),
  );
  return latestResult?.providerId ?? null;
}

export function getLastFailureText(taskId: string): string | null {
  const record = taskMemoryStore.get(taskId);
  const latestFailed = [...record.entries].reverse().find(
    entry => entry.kind === 'model_result' && entry.metadata?.success === false,
  );
  return latestFailed?.text || null;
}

export function buildConversationHydrationContext(input: {
  taskId: string;
  prompt: string;
  taskKind: AgentTaskKind;
  currentMessageId: string;
  hasPriorConversation: boolean;
  richerContextRequested: boolean;
  providerSwitched: boolean;
}): string | null {
  const explicitPreviousChatRecall = isExplicitPreviousChatRecallPrompt(input.prompt);
  const hydrationTaskId = explicitPreviousChatRecall
    ? findMostRecentPriorConversationTaskId(input.taskId)
    : input.taskId;
  if (!hydrationTaskId) return null;
  if (!explicitPreviousChatRecall && !input.hasPriorConversation) return null;

  if (explicitPreviousChatRecall && hydrationTaskId !== input.taskId) {
    const searchTerms = chatHydrationDetector
      .extractContextKeywords(input.prompt)
      .filter((term) => !isGenericPreviousChatKeyword(term));
    const need: Exclude<HydrationNeed, 'none'> = searchTerms.length > 0 ? 'searched' : 'full';
    const maxChars = conversationHydrationBudget(input.taskKind, need, false);
    const recalled = chatKnowledgeStore.buildSilentHydrationContext(hydrationTaskId, {
      need,
      searchQuery: need === 'searched' ? searchTerms.join(' ') : undefined,
      maxChars,
      excludeToolResults: true,
    });
    if (!recalled) return null;
    return [
      '## Previous Chat Recall',
      'The user explicitly asked to reference the most recent prior chat thread. Use the recalled thread below as prior-chat context.',
      recalled,
    ].join('\n\n');
  }

  const detectedNeed = chatHydrationDetector.detectNeed({
    userMessage: input.prompt,
    taskId: hydrationTaskId,
    priorTaskExists: true,
    conversationMode: true,
    isFollowUp: input.richerContextRequested,
  });
  const shouldHydrate = input.richerContextRequested || detectedNeed !== 'none';
  if (!shouldHydrate) {
    return null;
  }

  const baseNeed: Exclude<HydrationNeed, 'none'> = detectedNeed === 'none' ? 'recent' : detectedNeed;
  const need: Exclude<HydrationNeed, 'none'> = input.providerSwitched && baseNeed !== 'searched'
    ? 'full'
    : baseNeed;
  const searchQuery = need === 'searched'
    ? chatHydrationDetector.extractContextKeywords(input.prompt).join(' ')
    : undefined;
  const maxChars = conversationHydrationBudget(input.taskKind, need, input.providerSwitched);

  return chatKnowledgeStore.buildSilentHydrationContext(hydrationTaskId, {
    need,
    searchQuery,
    maxChars,
    currentMessageId: hydrationTaskId === input.taskId ? input.currentMessageId : undefined,
    excludeToolResults: true,
  });
}

export function isExplicitPreviousChatRecallPrompt(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return /\b(previous|prior|earlier|last)\s+(chat|thread|conversation)\b/.test(lower)
    || /\b(chat|thread|conversation)\s+from\s+(before|earlier|last time)\b/.test(lower)
    || /\breference\s+(the\s+)?previous\s+(chat|thread|conversation)\b/.test(lower)
    || /\buse\s+(the\s+)?previous\s+(chat|thread|conversation)\b/.test(lower);
}

export function isGenericPreviousChatKeyword(term: string): boolean {
  return PRIOR_CHAT_KEYWORDS.has(term);
}

export function findMostRecentPriorConversationTaskId(currentTaskId: string): string | null {
  const tasks = appStateStore.getState().tasks ?? [];
  const priorTasks = [...tasks]
    .filter((task) => task.id !== currentTaskId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  for (const task of priorTasks) {
    if (chatKnowledgeStore.threadSummary(task.id)) {
      return task.id;
    }
  }
  return null;
}

export function buildFollowUpResolutionContext(
  taskId: string,
  prompt: string,
  currentMessageId: string,
): string | null {
  if (!looksLikeEllipticalFollowUp(prompt)) {
    return null;
  }

  const recent = chatKnowledgeStore.readLast(taskId, {
    count: 6,
    maxChars: 2_400,
    excludeMessageIds: [currentMessageId],
  });
  if (recent.messages.length === 0) {
    return null;
  }

  const lastAssistant = [...recent.messages].reverse().find((message) => message.role === 'assistant');
  const lastUser = [...recent.messages].reverse().find((message) => message.role === 'user');
  if (!lastAssistant) {
    return null;
  }

  const assistantText = chatKnowledgeStore.readMessage(taskId, lastAssistant.id, 700)?.text?.trim() || lastAssistant.preview;
  const userText = lastUser
    ? (chatKnowledgeStore.readMessage(taskId, lastUser.id, 500)?.text?.trim() || lastUser.preview)
    : '';

  const sections = [
    '## Follow-Up Resolution',
    'The current user message is an elliptical follow-up. Resolve it against the immediately preceding conversation before acting.',
  ];

  if (userText) {
    sections.push('', 'Latest prior user request:', userText);
  }

  sections.push(
    '',
    'Latest prior assistant message:',
    assistantText,
    '',
    `Resolution rule: ${followUpResolutionRule(prompt)}`,
  );

  return sections.join('\n');
}

export function looksLikeEllipticalFollowUp(prompt: string): boolean {
  const lower = prompt.toLowerCase().trim();
  if (!lower) return false;
  if (lower.length > 120) return false;

  return /^(yes|yeah|yep|sure|ok|okay|no|nope|go ahead|do it|proceed|sounds good|that works)\b/.test(lower)
    || /\b(?:it|this|that|same)\b/.test(lower)
    || /\b(?:install|fix|review|apply|do|ship|help)\b/.test(lower);
}

export function followUpResolutionRule(prompt: string): string {
  const lower = prompt.toLowerCase().trim();
  if (/^(no|nope)\b/.test(lower)) {
    return 'Treat this as declining or reversing the most recent concrete assistant proposal; do not perform that action unless the user then specifies another one.';
  }

  if (/^(yes|yeah|yep|sure|ok|okay|go ahead|do it|proceed|sounds good|that works)\b/.test(lower)) {
    return 'Treat this as approval to carry out the most recent concrete assistant proposal, installation step, fix, or next action.';
  }

  return 'Treat references like "it", "this", or "that" as pointing to the most recent concrete assistant proposal, identified issue, or requested fix unless a newer explicit referent appears.';
}

export function conversationHydrationBudget(
  taskKind: AgentTaskKind,
  need: Exclude<HydrationNeed, 'none'>,
  providerSwitched: boolean,
): number {
  const baseBudget = contextPromptBudgetForTaskKind(taskKind);
  if (providerSwitched && need === 'full') {
    return Math.min(1600, Math.max(900, Math.floor(baseBudget * 0.45)));
  }

  switch (need) {
    case 'full':
      return Math.min(1400, Math.max(850, Math.floor(baseBudget * 0.4)));
    case 'searched':
      return Math.min(1200, Math.max(800, Math.floor(baseBudget * 0.35)));
    case 'recent':
    default:
      return Math.min(850, Math.max(500, Math.floor(baseBudget * 0.25)));
  }
}

export function packContextSections(
  parts: Array<string | null | undefined>,
  maxChars: number,
  truncationSuffix: string,
): string | null {
  const normalized = parts
    .map(part => part?.trim())
    .filter((part): part is string => Boolean(part));
  if (normalized.length === 0) return null;

  const packed: string[] = [];
  let used = 0;

  for (const part of normalized) {
    const separator = packed.length > 0 ? '\n\n' : '';
    const available = maxChars - used - separator.length;
    if (available <= 0) break;

    if (part.length <= available) {
      packed.push(separator ? `${separator}${part}` : part);
      used += separator.length + part.length;
      continue;
    }

    const reserveForSuffix = truncationSuffix.length;
    if (available <= reserveForSuffix) break;
    const truncated = `${part.slice(0, available - reserveForSuffix)}${truncationSuffix}`;
    packed.push(separator ? `${separator}${truncated}` : truncated);
    used += separator.length + truncated.length;
    break;
  }

  const context = packed.join('');
  return context || null;
}
