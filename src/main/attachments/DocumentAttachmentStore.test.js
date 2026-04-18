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
(0, vitest_1.describe)('DocumentAttachmentStore', () => {
    let userDataDir = '';
    let workspaceDir = '';
    (0, vitest_1.beforeEach)(() => {
        userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-document-attachments-user-data-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-document-attachments-workspace-'));
        process.env.V2_TEST_USER_DATA = userDataDir;
    });
    (0, vitest_1.afterEach)(() => {
        delete process.env.V2_TEST_USER_DATA;
        fs.rmSync(userDataDir, { recursive: true, force: true });
        fs.rmSync(workspaceDir, { recursive: true, force: true });
        vitest_1.vi.resetModules();
    });
    (0, vitest_1.it)('imports, indexes, searches, and clears task documents', async () => {
        const sourcePath = path.join(workspaceDir, 'notes.md');
        fs.writeFileSync(sourcePath, [
            '# Incident Notes',
            '',
            'The websocket reconnect bug happens after idle sleep.',
            'We should add retry backoff and connection state logging.',
            '',
            'Final action item: patch the reconnect guard.',
        ].join('\n'), 'utf-8');
        const { DocumentAttachmentStore } = await Promise.resolve().then(() => __importStar(require('./DocumentAttachmentStore')));
        const store = new DocumentAttachmentStore();
        const imported = await store.importDocuments('task-1', [
            {
                path: sourcePath,
                name: 'notes.md',
                mediaType: 'text/markdown',
            },
        ]);
        (0, vitest_1.expect)(imported).toHaveLength(1);
        (0, vitest_1.expect)(imported[0].status).toBe('indexed');
        (0, vitest_1.expect)(imported[0].chunkCount).toBeGreaterThan(0);
        const deduped = await store.importDocuments('task-1', [
            {
                path: sourcePath,
                name: 'notes.md',
                mediaType: 'text/markdown',
            },
        ]);
        (0, vitest_1.expect)(deduped).toHaveLength(1);
        (0, vitest_1.expect)(deduped[0].id).toBe(imported[0].id);
        (0, vitest_1.expect)(store.listTaskDocuments('task-1')).toHaveLength(1);
        const results = store.search('task-1', 'reconnect guard');
        (0, vitest_1.expect)(results.length).toBeGreaterThan(0);
        const chunk = store.readChunk('task-1', results[0].chunkId, 500);
        (0, vitest_1.expect)(chunk).toBeTruthy();
        (0, vitest_1.expect)(chunk?.text).toContain('reconnect');
        const document = store.readDocument('task-1', imported[0].id, 2000);
        (0, vitest_1.expect)(document).toBeTruthy();
        (0, vitest_1.expect)(document?.content).toContain('websocket reconnect bug');
        const statsBeforeClear = store.getStats('task-1');
        (0, vitest_1.expect)(statsBeforeClear.documentCount).toBe(1);
        (0, vitest_1.expect)(statsBeforeClear.indexedDocumentCount).toBe(1);
        store.clearTask('task-1');
        (0, vitest_1.expect)(store.listTaskDocuments('task-1')).toEqual([]);
        (0, vitest_1.expect)(store.search('task-1', 'reconnect')).toEqual([]);
        (0, vitest_1.expect)(store.getStats('task-1').documentCount).toBe(0);
    });
    (0, vitest_1.it)('stores unsupported binary-like documents without indexing them', async () => {
        const sourcePath = path.join(workspaceDir, 'report.pdf');
        fs.writeFileSync(sourcePath, Buffer.from('%PDF-1.4 fake pdf payload', 'utf-8'));
        const { DocumentAttachmentStore } = await Promise.resolve().then(() => __importStar(require('./DocumentAttachmentStore')));
        const store = new DocumentAttachmentStore();
        const imported = await store.importDocuments('task-2', [
            {
                path: sourcePath,
                name: 'report.pdf',
                mediaType: 'application/pdf',
            },
        ]);
        (0, vitest_1.expect)(imported).toHaveLength(1);
        (0, vitest_1.expect)(imported[0].status).toBe('unsupported');
        (0, vitest_1.expect)(imported[0].chunkCount).toBe(0);
        (0, vitest_1.expect)(imported[0].statusDetail).toContain('No extractor is available yet');
        (0, vitest_1.expect)(store.search('task-2', 'pdf')).toEqual([]);
    });
});
//# sourceMappingURL=DocumentAttachmentStore.test.js.map