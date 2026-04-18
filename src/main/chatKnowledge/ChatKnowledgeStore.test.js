"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const vitest_1 = require("vitest");
vitest_1.vi.mock('electron', () => ({
    app: {
        getPath: () => process.env.V2_TEST_USER_DATA || os.tmpdir(),
    },
}));
const ChatKnowledgeStore_1 = require("./ChatKnowledgeStore");
(0, vitest_1.describe)('ChatKnowledgeStore', () => {
    let userDataDir = '';
    (0, vitest_1.beforeEach)(() => {
        userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-chat-cache-user-data-'));
        process.env.V2_TEST_USER_DATA = userDataDir;
    });
    (0, vitest_1.afterEach)(() => {
        delete process.env.V2_TEST_USER_DATA;
        fs.rmSync(userDataDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)('includes the live user turn alongside prior thread context', () => {
        const store = new ChatKnowledgeStore_1.ChatKnowledgeStore();
        const taskId = 'task-chat-context';
        store.recordAssistantMessage(taskId, 'Previous answer with the earlier plan.');
        const current = store.recordUserMessage(taskId, 'Follow the same plan but include tests.');
        const context = store.buildInvocationContext(taskId, current.id);
        (0, vitest_1.expect)(context).toContain('### Current User Message');
        (0, vitest_1.expect)(context).toContain('Follow the same plan but include tests.');
        (0, vitest_1.expect)(context).toContain('### Recent Conversation');
        (0, vitest_1.expect)(context).toContain('Assistant: Previous answer with the earlier plan.');
    });
    (0, vitest_1.it)('builds silent hydration context without explicit transcript headings', () => {
        const store = new ChatKnowledgeStore_1.ChatKnowledgeStore();
        const taskId = 'task-silent-hydration';
        store.recordUserMessage(taskId, 'Start a rollout plan for the migration.');
        store.recordAssistantMessage(taskId, 'Draft plan: discovery, migration, rollout.', 'gpt-5.4');
        const current = store.recordUserMessage(taskId, 'Continue this and add risks for rollout.');
        const context = store.buildSilentHydrationContext(taskId, {
            need: 'full',
            currentMessageId: current.id,
            excludeToolResults: true,
        });
        (0, vitest_1.expect)(context).toContain('The task began with the request: Start a rollout plan for the migration.');
        (0, vitest_1.expect)(context).toContain('The latest assistant result was: Draft plan: discovery, migration, rollout.');
        (0, vitest_1.expect)(context).toContain('Earlier, the user said: Start a rollout plan for the migration.');
        (0, vitest_1.expect)(context).toContain('Then, the assistant replied: Draft plan: discovery, migration, rollout.');
        (0, vitest_1.expect)(context).not.toContain('## Conversation Context');
        (0, vitest_1.expect)(context).not.toContain('Initial goal:');
        (0, vitest_1.expect)(context).not.toContain('User: ');
        (0, vitest_1.expect)(context).not.toContain('Assistant (gpt-5.4):');
    });
});
//# sourceMappingURL=ChatKnowledgeStore.test.js.map