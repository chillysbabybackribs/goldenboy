"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const ChatHydrationDetector_1 = require("./ChatHydrationDetector");
(0, vitest_1.describe)('ChatHydrationDetector', () => {
    const detector = new ChatHydrationDetector_1.ChatHydrationDetector();
    (0, vitest_1.it)('detects phrase-based follow-ups like "go ahead"', () => {
        (0, vitest_1.expect)(detector.detectNeed({
            userMessage: 'go ahead',
            taskId: 'task-1',
            priorTaskExists: true,
            conversationMode: true,
        })).toBe('recent');
    });
    (0, vitest_1.it)('detects multi-word recap requests', () => {
        (0, vitest_1.expect)(detector.detectNeed({
            userMessage: 'what did we decide about the install path',
            taskId: 'task-1',
            priorTaskExists: true,
            conversationMode: true,
        })).toBe('full');
    });
});
//# sourceMappingURL=ChatHydrationDetector.test.js.map