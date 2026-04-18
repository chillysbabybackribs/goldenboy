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
const taskMemoryStore_1 = require("./taskMemoryStore");
(0, vitest_1.describe)('TaskMemoryStore', () => {
    let userDataDir = '';
    (0, vitest_1.beforeEach)(() => {
        userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-task-memory-user-data-'));
        process.env.V2_TEST_USER_DATA = userDataDir;
    });
    (0, vitest_1.afterEach)(() => {
        delete process.env.V2_TEST_USER_DATA;
        fs.rmSync(userDataDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)('keeps attachment summaries in task context even for image-only turns', () => {
        const store = new taskMemoryStore_1.TaskMemoryStore();
        store.recordUserPrompt('task-1', '', {
            attachmentSummary: '[Attached image: diagram.png]',
            attachments: [{
                    type: 'image',
                    mediaType: 'image/png',
                    data: 'ZmFrZQ==',
                    name: 'diagram.png',
                }],
        });
        const context = store.buildContext('task-1');
        const entry = store.get('task-1').entries[0];
        (0, vitest_1.expect)(context).toContain('User: [Attached image: diagram.png]');
        (0, vitest_1.expect)(entry.metadata?.attachments).toBeTruthy();
    });
    (0, vitest_1.it)('renders a compact current state before recent history', () => {
        const store = new taskMemoryStore_1.TaskMemoryStore();
        store.recordUserPrompt('task-2', 'Create a rollout plan.');
        store.recordInvocationResult({
            taskId: 'task-2',
            providerId: 'gpt-5.4',
            success: true,
            output: 'Draft plan: discovery, migration, rollout.',
            usage: { inputTokens: 1, outputTokens: 1, durationMs: 1 },
        });
        store.recordUserPrompt('task-2', 'Add rollback criteria.');
        const context = store.buildContext('task-2');
        (0, vitest_1.expect)(context).toContain('### Current State');
        (0, vitest_1.expect)(context).toContain('Latest user request: Add rollback criteria.');
        (0, vitest_1.expect)(context).toContain('Latest model result: Draft plan: discovery, migration, rollout.');
        (0, vitest_1.expect)(context).toContain('### Recent History');
        (0, vitest_1.expect)(context).toContain('User: Create a rollout plan.');
    });
});
//# sourceMappingURL=taskMemoryStore.test.js.map