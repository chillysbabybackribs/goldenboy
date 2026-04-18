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
const { readFileSyncMock } = vitest_1.vi.hoisted(() => ({
    readFileSyncMock: vitest_1.vi.fn(),
}));
const { spawnSyncMock } = vitest_1.vi.hoisted(() => ({
    spawnSyncMock: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('fs', async () => {
    const actual = await vitest_1.vi.importActual('fs');
    readFileSyncMock.mockImplementation(actual.readFileSync.bind(actual));
    return {
        ...actual,
        readFileSync: readFileSyncMock,
    };
});
vitest_1.vi.mock('child_process', async () => {
    const actual = await vitest_1.vi.importActual('child_process');
    spawnSyncMock.mockImplementation(actual.spawnSync.bind(actual));
    return {
        ...actual,
        spawnSync: spawnSyncMock,
    };
});
vitest_1.vi.mock('electron', () => ({
    app: {
        getPath: () => process.env.V2_TEST_USER_DATA || os.tmpdir(),
    },
}));
const FileKnowledgeStore_1 = require("./FileKnowledgeStore");
(0, vitest_1.describe)('FileKnowledgeStore', () => {
    let userDataDir = '';
    let workspaceDir = '';
    (0, vitest_1.beforeEach)(() => {
        userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-file-cache-user-data-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-file-cache-workspace-'));
        process.env.V2_TEST_USER_DATA = userDataDir;
    });
    (0, vitest_1.afterEach)(() => {
        delete process.env.V2_TEST_USER_DATA;
        fs.rmSync(userDataDir, { recursive: true, force: true });
        fs.rmSync(workspaceDir, { recursive: true, force: true });
        readFileSyncMock.mockClear();
        spawnSyncMock.mockClear();
    });
    (0, vitest_1.it)('reuses unchanged indexed files without rereading them', () => {
        const store = new FileKnowledgeStore_1.FileKnowledgeStore();
        const filePath = path.join(workspaceDir, 'example.ts');
        fs.writeFileSync(filePath, 'export const value = 1;\n', 'utf-8');
        const first = store.indexWorkspace(workspaceDir);
        (0, vitest_1.expect)(first.indexedFiles).toBe(1);
        readFileSyncMock.mockClear();
        const second = store.indexWorkspace(workspaceDir);
        (0, vitest_1.expect)(second.indexedFiles).toBe(1);
        (0, vitest_1.expect)(readFileSyncMock.mock.calls.filter(call => call[0] === filePath)).toHaveLength(0);
    });
    (0, vitest_1.it)('refreshes changed files and removes deleted ones', async () => {
        const store = new FileKnowledgeStore_1.FileKnowledgeStore();
        const filePath = path.join(workspaceDir, 'example.ts');
        fs.writeFileSync(filePath, 'export const value = 1;\n', 'utf-8');
        store.indexWorkspace(workspaceDir);
        await new Promise(resolve => setTimeout(resolve, 20));
        fs.writeFileSync(filePath, 'export const value = 2;\n', 'utf-8');
        const refreshed = store.refreshFile(filePath, workspaceDir);
        (0, vitest_1.expect)(refreshed?.reused).toBe(false);
        const chunk = refreshed?.chunks[0];
        (0, vitest_1.expect)(chunk).toBeTruthy();
        const readChunk = store.readChunk(chunk.id, 200);
        (0, vitest_1.expect)(readChunk?.text).toContain('value = 2');
        const searchResults = store.search('value', { pathPrefix: '' });
        (0, vitest_1.expect)(searchResults.some(result => result.path === filePath)).toBe(true);
        const window = store.readWindowForPath(filePath, { maxChars: 200 });
        (0, vitest_1.expect)(window?.content).toContain('value = 2');
        fs.rmSync(filePath, { force: true });
        (0, vitest_1.expect)(store.removeFile(filePath)).toBe(true);
        (0, vitest_1.expect)(store.getFreshChunksForPath(filePath)).toBeNull();
    });
    (0, vitest_1.it)('falls back to direct file scanning when rg hits E2BIG', () => {
        const store = new FileKnowledgeStore_1.FileKnowledgeStore();
        const filePath = path.join(workspaceDir, 'example.ts');
        fs.writeFileSync(filePath, 'export const value = 2;\n', 'utf-8');
        store.indexWorkspace(workspaceDir);
        spawnSyncMock.mockReturnValueOnce({
            pid: 0,
            output: [],
            stdout: '',
            stderr: '',
            status: null,
            signal: null,
            error: Object.assign(new Error('spawn E2BIG'), { code: 'E2BIG' }),
        });
        const results = store.search('value', { pathPrefix: '', limit: 5 });
        (0, vitest_1.expect)(results.some(result => result.path === filePath)).toBe(true);
    });
    (0, vitest_1.it)('removes cached descendants when deleting a directory tree path', () => {
        const store = new FileKnowledgeStore_1.FileKnowledgeStore();
        const nestedDir = path.join(workspaceDir, 'src');
        const nestedFile = path.join(nestedDir, 'example.ts');
        fs.mkdirSync(nestedDir, { recursive: true });
        fs.writeFileSync(nestedFile, 'export const value = 3;\n', 'utf-8');
        store.indexWorkspace(workspaceDir);
        (0, vitest_1.expect)(store.getFreshChunksForPath(nestedFile)).not.toBeNull();
        fs.rmSync(nestedDir, { recursive: true, force: true });
        (0, vitest_1.expect)(store.removePathTree(nestedDir)).toBe(1);
        (0, vitest_1.expect)(store.getFreshChunksForPath(nestedFile)).toBeNull();
    });
});
//# sourceMappingURL=FileKnowledgeStore.test.js.map