"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = __importDefault(require("http"));
const vitest_1 = require("vitest");
vitest_1.vi.mock('./AgentToolExecutor', () => ({
    agentToolExecutor: {
        list: vitest_1.vi.fn(),
        execute: vitest_1.vi.fn(),
    },
}));
vitest_1.vi.mock('../chatKnowledge/ChatKnowledgeStore', () => ({
    chatKnowledgeStore: {
        recordToolMessage: vitest_1.vi.fn(),
    },
}));
vitest_1.vi.mock('./ConstraintValidator', () => ({
    formatValidationForModel: vitest_1.vi.fn(() => ''),
}));
const V2ToolBridge_1 = require("./V2ToolBridge");
const AgentToolExecutor_1 = require("./AgentToolExecutor");
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
function httpPost(port, route, body) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const req = http_1.default.request({ hostname: '127.0.0.1', port, path: route, method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk.toString(); });
            res.on('end', () => { try {
                resolve(JSON.parse(data));
            }
            catch {
                reject(new Error('bad json'));
            } });
        });
        req.on('error', reject);
        req.end(payload);
    });
}
(0, vitest_1.describe)('V2ToolBridge', () => {
    let bridge;
    let contextPath;
    (0, vitest_1.beforeEach)(async () => {
        AgentToolExecutor_1.agentToolExecutor.list.mockReset();
        AgentToolExecutor_1.agentToolExecutor.execute.mockReset();
        contextPath = path_1.default.join(os_1.default.tmpdir(), `v2-ctx-test-${Date.now()}.json`);
        fs_1.default.writeFileSync(contextPath, JSON.stringify({
            runId: 'run-1', agentId: 'gpt-5.4', taskId: 'task-1', mode: 'unrestricted-dev',
            toolNames: ['filesystem.list'],
        }));
        bridge = new V2ToolBridge_1.V2ToolBridge(contextPath);
        await bridge.start();
    });
    (0, vitest_1.afterEach)(async () => {
        await bridge.stop();
        try {
            fs_1.default.unlinkSync(contextPath);
        }
        catch { /* ok */ }
    });
    (0, vitest_1.it)('tools/list returns tools with __ separators', async () => {
        AgentToolExecutor_1.agentToolExecutor.list.mockReturnValue([
            { name: 'filesystem.list', description: 'List files', inputSchema: { type: 'object', properties: {} } },
        ]);
        const result = await httpPost(bridge.getPort(), '/tools/list', {});
        (0, vitest_1.expect)(result.tools[0].name).toBe('filesystem__list');
    });
    (0, vitest_1.it)('tools/list filters tools to the runtime scope from context', async () => {
        AgentToolExecutor_1.agentToolExecutor.list.mockReturnValue([
            { name: 'filesystem.list', description: 'List files', inputSchema: { type: 'object', properties: {} } },
            { name: 'filesystem.read', description: 'Read files', inputSchema: { type: 'object', properties: {} } },
        ]);
        const result = await httpPost(bridge.getPort(), '/tools/list', {});
        (0, vitest_1.expect)(result.tools).toEqual([{ name: 'filesystem__list', description: 'List files', inputSchema: { type: 'object', properties: {} } }]);
    });
    (0, vitest_1.it)('tools/call translates __ name back and executes', async () => {
        AgentToolExecutor_1.agentToolExecutor.execute.mockResolvedValue({
            summary: 'listed', data: { entries: [] },
        });
        const result = await httpPost(bridge.getPort(), '/tools/call', {
            name: 'filesystem__list', arguments: { path: '/tmp' }, contextPath,
        });
        (0, vitest_1.expect)(AgentToolExecutor_1.agentToolExecutor.execute).toHaveBeenCalledWith('filesystem.list', { path: '/tmp' }, vitest_1.expect.objectContaining({ runId: 'run-1', taskId: 'task-1' }));
        (0, vitest_1.expect)(result.content[0].type).toBe('text');
    });
    (0, vitest_1.it)('tools/call rejects tool names that are outside the runtime scope', async () => {
        const result = await httpPost(bridge.getPort(), '/tools/call', {
            name: 'filesystem__read', arguments: { path: '/tmp/demo.txt' }, contextPath,
        });
        (0, vitest_1.expect)(AgentToolExecutor_1.agentToolExecutor.execute).not.toHaveBeenCalled();
        (0, vitest_1.expect)(result.content[0].text).toContain('Tool execution error: Tool is not available in this runtime scope: filesystem.read');
    });
    (0, vitest_1.it)('getPort() returns a non-zero port after start()', () => {
        (0, vitest_1.expect)(typeof bridge.getPort()).toBe('number');
        (0, vitest_1.expect)(bridge.getPort()).toBeGreaterThan(0);
    });
});
//# sourceMappingURL=V2ToolBridge.test.js.map