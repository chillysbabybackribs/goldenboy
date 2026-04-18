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
exports.artifactService = exports.ArtifactService = void 0;
const fs = __importStar(require("fs"));
const crypto = __importStar(require("crypto"));
const path = __importStar(require("path"));
const appStateStore_1 = require("../state/appStateStore");
const actions_1 = require("../state/actions");
const runtimeLedgerStore_1 = require("../models/runtimeLedgerStore");
const storage_1 = require("./storage");
function cloneArtifact(record) {
    return {
        ...record,
        linkedTaskIds: [...record.linkedTaskIds],
    };
}
function findTask(taskId) {
    return appStateStore_1.appStateStore.getState().tasks.some((task) => task.id === taskId);
}
function assertTaskExists(taskId) {
    if (!findTask(taskId)) {
        throw new Error(`Task not found: ${taskId}`);
    }
}
function normalizeCsvRows(content) {
    return content
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/^\n+/, '')
        .replace(/\n+$/, '');
}
class ArtifactService {
    constructor() {
        (0, storage_1.ensureArtifactsRoot)();
    }
    createArtifact(input) {
        const title = input.title.trim();
        if (!title) {
            throw new Error('Artifact title is required');
        }
        if (input.taskId) {
            assertTaskExists(input.taskId);
        }
        const artifactId = crypto.randomUUID();
        const now = Date.now();
        const linkedTaskIds = input.taskId ? [input.taskId] : [];
        const workingPath = (0, storage_1.ensureArtifactWorkingFile)({
            artifactId,
            title,
            format: input.format,
        });
        const record = {
            id: artifactId,
            title,
            format: input.format,
            workingPath: path.resolve(workingPath),
            sourcePath: input.sourcePath ? path.resolve(input.sourcePath) : undefined,
            createdBy: input.createdBy,
            lastUpdatedBy: input.createdBy,
            createdAt: now,
            updatedAt: now,
            status: 'created',
            linkedTaskIds,
            previewable: true,
            exportable: true,
            archived: false,
        };
        appStateStore_1.appStateStore.dispatch({ type: actions_1.ActionType.ADD_ARTIFACT, artifact: record });
        if (input.taskId) {
            appStateStore_1.appStateStore.dispatch({ type: actions_1.ActionType.LINK_TASK_ARTIFACT, taskId: input.taskId, artifactId });
        }
        appStateStore_1.appStateStore.dispatch({ type: actions_1.ActionType.SET_ACTIVE_ARTIFACT, artifactId });
        runtimeLedgerStore_1.runtimeLedgerStore.recordArtifactEvent({
            taskId: input.taskId ?? null,
            summary: `Created artifact ${title} (${input.format})`,
            metadata: { artifactId, action: 'create', format: input.format },
        });
        return cloneArtifact(record);
    }
    getArtifact(id) {
        const record = appStateStore_1.appStateStore.getState().artifacts.find((artifact) => artifact.id === id);
        return record ? cloneArtifact(record) : null;
    }
    listArtifacts() {
        return appStateStore_1.appStateStore.getState().artifacts
            .slice()
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map(cloneArtifact);
    }
    updateArtifactMetadata(id, patch) {
        const existing = this.getArtifact(id);
        if (!existing) {
            throw new Error(`Artifact not found: ${id}`);
        }
        const nextPatch = { ...patch };
        if (typeof nextPatch.title === 'string') {
            const trimmed = nextPatch.title.trim();
            if (!trimmed)
                throw new Error('Artifact title cannot be empty');
            nextPatch.title = trimmed;
        }
        if (typeof nextPatch.sourcePath === 'string' && nextPatch.sourcePath.trim()) {
            nextPatch.sourcePath = path.resolve(nextPatch.sourcePath);
        }
        if (nextPatch.archived === true) {
            nextPatch.status = 'archived';
        }
        appStateStore_1.appStateStore.dispatch({
            type: actions_1.ActionType.UPDATE_ARTIFACT,
            artifactId: id,
            patch: {
                ...nextPatch,
                updatedAt: Date.now(),
            },
        });
        runtimeLedgerStore_1.runtimeLedgerStore.recordArtifactEvent({
            taskId: existing.linkedTaskIds[0] ?? null,
            summary: `Updated artifact metadata for ${nextPatch.title || existing.title}`,
            metadata: { artifactId: id, action: 'metadata-update' },
        });
        return this.getArtifact(id);
    }
    linkArtifactToTask(artifactId, taskId) {
        const artifact = this.getArtifact(artifactId);
        if (!artifact) {
            throw new Error(`Artifact not found: ${artifactId}`);
        }
        assertTaskExists(taskId);
        if (artifact.linkedTaskIds.includes(taskId)) {
            return artifact;
        }
        appStateStore_1.appStateStore.dispatch({
            type: actions_1.ActionType.UPDATE_ARTIFACT,
            artifactId,
            patch: {
                linkedTaskIds: [...artifact.linkedTaskIds, taskId],
                updatedAt: Date.now(),
            },
        });
        appStateStore_1.appStateStore.dispatch({ type: actions_1.ActionType.LINK_TASK_ARTIFACT, taskId, artifactId });
        runtimeLedgerStore_1.runtimeLedgerStore.recordArtifactEvent({
            taskId,
            summary: `Linked artifact ${artifact.title} to task ${taskId}`,
            metadata: { artifactId, action: 'link-task' },
        });
        return this.getArtifact(artifactId);
    }
    setActiveArtifact(artifactId) {
        if (artifactId !== null && !this.getArtifact(artifactId)) {
            throw new Error(`Artifact not found: ${artifactId}`);
        }
        appStateStore_1.appStateStore.dispatch({ type: actions_1.ActionType.SET_ACTIVE_ARTIFACT, artifactId });
        const active = artifactId ? this.getArtifact(artifactId) : null;
        runtimeLedgerStore_1.runtimeLedgerStore.recordArtifactEvent({
            taskId: active?.linkedTaskIds[0] ?? null,
            summary: active ? `Activated artifact ${active.title}` : 'Cleared active artifact',
            metadata: { artifactId, action: 'set-active' },
        });
        return this.getActiveArtifact();
    }
    getActiveArtifact() {
        const activeArtifactId = appStateStore_1.appStateStore.getState().activeArtifactId;
        return activeArtifactId ? this.getArtifact(activeArtifactId) : null;
    }
    deleteArtifact(artifactId, _deletedBy) {
        const artifact = this.getArtifact(artifactId);
        if (!artifact) {
            throw new Error(`Artifact not found: ${artifactId}`);
        }
        const artifactDirectory = (0, storage_1.getArtifactDirectory)(artifact.id);
        if (!(0, storage_1.isPathInArtifactDirectory)(artifact.id, artifact.workingPath)) {
            throw new Error(`Artifact working path escapes managed storage: ${artifact.workingPath}`);
        }
        if (fs.existsSync(artifactDirectory)) {
            fs.rmSync(artifactDirectory, { recursive: true, force: true });
        }
        appStateStore_1.appStateStore.dispatch({ type: actions_1.ActionType.DELETE_ARTIFACT, artifactId: artifact.id });
        runtimeLedgerStore_1.runtimeLedgerStore.recordArtifactEvent({
            taskId: artifact.linkedTaskIds[0] ?? null,
            summary: `Deleted artifact ${artifact.title}`,
            metadata: { artifactId: artifact.id, action: 'delete' },
        });
        const remainingArtifacts = this.listArtifacts().filter((entry) => entry.id !== artifact.id);
        const nextActiveArtifact = remainingArtifacts[0] ?? null;
        appStateStore_1.appStateStore.dispatch({ type: actions_1.ActionType.SET_ACTIVE_ARTIFACT, artifactId: nextActiveArtifact?.id ?? null });
        return {
            deletedArtifactId: artifact.id,
            nextActiveArtifact,
        };
    }
    readContent(artifactId) {
        const artifact = this.getArtifact(artifactId);
        if (!artifact) {
            throw new Error(`Artifact not found: ${artifactId}`);
        }
        if (!(0, storage_1.isPathInArtifactDirectory)(artifact.id, artifact.workingPath)) {
            throw new Error(`Artifact working path escapes managed storage: ${artifact.workingPath}`);
        }
        const content = fs.existsSync(artifact.workingPath)
            ? fs.readFileSync(artifact.workingPath, 'utf-8')
            : '';
        return { artifact, content };
    }
    readActiveArtifactContent() {
        const active = this.getActiveArtifact();
        if (!active)
            throw new Error('No active artifact is selected.');
        return this.readContent(active.id);
    }
    replaceContent(artifactId, content, updatedBy) {
        if (typeof content !== 'string') {
            throw new Error('Artifact content must be a string');
        }
        const artifact = this.requireWritableArtifact(artifactId);
        const actor = this.resolveUpdatedBy(updatedBy);
        this.beginWrite(artifact.id, actor);
        try {
            fs.writeFileSync(artifact.workingPath, content, 'utf-8');
            this.finishWrite(artifact.id, actor);
            this.linkArtifactIfTaskActor(artifact.id, actor);
            runtimeLedgerStore_1.runtimeLedgerStore.recordArtifactEvent({
                taskId: this.getArtifact(artifact.id)?.linkedTaskIds[0] ?? null,
                summary: `Replaced content for artifact ${artifact.title}`,
                metadata: { artifactId: artifact.id, action: 'replace-content', actor },
            });
            return this.getArtifact(artifact.id);
        }
        catch (error) {
            this.failWrite(artifact.id, actor);
            throw error;
        }
    }
    appendContent(artifactId, content, updatedBy) {
        if (typeof content !== 'string') {
            throw new Error('Artifact content must be a string');
        }
        const artifact = this.requireWritableArtifact(artifactId);
        const actor = this.resolveUpdatedBy(updatedBy);
        if (artifact.format === 'html') {
            throw new Error('Append is not supported for html artifacts.');
        }
        if (artifact.format !== 'md' && artifact.format !== 'txt' && artifact.format !== 'csv') {
            throw new Error(`Append is not supported for ${artifact.format} artifacts.`);
        }
        this.beginWrite(artifact.id, actor);
        try {
            if (artifact.format === 'csv') {
                const rows = normalizeCsvRows(content);
                const existing = fs.existsSync(artifact.workingPath)
                    ? fs.readFileSync(artifact.workingPath, 'utf-8')
                    : '';
                const prefix = existing.length > 0 && rows.length > 0 && !existing.endsWith('\n') ? '\n' : '';
                fs.appendFileSync(artifact.workingPath, `${prefix}${rows}`, 'utf-8');
            }
            else {
                fs.appendFileSync(artifact.workingPath, content, 'utf-8');
            }
            this.finishWrite(artifact.id, actor);
            this.linkArtifactIfTaskActor(artifact.id, actor);
            runtimeLedgerStore_1.runtimeLedgerStore.recordArtifactEvent({
                taskId: this.getArtifact(artifact.id)?.linkedTaskIds[0] ?? null,
                summary: `Appended content to artifact ${artifact.title}`,
                metadata: { artifactId: artifact.id, action: 'append-content', actor },
            });
            return this.getArtifact(artifact.id);
        }
        catch (error) {
            this.failWrite(artifact.id, actor);
            throw error;
        }
    }
    replaceActiveArtifactContent(content, updatedBy) {
        const active = this.getActiveArtifact();
        if (!active)
            throw new Error('No active artifact is selected.');
        return this.replaceContent(active.id, content, updatedBy);
    }
    appendActiveArtifactContent(content, updatedBy) {
        const active = this.getActiveArtifact();
        if (!active)
            throw new Error('No active artifact is selected.');
        return this.appendContent(active.id, content, updatedBy);
    }
    requireWritableArtifact(artifactId) {
        const artifact = this.getArtifact(artifactId);
        if (!artifact) {
            throw new Error(`Artifact not found: ${artifactId}`);
        }
        if (artifact.archived || artifact.status === 'archived') {
            throw new Error(`Artifact is archived: ${artifactId}`);
        }
        if (!(0, storage_1.isPathInArtifactDirectory)(artifact.id, artifact.workingPath)) {
            throw new Error(`Artifact working path escapes managed storage: ${artifact.workingPath}`);
        }
        return artifact;
    }
    resolveUpdatedBy(updatedBy) {
        if (typeof updatedBy === 'string' && updatedBy.trim()) {
            return updatedBy.trim();
        }
        return appStateStore_1.appStateStore.getState().activeTaskId || 'system';
    }
    beginWrite(artifactId, actor) {
        appStateStore_1.appStateStore.dispatch({
            type: actions_1.ActionType.UPDATE_ARTIFACT,
            artifactId,
            patch: {
                status: 'updating',
                lastUpdatedBy: actor,
                updatedAt: Date.now(),
            },
        });
    }
    finishWrite(artifactId, actor) {
        appStateStore_1.appStateStore.dispatch({
            type: actions_1.ActionType.UPDATE_ARTIFACT,
            artifactId,
            patch: {
                status: 'active',
                lastUpdatedBy: actor,
                updatedAt: Date.now(),
            },
        });
    }
    failWrite(artifactId, actor) {
        appStateStore_1.appStateStore.dispatch({
            type: actions_1.ActionType.UPDATE_ARTIFACT,
            artifactId,
            patch: {
                status: 'failed',
                lastUpdatedBy: actor,
                updatedAt: Date.now(),
            },
        });
    }
    linkArtifactIfTaskActor(artifactId, actor) {
        if (actor !== 'user' && actor !== 'system' && findTask(actor)) {
            this.linkArtifactToTask(artifactId, actor);
        }
    }
}
exports.ArtifactService = ArtifactService;
exports.artifactService = new ArtifactService();
//# sourceMappingURL=ArtifactService.js.map