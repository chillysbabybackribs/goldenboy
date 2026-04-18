import type { CodexItem } from '../../shared/types/model.js';
export interface LiveRunRenderCallbacks {
    renderMarkdown: (text: string) => string;
    updateLastAgentResponseText: (text: string) => void;
    scheduleChatScrollToBottom: (force?: boolean, frames?: number) => void;
    disableChatAutoPin: () => void;
}
export type LiveRunCard = {
    root: HTMLElement;
    panel: HTMLElement;
    stream: HTMLElement;
    output: HTMLElement;
    response: HTMLElement | null;
    /** True once the user has clicked Stop — gates further streaming */
    cancelling: boolean;
    /** Active tool line element (shimmer state) */
    activeToolEl: HTMLElement | null;
    /** Last completed thought element (gets waiting shimmer) */
    lastThoughtEl: HTMLElement | null;
    /** Queue of thought chunks waiting to be typed out */
    typingQueue: string[];
    typingTimer: number | null;
    activeThoughtEl: HTMLElement | null;
    /** Tool events that arrived while a thought was typing */
    deferredToolEvents: Array<{
        kind: 'start' | 'done';
        text: string;
    }>;
    /** Full received token text */
    tokenBuffer: string;
    /** How many chars of tokenBuffer have been rendered to screen */
    tokenVisibleLength: number;
    /** Reserved for legacy streaming cancellation state */
    tokenTypingTimer: number | null;
    pendingFinalResult: {
        result: any;
        provider?: string;
    } | null;
    pendingErrorText: string | null;
    callbacks: LiveRunRenderCallbacks;
};
export declare function getLiveRunCard(taskId: string): LiveRunCard | null;
export declare function hasLiveRunCard(taskId: string): boolean;
export declare function createLiveRunCard(taskId: string, _provider: string, container: HTMLElement, callbacks: LiveRunRenderCallbacks, _prompt?: string): LiveRunCard;
export declare function markCancelling(taskId: string): void;
export declare function appendToken(taskId: string, text: string): void;
export declare function appendThought(taskId: string, text: string): void;
export declare function migrateBufferedOutputToThoughts(taskId: string): void;
export declare function appendToolActivity(taskId: string, kind: 'call' | 'result', text: string): void;
export declare function appendToolStatus(taskId: string, status: string): void;
export declare function appendCodexItemProgress(taskId: string, progressData: string, item?: CodexItem): void;
export declare function replaceWithResult(taskId: string, result: any, provider?: string): void;
export declare function replaceWithError(taskId: string, error: string): void;
