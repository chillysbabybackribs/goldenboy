"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.agentModelService = exports.AgentModelService = void 0;
const electron_1 = require("electron");
const ipc_1 = require("../../shared/types/ipc");
const model_1 = require("../../shared/types/model");
const actions_1 = require("../state/actions");
const appStateStore_1 = require("../state/appStateStore");
const eventBus_1 = require("../events/eventBus");
const events_1 = require("../../shared/types/events");
const ids_1 = require("../../shared/utils/ids");
const AgentRuntime_1 = require("./AgentRuntime");
const CodexProvider_1 = require("./CodexProvider");
const HaikuProvider_1 = require("./HaikuProvider");
const AppServerBackedProvider_1 = require("./AppServerBackedProvider");
const AgentToolExecutor_1 = require("./AgentToolExecutor");
const browserTools_1 = require("./tools/browserTools");
const chatTools_1 = require("./tools/chatTools");
const attachmentTools_1 = require("./tools/attachmentTools");
const artifactTools_1 = require("./tools/artifactTools");
const ArtifactService_1 = require("../artifacts/ArtifactService");
const filesystemTools_1 = require("./tools/filesystemTools");
const runtimeTools_1 = require("./tools/runtimeTools");
const terminalTools_1 = require("./tools/terminalTools");
const subagentTools_1 = require("./tools/subagentTools");
const taskMemoryStore_1 = require("../models/taskMemoryStore");
const runtimeLedgerStore_1 = require("../models/runtimeLedgerStore");
const ChatKnowledgeStore_1 = require("../chatKnowledge/ChatKnowledgeStore");
const FileKnowledgeStore_1 = require("../fileKnowledge/FileKnowledgeStore");
const runtimeScope_1 = require("./runtimeScope");
const providerRouting_1 = require("./providerRouting");
const taskProfile_1 = require("./taskProfile");
const artifactRouting_1 = require("./artifactRouting");
const researchGrounding_1 = require("./researchGrounding");
const BrowserService_1 = require("../browser/BrowserService");
const invocationContextPolicy_1 = require("./invocationContextPolicy");
const ChatHydrationDetector_1 = require("./ChatHydrationDetector");
const startupProgress_1 = require("./startupProgress");
const researchSynthesis_1 = require("./researchSynthesis");
function normalizeStatusProcessEntry(status) {
    if (status === 'thought-migrate')
        return null;
    if (status.startsWith('thought:')) {
        const text = status.slice('thought:'.length).trim();
        return text ? { kind: 'thought', text } : null;
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
function codexItemToProcessEntry(item) {
    if (item.type === 'agent_message' || item.type === 'mcp_tool_call')
        return null;
    if (item.type === 'command_execution') {
        if (item.status === 'in_progress')
            return { kind: 'tool', text: `Run ${item.command}` };
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
function mergeProcessEntries(statusEntries, codexItems) {
    const merged = [];
    const seen = new Set();
    for (const entry of statusEntries) {
        const key = `${entry.kind}:${entry.text}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        merged.push(entry);
    }
    for (const item of codexItems || []) {
        const entry = codexItemToProcessEntry(item);
        if (!entry)
            continue;
        const key = `${entry.kind}:${entry.text}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        merged.push(entry);
    }
    return merged;
}
const PROVIDER_CONFIGS = [
    { id: model_1.PRIMARY_PROVIDER_ID, label: 'Codex', modelId: model_1.PRIMARY_PROVIDER_ID },
    { id: model_1.HAIKU_PROVIDER_ID, label: 'Haiku 4.5', modelId: model_1.HAIKU_PROVIDER_ID },
];
function buildAttachmentSummary(attachments) {
    if (!attachments?.length)
        return null;
    const images = attachments.filter((attachment) => attachment.type === 'image');
    const documents = attachments.filter((attachment) => attachment.type === 'document');
    const parts = [];
    if (images.length === 1) {
        parts.push(images[0].name?.trim() ? `[Attached image: ${images[0].name.trim()}]` : '[Attached image]');
    }
    else if (images.length > 1) {
        const names = images
            .map((attachment) => attachment.name?.trim())
            .filter((name) => Boolean(name));
        if (names.length > 0) {
            const listed = names.slice(0, 3).join(', ');
            const suffix = names.length > 3 ? `, +${names.length - 3} more` : '';
            parts.push(`[Attached images: ${listed}${suffix}]`);
        }
        else {
            parts.push(`[Attached ${images.length} images]`);
        }
    }
    if (documents.length === 1) {
        parts.push(`[Attached document: ${documents[0].name}]`);
    }
    else if (documents.length > 1) {
        const listed = documents.slice(0, 3).map((document) => document.name).join(', ');
        const suffix = documents.length > 3 ? `, +${documents.length - 3} more` : '';
        parts.push(`[Attached documents: ${listed}${suffix}]`);
    }
    return parts.join('\n') || null;
}
function buildChatUserMessageText(prompt, attachments) {
    const text = prompt.trim();
    const attachmentSummary = buildAttachmentSummary(attachments);
    if (text && attachmentSummary)
        return `${text}\n${attachmentSummary}`;
    if (text)
        return text;
    return attachmentSummary || prompt;
}
function buildDocumentAttachmentContext(attachments) {
    const documents = attachments?.filter((attachment) => attachment.type === 'document') || [];
    if (documents.length === 0)
        return null;
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
        if (document.excerpt)
            sections.push(document.excerpt);
    }
    if (documents.length > 5) {
        sections.push('', `...and ${documents.length - 5} more attached documents.`);
    }
    return sections.join('\n');
}
function formatArtifactTimestamp(timestamp) {
    return new Date(timestamp).toISOString();
}
function buildArtifactContext() {
    const state = appStateStore_1.appStateStore.getState();
    if (!state.artifacts.length)
        return null;
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
            const content = ArtifactService_1.artifactService.readContent(activeArtifact.id).content.trim();
            if (content) {
                const trimmed = content.length > 600 ? `${content.slice(0, 600)}\n...[artifact preview truncated]` : content;
                preview = trimmed;
            }
        }
        catch {
            preview = '';
        }
        sections.push('', `Active artifact: ${activeArtifact.title} [id=${activeArtifact.id}] (${activeArtifact.format}, status=${activeArtifact.status}, updated=${formatArtifactTimestamp(activeArtifact.updatedAt)})`);
        if (preview) {
            sections.push('', 'Active artifact preview:', preview);
        }
    }
    else {
        sections.push('', 'Active artifact: none selected');
    }
    sections.push('', 'Recent artifacts:');
    for (const artifact of recentArtifacts) {
        sections.push(`- ${artifact.title} [id=${artifact.id}] (${artifact.format}, status=${artifact.status}, updated=${formatArtifactTimestamp(artifact.updatedAt)})`);
    }
    return sections.join('\n');
}
function withDocumentAttachmentTools(allowedTools, attachments) {
    if (allowedTools === 'all')
        return 'all';
    const hasDocuments = attachments?.some((attachment) => attachment.type === 'document');
    if (!hasDocuments)
        return allowedTools;
    return Array.from(new Set([...allowedTools, ...attachmentTools_1.DOCUMENT_ATTACHMENT_TOOL_NAMES]));
}
function supportsFileCacheContext(taskKind) {
    return taskKind === 'implementation' || taskKind === 'debug' || taskKind === 'review';
}
function buildFileCacheContext(taskKind) {
    if (!supportsFileCacheContext(taskKind))
        return null;
    const stats = FileKnowledgeStore_1.fileKnowledgeStore.getStats();
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
class AgentModelService {
    providers = new Map();
    activeTaskProviders = new Map();
    sharedPrimaryAppServerProvider = null;
    init() {
        AgentToolExecutor_1.agentToolExecutor.registerMany([
            ...(0, artifactTools_1.createArtifactToolDefinitions)(),
            ...(0, attachmentTools_1.createAttachmentToolDefinitions)(),
            ...(0, runtimeTools_1.createRuntimeToolDefinitions)(),
            ...(0, browserTools_1.createBrowserToolDefinitions)(),
            ...(0, chatTools_1.createChatToolDefinitions)(),
            ...(0, filesystemTools_1.createFilesystemToolDefinitions)(),
            ...(0, terminalTools_1.createTerminalToolDefinitions)(),
            ...(0, subagentTools_1.createSubAgentToolDefinitions)((input) => this.createPreferredSubAgentProvider(input)),
        ]);
        void this.initializeAppServerProvider(PROVIDER_CONFIGS[0]);
        this.initializeHaikuProvider(PROVIDER_CONFIGS[1]);
        if (this.providers.size === 0) {
            this.log('system', 'warn', 'No model providers are available.');
        }
    }
    async dispose() {
        for (const [taskId, activeTask] of Array.from(this.activeTaskProviders.entries())) {
            this.activeTaskProviders.delete(taskId);
            await this.disposeTaskInvocation(activeTask, activeTask.providerId, taskId);
        }
        if (this.sharedPrimaryAppServerProvider) {
            await this.sharedPrimaryAppServerProvider.dispose();
            this.sharedPrimaryAppServerProvider = null;
        }
    }
    getProviderStatuses() {
        return appStateStore_1.appStateStore.getState().providers;
    }
    resolve(prompt, explicitOwner, options) {
        if (explicitOwner && explicitOwner !== 'auto' && isSupportedProvider(explicitOwner) && this.providers.has(explicitOwner)) {
            return explicitOwner;
        }
        return this.pickAutoProvider(prompt, options)
            ?? Array.from(this.providers.keys())[0]
            ?? model_1.PRIMARY_PROVIDER_ID;
    }
    cancel(taskId) {
        const activeTask = this.activeTaskProviders.get(taskId);
        if (!activeTask)
            return false;
        try {
            activeTask.runtime.abort();
            this.log(activeTask.providerId, 'info', 'Task cancelled by user', taskId);
            return true;
        }
        catch {
            return false;
        }
    }
    getTaskMemory(taskId) {
        return taskMemoryStore_1.taskMemoryStore.get(taskId);
    }
    async invoke(taskId, prompt, explicitOwner, options) {
        const providerId = this.pickProvider(prompt, explicitOwner, options);
        const provider = this.providers.get(providerId);
        if (!provider) {
            throw new Error(this.buildUnavailableProviderMessage(providerId));
        }
        const taskProfile = (0, taskProfile_1.buildTaskProfile)(prompt, options?.taskProfile);
        const activeTask = this.createTaskInvocation(providerId, taskProfile.kind);
        const hadTaskHistory = taskMemoryStore_1.taskMemoryStore.hasEntries(taskId);
        const hadConversationHistory = Boolean(ChatKnowledgeStore_1.chatKnowledgeStore.threadSummary(taskId));
        const hasArtifacts = appStateStore_1.appStateStore.getState().artifacts.length > 0;
        const lastProviderId = getLastInvocationProviderId(taskId);
        const providerSwitched = Boolean(lastProviderId && lastProviderId !== providerId);
        if (lastProviderId && lastProviderId !== providerId) {
            runtimeLedgerStore_1.runtimeLedgerStore.recordProviderSwitch(taskId, lastProviderId, providerId);
        }
        const attachmentSummary = buildAttachmentSummary(options?.attachments);
        const displayPrompt = typeof options?.displayPrompt === 'string' ? options.displayPrompt : prompt;
        const chatUserMessage = ChatKnowledgeStore_1.chatKnowledgeStore.recordUserMessage(taskId, buildChatUserMessageText(displayPrompt, options?.attachments));
        taskMemoryStore_1.taskMemoryStore.recordUserPrompt(taskId, displayPrompt, {
            attachments: options?.attachments,
            attachmentSummary,
        });
        const currentTaskMemoryEntryId = taskMemoryStore_1.taskMemoryStore.get(taskId).entries.at(-1)?.id;
        this.activeTaskProviders.set(taskId, activeTask);
        appStateStore_1.appStateStore.dispatch({
            type: actions_1.ActionType.UPDATE_TASK,
            taskId,
            updates: { status: 'running', owner: providerId, updatedAt: Date.now() },
        });
        runtimeLedgerStore_1.runtimeLedgerStore.recordTaskStatus({
            taskId,
            providerId,
            status: 'running',
            summary: `${provider.label} started ${taskProfile.kind} work`,
        });
        this.setRuntime(providerId, {
            status: 'busy',
            activeTaskId: taskId,
            errorDetail: null,
        });
        this.log(providerId, 'info', `${provider.label} invocation started`, taskId);
        const persistedProcessEntries = [];
        try {
            const continuationPrompt = looksLikeContinuationPrompt(prompt);
            const richerConversationContextRequested = (0, invocationContextPolicy_1.shouldIncludeConversationContext)({
                prompt,
                hasPriorConversation: hadConversationHistory,
                isContinuation: continuationPrompt,
            });
            const includeTaskMemory = (0, invocationContextPolicy_1.shouldIncludeTaskMemoryContext)({
                prompt,
                taskKind: taskProfile.kind,
                hasPriorTaskMemory: hadTaskHistory,
                isContinuation: continuationPrompt,
                lastInvocationFailed: lastInvocationFailed(taskId),
            });
            const includeArtifactContext = (0, invocationContextPolicy_1.shouldIncludeArtifactContext)({
                prompt,
                taskKind: taskProfile.kind,
                hasArtifacts,
            });
            this.emitStartupStatuses(taskId, providerId, taskProfile.kind);
            const runtimePrompt = (0, runtimeScope_1.withBrowserSearchDirective)(prompt, options?.taskProfile);
            const runtimeScope = (0, runtimeScope_1.scopeForPrompt)(prompt, options?.taskProfile);
            const activeArtifact = appStateStore_1.appStateStore.getState().activeArtifactId
                ? appStateStore_1.appStateStore.getState().artifacts.find((artifact) => artifact.id === appStateStore_1.appStateStore.getState().activeArtifactId) ?? null
                : null;
            const artifactRoutingDecision = (0, artifactRouting_1.buildArtifactRoutingDecision)(prompt, activeArtifact);
            const artifactRoutingInstructions = (0, artifactRouting_1.buildArtifactRoutingInstructions)(artifactRoutingDecision);
            const shouldGroundResearch = false;
            const researchContext = null;
            const researchContextPrompt = null;
            const researchGroundingInstructions = null;
            const fullCatalogToolNames = AgentToolExecutor_1.agentToolExecutor.list().map((tool) => tool.name);
            const routedAllowedTools = (0, researchGrounding_1.withGroundedResearchAllowedTools)((0, artifactRouting_1.withArtifactRoutingAllowedTools)(withDocumentAttachmentTools(runtimeScope.allowedTools, options?.attachments), artifactRoutingDecision, fullCatalogToolNames), researchContext, fullCatalogToolNames);
            const hydratableAllowedTools = (0, researchGrounding_1.withGroundedResearchAllowedTools)((0, artifactRouting_1.withArtifactRoutingAllowedTools)(withDocumentAttachmentTools(fullCatalogToolNames, options?.attachments), artifactRoutingDecision, fullCatalogToolNames), researchContext, fullCatalogToolNames);
            const conversationContext = buildConversationHydrationContext({
                taskId,
                prompt,
                taskKind: taskProfile.kind,
                currentMessageId: chatUserMessage.id,
                hasPriorConversation: hadConversationHistory,
                richerContextRequested: richerConversationContextRequested,
                providerSwitched,
            });
            const contextPrompt = buildContextPrompt([
                buildAutomaticTaskContinuationContext(taskId, prompt, chatUserMessage.id),
                buildFollowUpResolutionContext(taskId, prompt, chatUserMessage.id),
                runtimeLedgerStore_1.runtimeLedgerStore.buildTaskSwitchContext({
                    taskId,
                    prompt,
                }),
                runtimeLedgerStore_1.runtimeLedgerStore.buildHydrationContext({
                    taskId,
                    currentProviderId: providerId,
                    providerSwitched,
                }),
                conversationContext,
                includeTaskMemory ? taskMemoryStore_1.taskMemoryStore.buildContext(taskId, {
                    excludeEntryIds: currentTaskMemoryEntryId ? [currentTaskMemoryEntryId] : [],
                }) : null,
                includeArtifactContext ? buildArtifactContext() : null,
                artifactRoutingInstructions ? `## Artifact Route Decision\n${artifactRoutingInstructions}` : null,
                researchContextPrompt,
                buildFileCacheContext(taskProfile.kind),
                buildDocumentAttachmentContext(options?.attachments),
            ], taskProfile.kind);
            const response = await activeTask.runtime.run({
                ...runtimeScope,
                mode: 'unrestricted-dev',
                agentId: providerId,
                role: 'primary',
                task: runtimePrompt,
                taskId,
                cwd: options?.cwd,
                contextPrompt,
                systemPromptAddendum: [
                    options?.systemPrompt,
                    artifactRoutingInstructions,
                    researchGroundingInstructions,
                ].filter(Boolean).join('\n\n') || undefined,
                allowedTools: routedAllowedTools,
                hydratableTools: hydratableAllowedTools,
                restrictToolCatalogToAllowedTools: Boolean(artifactRoutingDecision?.applies || shouldGroundResearch),
                requiresGroundedResearchHydration: shouldGroundResearch,
                attachments: options?.attachments,
                onToken: (text) => {
                    this.emitProgress({
                        taskId,
                        providerId,
                        type: 'token',
                        data: text,
                        timestamp: Date.now(),
                    });
                },
                onStatus: (status) => {
                    this.emitProgress({
                        taskId,
                        providerId,
                        type: 'status',
                        data: status,
                        timestamp: Date.now(),
                    });
                    const processEntry = normalizeStatusProcessEntry(status);
                    if (processEntry)
                        persistedProcessEntries.push(processEntry);
                },
                onItem: ({ item, eventType }) => {
                    if (item.type === 'agent_message')
                        return;
                    this.emitProgress({
                        taskId,
                        providerId,
                        type: 'item',
                        data: eventType,
                        codexItem: item,
                        timestamp: Date.now(),
                    });
                },
            });
            const result = {
                taskId,
                providerId,
                success: true,
                output: response.output,
                artifacts: [],
                codexItems: response.codexItems,
                processEntries: mergeProcessEntries(persistedProcessEntries, response.codexItems),
                usage: response.usage || { inputTokens: 0, outputTokens: 0, durationMs: 0 },
                runId: response.runId,
            };
            ChatKnowledgeStore_1.chatKnowledgeStore.recordAssistantMessage(taskId, response.output, providerId);
            taskMemoryStore_1.taskMemoryStore.recordInvocationResult(result);
            const usage = response.usage;
            if (usage) {
                appStateStore_1.appStateStore.dispatch({
                    type: actions_1.ActionType.ACCUMULATE_TOKEN_USAGE,
                    inputTokens: usage.inputTokens,
                    outputTokens: usage.outputTokens,
                });
            }
            appStateStore_1.appStateStore.dispatch({
                type: actions_1.ActionType.UPDATE_TASK,
                taskId,
                updates: { status: 'completed', owner: providerId, updatedAt: Date.now() },
            });
            runtimeLedgerStore_1.runtimeLedgerStore.recordTaskStatus({
                taskId,
                providerId,
                runId: response.runId,
                status: 'completed',
                summary: `${provider.label} completed ${taskProfile.kind} work`,
                metadata: {
                    success: true,
                    durationMs: response.usage?.durationMs ?? 0,
                },
            });
            this.setRuntime(providerId, {
                status: 'available',
                activeTaskId: null,
                errorDetail: null,
            });
            this.log(providerId, 'info', `${provider.label} invocation completed`, taskId);
            this.queueBackgroundResearchSynthesis({
                taskId,
                prompt,
                taskKind: taskProfile.kind,
                primaryProviderId: providerId,
                fastAnswer: response.output,
                groundedResearchContext: null,
            });
            return result;
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const result = {
                taskId,
                providerId,
                success: false,
                output: '',
                artifacts: [],
                error: message,
                processEntries: persistedProcessEntries,
                usage: { inputTokens: 0, outputTokens: 0, durationMs: 0 },
            };
            ChatKnowledgeStore_1.chatKnowledgeStore.recordAssistantMessage(taskId, `Invocation failed: ${message}`, providerId);
            taskMemoryStore_1.taskMemoryStore.recordInvocationResult(result);
            appStateStore_1.appStateStore.dispatch({
                type: actions_1.ActionType.UPDATE_TASK,
                taskId,
                updates: { status: 'failed', owner: providerId, updatedAt: Date.now() },
            });
            runtimeLedgerStore_1.runtimeLedgerStore.recordTaskStatus({
                taskId,
                providerId,
                status: 'failed',
                summary: `${provider.label} failed ${taskProfile.kind} work: ${message}`,
                metadata: {
                    success: false,
                },
            });
            this.setRuntime(providerId, {
                status: 'error',
                activeTaskId: null,
                errorDetail: message,
            });
            this.log(providerId, 'error', `${provider.label} invocation failed: ${message}`, taskId);
            return result;
        }
        finally {
            this.activeTaskProviders.delete(taskId);
            await this.disposeTaskInvocation(activeTask, providerId, taskId);
        }
    }
    initializeCodexProvider(config) {
        const probe = CodexProvider_1.CodexProvider.isAvailable();
        if (!probe.available) {
            this.setRuntime(config.id, {
                status: 'unavailable',
                activeTaskId: null,
                errorDetail: probe.error || 'Codex CLI is not installed.',
            }, config.modelId);
            this.log(config.id, 'warn', `${config.label} unavailable: ${probe.error || 'Codex CLI is not installed.'}`);
            return;
        }
        const provider = new CodexProvider_1.CodexProvider({
            providerId: config.id,
            modelId: config.modelId,
        });
        this.providers.set(config.id, {
            id: config.id,
            label: config.label,
            modelId: provider.modelId,
            supportsAppToolExecutor: Boolean(provider.supportsAppToolExecutor),
        });
        this.setRuntime(config.id, {
            status: 'available',
            activeTaskId: null,
            errorDetail: null,
        }, provider.modelId);
        this.log(config.id, 'info', `${config.label} ready`);
    }
    async initializeAppServerProvider(config) {
        const probe = CodexProvider_1.CodexProvider.isAvailable();
        if (!probe.available) {
            this.setRuntime(config.id, {
                status: 'unavailable',
                activeTaskId: null,
                errorDetail: probe.error || 'Codex CLI is not installed.',
            }, config.modelId);
            this.log(config.id, 'warn', `${config.label} unavailable: ${probe.error || 'Codex CLI is not installed.'}`);
            return;
        }
        this.providers.set(config.id, {
            id: config.id,
            label: config.label,
            modelId: config.modelId,
            supportsAppToolExecutor: true,
        });
        const sharedProvider = new AppServerBackedProvider_1.AppServerBackedProvider({
            providerId: config.id,
            modelId: config.modelId,
        });
        this.sharedPrimaryAppServerProvider = sharedProvider;
        this.setRuntime(config.id, { status: 'busy', activeTaskId: null, errorDetail: null }, config.modelId);
        this.log(config.id, 'info', `${config.label} prewarming app-server session`);
        try {
            await sharedProvider.prewarm();
            this.setRuntime(config.id, { status: 'available', activeTaskId: null, errorDetail: null }, config.modelId);
            this.log(config.id, 'info', `${config.label} ready (prewarmed app-server mode)`);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.sharedPrimaryAppServerProvider = null;
            this.setRuntime(config.id, {
                status: 'error',
                activeTaskId: null,
                errorDetail: message,
            }, config.modelId);
            this.log(config.id, 'warn', `${config.label} app-server prewarm failed: ${message}`);
        }
    }
    initializeHaikuProvider(config) {
        try {
            const provider = new HaikuProvider_1.HaikuProvider();
            this.providers.set(config.id, {
                id: config.id,
                label: config.label,
                modelId: provider.modelId,
                supportsAppToolExecutor: Boolean(provider.supportsAppToolExecutor),
            });
            this.setRuntime(config.id, {
                status: 'available',
                activeTaskId: null,
                errorDetail: null,
            }, provider.modelId);
            this.log(config.id, 'info', `${config.label} ready: ${provider.modelId}`);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.setRuntime(config.id, {
                status: 'unavailable',
                activeTaskId: null,
                errorDetail: message,
            });
            this.log(config.id, 'warn', `${config.label} unavailable: ${message}`);
        }
    }
    pickProvider(prompt, explicitOwner, options) {
        if (explicitOwner && explicitOwner !== 'auto') {
            if (!isSupportedProvider(explicitOwner)) {
                throw new Error(`Unsupported provider: ${explicitOwner}`);
            }
            if (!this.providers.has(explicitOwner)) {
                throw new Error(this.buildUnavailableProviderMessage(explicitOwner));
            }
            this.assertProviderSupportsPrompt(explicitOwner, prompt, options);
            return explicitOwner;
        }
        const autoProvider = this.pickAutoProvider(prompt, options);
        if (autoProvider)
            return autoProvider;
        const profile = (0, taskProfile_1.buildTaskProfile)(prompt, options?.taskProfile);
        const requiresAppTools = (0, providerRouting_1.taskKindRequiresV2ToolRuntime)(profile.kind);
        if (requiresAppTools) {
            throw new Error(`No model provider that executes through the V2 tool runtime is available for ${profile.kind} tasks.`);
        }
        throw new Error('No model provider is available. Check Codex CLI availability and authentication.');
    }
    pickAutoProvider(prompt = '', options) {
        return (0, providerRouting_1.pickProviderForPrompt)(prompt, this.providers.keys(), options?.taskProfile, this.getProviderRoutingCapabilities());
    }
    createPreferredSubAgentProvider(input) {
        const taskPrompt = [input?.role, input?.task].filter(Boolean).join('\n');
        const taskKind = (0, taskProfile_1.buildTaskProfile)(taskPrompt).kind;
        if (input?.providerId && input.providerId !== 'auto') {
            if (!this.providers.has(input.providerId)) {
                throw new Error(this.buildUnavailableProviderMessage(input.providerId));
            }
            this.assertProviderSupportsPrompt(input.providerId, taskPrompt);
            return this.createProviderInstance(input.providerId, taskKind);
        }
        const preferred = this.pickAutoProvider(taskPrompt);
        if (preferred)
            return this.createProviderInstance(preferred, taskKind);
        throw new Error('No compatible provider is available for the requested sub-agent task.');
    }
    createProviderInstance(providerId, taskKind = 'general') {
        const config = PROVIDER_CONFIGS.find((entry) => entry.id === providerId);
        if (!config) {
            throw new Error(`Unknown provider configuration: ${providerId}`);
        }
        if (providerId === model_1.HAIKU_PROVIDER_ID) {
            return new HaikuProvider_1.HaikuProvider();
        }
        if (providerId === model_1.PRIMARY_PROVIDER_ID) {
            if (this.sharedPrimaryAppServerProvider) {
                return this.sharedPrimaryAppServerProvider;
            }
            return new AppServerBackedProvider_1.AppServerBackedProvider({
                providerId: config.id,
                modelId: config.modelId,
            });
        }
        return new CodexProvider_1.CodexProvider({ providerId: config.id, modelId: config.modelId });
    }
    createTaskInvocation(providerId, taskKind = 'general') {
        const provider = this.createProviderInstance(providerId, taskKind);
        const shouldDispose = hasDisposableProvider(provider) && provider !== this.sharedPrimaryAppServerProvider;
        return {
            providerId,
            runtime: new AgentRuntime_1.AgentRuntime(provider),
            runtimeStartedAt: Date.now(),
            dispose: shouldDispose
                ? async () => {
                    await provider.dispose();
                }
                : undefined,
        };
    }
    async disposeTaskInvocation(activeTask, providerId, taskId) {
        if (!activeTask.dispose)
            return;
        try {
            await activeTask.dispose();
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.log(providerId, 'warn', `Task runtime cleanup failed: ${message}`, taskId);
        }
    }
    buildUnavailableProviderMessage(providerId) {
        const runtime = appStateStore_1.appStateStore.getState().providers[providerId];
        const suffix = runtime?.errorDetail ? ` ${runtime.errorDetail}` : '';
        const label = this.providers.get(providerId)?.label
            ?? PROVIDER_CONFIGS.find((entry) => entry.id === providerId)?.label
            ?? providerId;
        return `${label} is not available.${suffix}`.trim();
    }
    assertProviderSupportsPrompt(providerId, prompt, options) {
        const provider = this.providers.get(providerId);
        if (!provider)
            return;
        const profile = (0, taskProfile_1.buildTaskProfile)(prompt, options?.taskProfile);
        const requiresAppTools = (0, providerRouting_1.taskKindRequiresV2ToolRuntime)(profile.kind);
        if (!requiresAppTools || provider.supportsAppToolExecutor)
            return;
        throw new Error(`${provider.label} does not execute through the V2 tool runtime yet and cannot be used for ${profile.kind} tasks.`);
    }
    getProviderRoutingCapabilities() {
        return Array.from(this.providers.values()).reduce((capabilities, provider) => {
            capabilities[provider.id] = {
                supportsV2ToolRuntime: provider.supportsAppToolExecutor,
            };
            return capabilities;
        }, {});
    }
    setRuntime(providerId, patch, modelOverride) {
        const provider = this.providers.get(providerId);
        appStateStore_1.appStateStore.dispatch({
            type: actions_1.ActionType.SET_PROVIDER_RUNTIME,
            providerId,
            runtime: {
                id: providerId,
                status: patch.status,
                activeTaskId: patch.activeTaskId,
                lastActivityAt: Date.now(),
                errorDetail: patch.errorDetail,
                model: modelOverride || provider?.modelId,
            },
        });
    }
    log(source, level, message, taskId) {
        const log = {
            id: (0, ids_1.generateId)('log'),
            timestamp: Date.now(),
            level,
            source,
            message,
            taskId,
        };
        eventBus_1.eventBus.emit(events_1.AppEventType.LOG_ADDED, { log });
    }
    emitProgress(progress) {
        for (const win of electron_1.BrowserWindow.getAllWindows()) {
            win.webContents.send(ipc_1.IPC_CHANNELS.MODEL_PROGRESS, progress);
        }
    }
    emitStartupStatuses(taskId, providerId, taskKind) {
        const statuses = (0, startupProgress_1.buildStartupStatusMessages)({
            taskKind,
            browserSurfaceReady: BrowserService_1.browserService.isCreated(),
        });
        for (const status of statuses) {
            this.emitProgress({
                taskId,
                providerId,
                type: 'status',
                data: status,
                timestamp: Date.now(),
            });
        }
    }
    queueBackgroundResearchSynthesis(input) {
        const synthesisProviderId = (0, researchSynthesis_1.backgroundResearchSynthesisProviderId)();
        const synthesisProviderAvailable = this.providers.has(synthesisProviderId)
            && !Array.from(this.activeTaskProviders.values()).some((activeTask) => activeTask.providerId === synthesisProviderId);
        if (!(0, researchSynthesis_1.shouldRunBackgroundResearchSynthesis)({
            prompt: input.prompt,
            taskKind: input.taskKind,
            primaryProviderId: input.primaryProviderId,
            synthesisProviderAvailable,
        })) {
            return;
        }
        void this.runBackgroundResearchSynthesis({
            ...input,
            synthesisProviderId,
        });
    }
    async runBackgroundResearchSynthesis(input) {
        const toolTranscript = ChatKnowledgeStore_1.chatKnowledgeStore.readLast(input.taskId, {
            role: 'tool',
            count: 8,
            maxChars: 10_000,
        });
        if (!toolTranscript.text.trim()) {
            this.log(input.synthesisProviderId, 'info', 'Background research synthesis skipped: no cached tool evidence', input.taskId);
            return;
        }
        const synthesisTask = this.createTaskInvocation(input.synthesisProviderId);
        try {
            const synthesisContext = (0, researchSynthesis_1.buildBackgroundResearchSynthesisContext)({
                prompt: input.prompt,
                fastAnswer: input.fastAnswer,
                threadSummary: ChatKnowledgeStore_1.chatKnowledgeStore.threadSummary(input.taskId),
                evidenceTranscript: toolTranscript.text,
                groundedResearchContext: input.groundedResearchContext,
            });
            const response = await synthesisTask.runtime.run({
                mode: 'unrestricted-dev',
                agentId: input.synthesisProviderId,
                role: 'secondary',
                taskId: input.taskId,
                task: (0, researchSynthesis_1.buildBackgroundResearchSynthesisTask)({
                    groundedEvidenceReasoning: Boolean(input.groundedResearchContext?.trim()),
                }),
                contextPrompt: synthesisContext,
                allowedTools: [],
                canSpawnSubagents: false,
                maxToolTurns: 1,
                onStatus: (status) => {
                    if (!status.trim())
                        return;
                    this.log(input.synthesisProviderId, 'info', `Background synthesis status: ${status}`, input.taskId);
                },
            });
            const formatted = (0, researchSynthesis_1.formatBackgroundResearchSynthesis)(response.output);
            if (!formatted || formatted === researchSynthesis_1.NO_MATERIAL_RESEARCH_UPDATE) {
                this.log(input.synthesisProviderId, 'info', 'Background research synthesis found no material update', input.taskId);
                return;
            }
            ChatKnowledgeStore_1.chatKnowledgeStore.recordAssistantMessage(input.taskId, formatted, input.synthesisProviderId);
            taskMemoryStore_1.taskMemoryStore.recordInvocationResult({
                taskId: input.taskId,
                providerId: input.synthesisProviderId,
                success: true,
                output: formatted,
                artifacts: [],
                usage: response.usage || { inputTokens: 0, outputTokens: 0, durationMs: 0 },
                codexItems: response.codexItems,
            });
            appStateStore_1.appStateStore.dispatch({
                type: actions_1.ActionType.UPDATE_TASK,
                taskId: input.taskId,
                updates: { updatedAt: Date.now() },
            });
            this.emitProgress({
                taskId: input.taskId,
                providerId: input.synthesisProviderId,
                type: 'status',
                data: 'Background synthesis appended a refined answer.',
                timestamp: Date.now(),
            });
            this.log(input.synthesisProviderId, 'info', 'Background research synthesis appended to task memory', input.taskId);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.log(input.synthesisProviderId, 'warn', `Background research synthesis failed: ${message}`, input.taskId);
        }
        finally {
            await this.disposeTaskInvocation(synthesisTask, input.synthesisProviderId, input.taskId);
        }
    }
}
exports.AgentModelService = AgentModelService;
function isSupportedProvider(value) {
    return value === model_1.PRIMARY_PROVIDER_ID || value === model_1.HAIKU_PROVIDER_ID;
}
function hasDisposableProvider(provider) {
    return typeof provider.dispose === 'function';
}
function buildContextPrompt(parts, taskKind) {
    return packContextSections(parts, (0, invocationContextPolicy_1.contextPromptBudgetForTaskKind)(taskKind), '\n...[context truncated]');
}
function buildAutomaticTaskContinuationContext(taskId, prompt, currentMessageId) {
    if (!looksLikeContinuationPrompt(prompt) && !lastInvocationFailed(taskId)) {
        return null;
    }
    const recall = ChatKnowledgeStore_1.chatKnowledgeStore.recall(taskId, {
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
function looksLikeContinuationPrompt(prompt) {
    return /\b(continue|resume|retry|pick up|keep going|go on|same task|that failed|fix that|where were we|carry on)\b/i.test(prompt)
        || prompt.trim().length <= 40 && /\b(this|that|it|same)\b/i.test(prompt);
}
function lastInvocationFailed(taskId) {
    const record = taskMemoryStore_1.taskMemoryStore.get(taskId);
    const latestResult = [...record.entries].reverse().find(entry => entry.kind === 'model_result');
    return latestResult?.metadata?.success === false;
}
function getLastInvocationProviderId(taskId) {
    const record = taskMemoryStore_1.taskMemoryStore.get(taskId);
    const latestResult = [...record.entries].reverse().find((entry) => entry.kind === 'model_result' && Boolean(entry.providerId));
    return latestResult?.providerId ?? null;
}
function getLastFailureText(taskId) {
    const record = taskMemoryStore_1.taskMemoryStore.get(taskId);
    const latestFailed = [...record.entries].reverse().find(entry => entry.kind === 'model_result' && entry.metadata?.success === false);
    return latestFailed?.text || null;
}
function buildConversationHydrationContext(input) {
    const explicitPreviousChatRecall = isExplicitPreviousChatRecallPrompt(input.prompt);
    const hydrationTaskId = explicitPreviousChatRecall
        ? findMostRecentPriorConversationTaskId(input.taskId)
        : input.taskId;
    if (!hydrationTaskId)
        return null;
    if (!explicitPreviousChatRecall && !input.hasPriorConversation)
        return null;
    if (explicitPreviousChatRecall && hydrationTaskId !== input.taskId) {
        const searchTerms = ChatHydrationDetector_1.chatHydrationDetector
            .extractContextKeywords(input.prompt)
            .filter((term) => !isGenericPreviousChatKeyword(term));
        const need = searchTerms.length > 0 ? 'searched' : 'full';
        const maxChars = conversationHydrationBudget(input.taskKind, need, false);
        const recalled = ChatKnowledgeStore_1.chatKnowledgeStore.buildSilentHydrationContext(hydrationTaskId, {
            need,
            searchQuery: need === 'searched' ? searchTerms.join(' ') : undefined,
            maxChars,
            excludeToolResults: true,
        });
        if (!recalled)
            return null;
        return [
            '## Previous Chat Recall',
            'The user explicitly asked to reference the most recent prior chat thread. Use the recalled thread below as prior-chat context.',
            recalled,
        ].join('\n\n');
    }
    const detectedNeed = ChatHydrationDetector_1.chatHydrationDetector.detectNeed({
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
    const baseNeed = detectedNeed === 'none' ? 'recent' : detectedNeed;
    const need = input.providerSwitched && baseNeed !== 'searched'
        ? 'full'
        : baseNeed;
    const searchQuery = need === 'searched'
        ? ChatHydrationDetector_1.chatHydrationDetector.extractContextKeywords(input.prompt).join(' ')
        : undefined;
    const maxChars = conversationHydrationBudget(input.taskKind, need, input.providerSwitched);
    return ChatKnowledgeStore_1.chatKnowledgeStore.buildSilentHydrationContext(hydrationTaskId, {
        need,
        searchQuery,
        maxChars,
        currentMessageId: hydrationTaskId === input.taskId ? input.currentMessageId : undefined,
        excludeToolResults: true,
    });
}
function isExplicitPreviousChatRecallPrompt(prompt) {
    const lower = prompt.toLowerCase();
    return /\b(previous|prior|earlier|last)\s+(chat|thread|conversation)\b/.test(lower)
        || /\b(chat|thread|conversation)\s+from\s+(before|earlier|last time)\b/.test(lower)
        || /\breference\s+(the\s+)?previous\s+(chat|thread|conversation)\b/.test(lower)
        || /\buse\s+(the\s+)?previous\s+(chat|thread|conversation)\b/.test(lower);
}
function isGenericPreviousChatKeyword(term) {
    return term === 'previous'
        || term === 'prior'
        || term === 'earlier'
        || term === 'last'
        || term === 'chat'
        || term === 'thread'
        || term === 'conversation'
        || term === 'reference'
        || term === 'use';
}
function findMostRecentPriorConversationTaskId(currentTaskId) {
    const tasks = appStateStore_1.appStateStore.getState().tasks ?? [];
    const priorTasks = [...tasks]
        .filter((task) => task.id !== currentTaskId)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    for (const task of priorTasks) {
        if (ChatKnowledgeStore_1.chatKnowledgeStore.threadSummary(task.id)) {
            return task.id;
        }
    }
    return null;
}
function buildFollowUpResolutionContext(taskId, prompt, currentMessageId) {
    if (!looksLikeEllipticalFollowUp(prompt)) {
        return null;
    }
    const recent = ChatKnowledgeStore_1.chatKnowledgeStore.readLast(taskId, {
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
    const assistantText = ChatKnowledgeStore_1.chatKnowledgeStore.readMessage(taskId, lastAssistant.id, 700)?.text?.trim() || lastAssistant.preview;
    const userText = lastUser
        ? (ChatKnowledgeStore_1.chatKnowledgeStore.readMessage(taskId, lastUser.id, 500)?.text?.trim() || lastUser.preview)
        : '';
    const sections = [
        '## Follow-Up Resolution',
        'The current user message is an elliptical follow-up. Resolve it against the immediately preceding conversation before acting.',
    ];
    if (userText) {
        sections.push('', 'Latest prior user request:', userText);
    }
    sections.push('', 'Latest prior assistant message:', assistantText, '', `Resolution rule: ${followUpResolutionRule(prompt)}`);
    return sections.join('\n');
}
function looksLikeEllipticalFollowUp(prompt) {
    const lower = prompt.toLowerCase().trim();
    if (!lower)
        return false;
    if (lower.length > 120)
        return false;
    return /^(yes|yeah|yep|sure|ok|okay|no|nope|go ahead|do it|proceed|sounds good|that works)\b/.test(lower)
        || /\b(?:it|this|that|same)\b/.test(lower)
        || /\b(?:install|fix|debug|review|apply|do|ship|help)\b/.test(lower);
}
function followUpResolutionRule(prompt) {
    const lower = prompt.toLowerCase().trim();
    if (/^(no|nope)\b/.test(lower)) {
        return 'Treat this as declining or reversing the most recent concrete assistant proposal; do not perform that action unless the user then specifies another one.';
    }
    if (/^(yes|yeah|yep|sure|ok|okay|go ahead|do it|proceed|sounds good|that works)\b/.test(lower)) {
        return 'Treat this as approval to carry out the most recent concrete assistant proposal, installation step, fix, or next action.';
    }
    return 'Treat references like "it", "this", or "that" as pointing to the most recent concrete assistant proposal, identified issue, or requested fix unless a newer explicit referent appears.';
}
function conversationHydrationBudget(taskKind, need, providerSwitched) {
    const baseBudget = (0, invocationContextPolicy_1.contextPromptBudgetForTaskKind)(taskKind);
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
function packContextSections(parts, maxChars, truncationSuffix) {
    const normalized = parts
        .map(part => part?.trim())
        .filter((part) => Boolean(part));
    if (normalized.length === 0)
        return null;
    const packed = [];
    let used = 0;
    for (const part of normalized) {
        const separator = packed.length > 0 ? '\n\n' : '';
        const available = maxChars - used - separator.length;
        if (available <= 0)
            break;
        if (part.length <= available) {
            packed.push(separator ? `${separator}${part}` : part);
            used += separator.length + part.length;
            continue;
        }
        const reserveForSuffix = truncationSuffix.length;
        if (available <= reserveForSuffix)
            break;
        const truncated = `${part.slice(0, available - reserveForSuffix)}${truncationSuffix}`;
        packed.push(separator ? `${separator}${truncated}` : truncated);
        used += separator.length + truncated.length;
        break;
    }
    const context = packed.join('');
    return context || null;
}
exports.agentModelService = new AgentModelService();
//# sourceMappingURL=AgentModelService.js.map