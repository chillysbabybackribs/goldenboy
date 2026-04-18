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
export declare class ChatKnowledgeStore {
    private indexes;
    recordUserMessage(taskId: string, text: string): ChatMessageMeta;
    recordAssistantMessage(taskId: string, text: string, providerId?: AnyProviderId, runId?: string): ChatMessageMeta;
    recordToolMessage(taskId: string, text: string, providerId?: AnyProviderId, runId?: string): ChatMessageMeta;
    recordMessage(input: {
        taskId: string;
        role: ChatMessageRole;
        text: string;
        providerId?: AnyProviderId;
        runId?: string;
    }): ChatMessageMeta;
    buildInvocationContext(taskId: string, currentMessageId?: string): string | null;
    threadSummary(taskId: string): string | null;
    readLast(taskId: string, input?: {
        count?: number;
        maxChars?: number;
        role?: ChatMessageRole;
        excludeMessageIds?: string[];
    }): {
        text: string;
        messages: ChatMessageMeta[];
        tokenEstimate: number;
        truncated: boolean;
    };
    search(taskId: string, input: {
        query: string;
        role?: ChatMessageRole;
        includeTools?: boolean;
        limit?: number;
        maxSnippetChars?: number;
        excludeMessageIds?: string[];
    }): {
        query: string;
        results: ChatSearchResult[];
        tokenEstimate: number;
    };
    readMessage(taskId: string, messageId: string, maxChars?: number): {
        message: ChatMessageMeta;
        text: string;
        tokenEstimate: number;
        truncated: boolean;
    } | null;
    readWindow(taskId: string, input: {
        messageId?: string;
        before?: number;
        after?: number;
        maxChars?: number;
    }): {
        text: string;
        messages: ChatMessageMeta[];
        tokenEstimate: number;
        truncated: boolean;
    };
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
    };
    getStats(taskId: string): {
        taskId: string;
        messageCount: number;
        totalChars: number;
        totalTokenEstimate: number;
        updatedAt: number | null;
    };
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
    }): string | null;
    private buildSilentSummary;
    private buildSummary;
    private selectHydrationMessages;
    private renderHydrationMessages;
    private renderSilentHydrationMessages;
    private messageRoleLabel;
    private renderMessages;
    private loadIndex;
    private saveIndex;
    private readRawMessage;
    private taskDir;
    private messagesDir;
    private indexPath;
    private messagePath;
    private ensureTaskDir;
    private ensureMessagesDir;
}
export declare const chatKnowledgeStore: ChatKnowledgeStore;
