"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.chatHydrationDetector = exports.ChatHydrationDetector = void 0;
const FOLLOW_UP_INDICATORS = new Set([
    'yes', 'no', 'ok', 'okay', 'continue', 'next', 'explain', 'more',
    'what', 'why', 'how', 'better', 'simplify', 'expand', 'clarify',
    'again', 'once more', 'one more', 'also', 'and then', 'also',
]);
const FOLLOW_UP_APPROVAL_PHRASES = new Set([
    'go ahead',
    'do it',
    'install it',
    'fix it',
    'ship it',
    'proceed',
    'sounds good',
    'that works',
    'lets do it',
    "let's do it",
    'help me fix this',
    'help me install this',
]);
const RELATIVE_PRONOUNS = new Set([
    'it', 'that', 'this', 'these', 'those', 'them', 'they', 'their',
]);
const PRIOR_TIME_REFS = new Set([
    'earlier', 'before', 'previously', 'last time', 'just now', 'above',
    'earlier discussion', 'prior', 'previous', 'prior discussion',
]);
const RECAP_INDICATORS = new Set([
    'summarize', 'recap', 'what did we', 'what have', 'remind me',
    'what we discussed', 'overview', 'summary', 'background',
]);
const CONTEXT_KEYWORDS = new Set([
    'about that', 'regarding that', 'on the topic', 'with the', 'the approach',
    'the solution', 'the code', 'the file', 'the error', 'the issue',
    'that implementation', 'that api', 'that system', 'that feature',
]);
class ChatHydrationDetector {
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
    detectNeed(input) {
        const { userMessage, priorTaskExists, conversationMode, isFollowUp } = input;
        // No conversation context available or disabled
        if (!conversationMode || !priorTaskExists) {
            return 'none';
        }
        const lower = userMessage.toLowerCase().trim();
        // Explicit recap request
        if (this.matchesSet(lower, RECAP_INDICATORS)) {
            return 'full';
        }
        // Explicit follow-up (short message with indicator)
        if (isFollowUp || this.looksLikeFollowUp(lower)) {
            return 'recent';
        }
        // Relative pronouns or temporal references
        if (this.hasRelativeContext(lower)) {
            return 'recent';
        }
        // Topic-specific references that need search
        if (this.hasTopicReferences(lower)) {
            return 'searched';
        }
        return 'none';
    }
    /**
     * Extract keywords from user message for semantic search.
     * Used when 'searched' hydration is needed.
     */
    extractContextKeywords(userMessage) {
        const lower = userMessage.toLowerCase();
        // Extract nouns and key terms
        const terms = new Set();
        // Pattern: "about X", "regarding X", "on the topic of X"
        const aboutMatches = lower.match(/about\s+([a-z_-]+(?:\s+[a-z_-]+)?)/gi);
        if (aboutMatches) {
            aboutMatches.forEach((m) => {
                const term = m.replace(/^about\s+/i, '').trim();
                if (term.length >= 2)
                    terms.add(term);
            });
        }
        // Pattern: "the X" where X is likely a noun
        const theMatches = lower.match(/\bthe\s+([a-z_-]+(?:\s+[a-z_-]+)?)/gi);
        if (theMatches) {
            theMatches.forEach((m) => {
                const term = m.replace(/^the\s+/i, '').trim();
                if (term.length >= 3 && !this.isStopWord(term))
                    terms.add(term);
            });
        }
        // Pattern: camelCase or snake_case identifiers
        const identifiers = lower.match(/[a-z_$][a-z0-9_$]*(?:[A-Z][a-z0-9]*)*|[a-z]+_[a-z_]+/gi);
        if (identifiers) {
            identifiers.forEach((id) => {
                if (id.length >= 3)
                    terms.add(id);
            });
        }
        // Pattern: "API", "REST", all-caps terms
        const acronyms = userMessage.match(/\b[A-Z]{2,}\b/g);
        if (acronyms) {
            acronyms.forEach((acronym) => {
                terms.add(acronym.toLowerCase());
            });
        }
        // Top technical terms from the message
        const words = lower.split(/\W+/).filter((w) => w.length >= 3 && !this.isStopWord(w));
        words.slice(0, 8).forEach((w) => terms.add(w));
        return Array.from(terms).slice(0, 10);
    }
    /**
     * Check if message looks like a follow-up (short, has indicators).
     */
    looksLikeFollowUp(lower) {
        // Short messages are usually follow-ups
        if (lower.length < 100) {
            return this.hasFollowUpSignal(lower);
        }
        // Long messages with explicit indicators
        return this.hasFollowUpSignal(lower);
    }
    /**
     * Check if message has follow-up signals.
     */
    hasFollowUpSignal(lower) {
        // Check for yes/no/ok/continue at start
        if (/^(yes|no|ok|okay|sure|continue|next|more|why|how|what)\b/.test(lower)) {
            return true;
        }
        // Check for follow-up words
        if (this.matchesSet(lower, FOLLOW_UP_INDICATORS)) {
            return true;
        }
        if (this.matchesSet(lower, FOLLOW_UP_APPROVAL_PHRASES)) {
            return true;
        }
        return false;
    }
    /**
     * Check if message has relative context (pronouns, temporal refs).
     */
    hasRelativeContext(lower) {
        // Check for relative pronouns
        const words = lower.split(/\W+/);
        if (words.some((w) => RELATIVE_PRONOUNS.has(w) || PRIOR_TIME_REFS.has(w))) {
            return true;
        }
        // Check for temporal patterns
        if (/(earlier|before|previously|above|prior|last time|just now)/i.test(lower)) {
            return true;
        }
        return false;
    }
    /**
     * Check if message references specific topics.
     */
    hasTopicReferences(lower) {
        // Check for explicit topic references
        if (this.matchesSet(lower, CONTEXT_KEYWORDS)) {
            return true;
        }
        // Pattern: "that implementation", "the solution", "that API"
        if (/(that\s+(?:implementation|approach|solution|api|system|feature|code|error|issue))/i.test(lower)) {
            return true;
        }
        // Pattern: "the X" where X seems to be something discussed
        const theMatches = lower.match(/\bthe\s+([a-z_-]+(?:\s+[a-z_-]+)?)/gi);
        if (theMatches && theMatches.length > 2) {
            return true; // Multiple "the X" references suggest prior context
        }
        return false;
    }
    /**
     * Check if lower-cased text matches any terms in a set.
     */
    matchesSet(lower, set) {
        const words = new Set(lower.split(/\W+/).filter(Boolean));
        return Array.from(set).some((term) => {
            if (term.includes(' ')) {
                return lower.includes(term);
            }
            return words.has(term);
        });
    }
    /**
     * Check if a word is likely a stop word (common, low-information).
     */
    isStopWord(word) {
        const stopWords = new Set([
            'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were',
            'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
            'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can',
            'in', 'on', 'at', 'to', 'from', 'of', 'with', 'by', 'for', 'as',
            'if', 'this', 'that', 'which', 'what', 'when', 'where', 'why', 'how',
            'it', 'its', 'all', 'each', 'every', 'both', 'these', 'those', 'more',
            'most', 'some', 'any', 'other', 'such', 'no', 'nor', 'not', 'only',
        ]);
        return stopWords.has(word);
    }
}
exports.ChatHydrationDetector = ChatHydrationDetector;
exports.chatHydrationDetector = new ChatHydrationDetector();
//# sourceMappingURL=ChatHydrationDetector.js.map