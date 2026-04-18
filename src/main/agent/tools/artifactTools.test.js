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
(0, vitest_1.describe)('artifact tool definitions', () => {
    let userDataDir = '';
    let workspaceDir = '';
    (0, vitest_1.beforeEach)(() => {
        userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-artifact-tools-user-data-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-artifact-tools-workspace-'));
        process.env.V2_TEST_USER_DATA = userDataDir;
        process.env.V2_WORKSPACE_ROOT = workspaceDir;
    });
    (0, vitest_1.afterEach)(() => {
        delete process.env.V2_TEST_USER_DATA;
        delete process.env.V2_WORKSPACE_ROOT;
        fs.rmSync(userDataDir, { recursive: true, force: true });
        fs.rmSync(workspaceDir, { recursive: true, force: true });
        vitest_1.vi.resetModules();
    });
    (0, vitest_1.it)('creates, reads, replaces, and appends managed artifacts through artifact tools', async () => {
        const { appStateStore } = await Promise.resolve().then(() => __importStar(require('../../state/appStateStore')));
        const { ActionType } = await Promise.resolve().then(() => __importStar(require('../../state/actions')));
        const { createArtifactToolDefinitions } = await Promise.resolve().then(() => __importStar(require('./artifactTools')));
        appStateStore.dispatch({
            type: ActionType.ADD_TASK,
            task: {
                id: 'task-artifact',
                title: 'Artifact task',
                status: 'queued',
                owner: 'user',
                artifactIds: [],
                createdAt: 1,
                updatedAt: 1,
            },
        });
        appStateStore.dispatch({ type: ActionType.SET_ACTIVE_TASK, taskId: 'task-artifact' });
        const tools = createArtifactToolDefinitions();
        const createTool = tools.find((tool) => tool.name === 'artifact.create');
        const deleteTool = tools.find((tool) => tool.name === 'artifact.delete');
        const listTool = tools.find((tool) => tool.name === 'artifact.list');
        const readTool = tools.find((tool) => tool.name === 'artifact.read');
        const replaceTool = tools.find((tool) => tool.name === 'artifact.replace_content');
        const appendTool = tools.find((tool) => tool.name === 'artifact.append_content');
        const context = {
            runId: 'run-1',
            agentId: 'gpt-5.4',
            mode: 'unrestricted-dev',
            taskId: 'task-artifact',
        };
        const created = await createTool.execute({
            title: 'Weekly Research Note',
            format: 'md',
        }, context);
        const artifact = created.data.artifact;
        (0, vitest_1.expect)(artifact.id).toBeTruthy();
        (0, vitest_1.expect)(artifact.linkedTaskIds).toContain('task-artifact');
        await replaceTool.execute({
            artifactId: artifact.id,
            content: '# Weekly Research Note',
        }, context);
        await appendTool.execute({
            artifactId: artifact.id,
            content: '\n\nNext steps',
        }, context);
        const read = await readTool.execute({ artifactId: artifact.id }, context);
        (0, vitest_1.expect)(read.data.content).toBe('# Weekly Research Note\n\nNext steps');
        const workingPath = path.join(workspaceDir, 'artifacts', artifact.id, 'weekly-research-note.md');
        (0, vitest_1.expect)(fs.readFileSync(workingPath, 'utf-8')).toBe('# Weekly Research Note\n\nNext steps');
        const listed = await listTool.execute({}, context);
        (0, vitest_1.expect)(Array.isArray(listed.data.artifacts)).toBe(true);
        (0, vitest_1.expect)(listed.data.artifacts.some((entry) => entry.id === artifact.id)).toBe(true);
        (0, vitest_1.expect)(appStateStore.getState().tasks.find((task) => task.id === 'task-artifact')?.artifactIds).toContain(artifact.id);
        const deleted = await deleteTool.execute({ artifactId: artifact.id }, context);
        (0, vitest_1.expect)(deleted.summary).toBe('Deleted Weekly Research Note');
        (0, vitest_1.expect)((await listTool.execute({}, context)).data.artifacts).toEqual([]);
    });
    (0, vitest_1.it)('uses the active artifact fallback and rejects html append', async () => {
        const { createArtifactToolDefinitions } = await Promise.resolve().then(() => __importStar(require('./artifactTools')));
        const tools = createArtifactToolDefinitions();
        const createTool = tools.find((tool) => tool.name === 'artifact.create');
        const readActiveTool = tools.find((tool) => tool.name === 'artifact.get_active');
        const replaceTool = tools.find((tool) => tool.name === 'artifact.replace_content');
        const appendTool = tools.find((tool) => tool.name === 'artifact.append_content');
        const context = {
            runId: 'run-2',
            agentId: 'gpt-5.4',
            mode: 'unrestricted-dev',
            taskId: undefined,
        };
        const created = await createTool.execute({
            title: 'Landing Page',
            format: 'html',
        }, context);
        const artifact = created.data.artifact;
        const active = await readActiveTool.execute({}, context);
        (0, vitest_1.expect)(active.data.artifact.id).toBe(artifact.id);
        await replaceTool.execute({ content: '<main>hello</main>' }, context);
        await (0, vitest_1.expect)(appendTool.execute({ content: '<footer>nope</footer>' }, context)).rejects.toThrow('Append is not supported for html artifacts.');
    });
});
//# sourceMappingURL=artifactTools.test.js.map