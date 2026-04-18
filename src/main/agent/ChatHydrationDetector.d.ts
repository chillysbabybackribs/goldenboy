/**
 * ChatHydrationDetector
 *
 * Analyzes user messages and task context to determine if prior conversation
 * context should be hydrated into the prompt. Works silently — no visible traces.
 *
 * Returns the type of hydration needed:
 * - 'none': no prior context needed
 * - 'recent': load last few messages (follow-ups)
 * - 'full': load full summary + recent messages (recap requests)
 * - 'searched': load specific messages by keyword match
 */
export type HydrationNeed = 'none' | 'recent' | 'full' | 'searched';
export type HydrationInput = {
    userMessage: string;
    taskId: string;
    priorTaskExists: boolean;
    conversationMode: boolean;
    isFollowUp?: boolean;
};
export declare class ChatHydrationDetector {
    /**
     * Analyze user message to determine if prior context should be hydrated.
     *
     * Detection is fast and heuristic-based:
     * - Follow-up patterns (yes/no, continue, pronouns)
     * - Temporal references (earlier, previously)
     * - Recap requests (summarize, what did we)
     * - Topic references (about X, the Y)
     *
     * Returns type of hydration needed.
     */
    detectNeed(input: HydrationInput): HydrationNeed;
    /**
     * Extract keywords from user message for semantic search.
     * Used when 'searched' hydration is needed.
     */
    extractContextKeywords(userMessage: string): string[];
    /**
     * Check if message looks like a follow-up (short, has indicators).
     */
    private looksLikeFollowUp;
    /**
     * Check if message has follow-up signals.
     */
    private hasFollowUpSignal;
    /**
     * Check if message has relative context (pronouns, temporal refs).
     */
    private hasRelativeContext;
    /**
     * Check if message references specific topics.
     */
    private hasTopicReferences;
    /**
     * Check if lower-cased text matches any terms in a set.
     */
    private matchesSet;
    /**
     * Check if a word is likely a stop word (common, low-information).
     */
    private isStopWord;
}
export declare const chatHydrationDetector: ChatHydrationDetector;
