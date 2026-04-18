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
exports.loadPersistedState = loadPersistedState;
exports.savePersistedState = savePersistedState;
exports.buildInitialState = buildInitialState;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const electron_1 = require("electron");
const appState_1 = require("../../shared/types/appState");
const artifacts_1 = require("../../shared/types/artifacts");
const windowRoles_1 = require("../../shared/types/windowRoles");
const model_1 = require("../../shared/types/model");
const STATE_FILE = 'workspace-state.json';
function getStatePath() {
    return path.join(electron_1.app.getPath('userData'), STATE_FILE);
}
function loadPersistedState() {
    try {
        const filePath = getStatePath();
        if (!fs.existsSync(filePath))
            return {};
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        // Migration: if the persisted state has old 3-window roles (browser/terminal/command)
        // but not the new 2-window roles (command/execution), migrate cleanly
        if (parsed.windows) {
            const hasOldRoles = 'browser' in parsed.windows || 'terminal' in parsed.windows;
            const hasNewRoles = 'execution' in parsed.windows;
            if (hasOldRoles && !hasNewRoles) {
                // Old format — discard window positions, keep split state if any
                return {
                    executionSplit: parsed.executionSplit ?? undefined,
                };
            }
        }
        // Validate the persisted split state
        if (parsed.executionSplit) {
            const ratio = parsed.executionSplit.ratio;
            if (typeof ratio !== 'number' || ratio < 0.1 || ratio > 0.9) {
                parsed.executionSplit.ratio = 0.5;
            }
            const validPresets = ['balanced', 'focus-browser', 'focus-terminal'];
            if (!validPresets.includes(parsed.executionSplit.preset)) {
                parsed.executionSplit.preset = 'balanced';
            }
        }
        return parsed;
    }
    catch {
        return {};
    }
}
function savePersistedState(state) {
    try {
        const persisted = {
            executionSplit: state.executionSplit,
            windows: state.windows,
            tasks: state.tasks.map(t => ({
                id: t.id,
                title: t.title,
                status: t.status,
                owner: t.owner,
                artifactIds: t.artifactIds,
                createdAt: t.createdAt,
                updatedAt: t.updatedAt,
            })),
            activeTaskId: state.activeTaskId,
            artifacts: state.artifacts,
            activeArtifactId: state.activeArtifactId,
            tokenUsage: state.tokenUsage,
        };
        const filePath = getStatePath();
        fs.writeFileSync(filePath, JSON.stringify(persisted, null, 2), 'utf-8');
    }
    catch (err) {
        console.error('Failed to persist state:', err);
    }
}
function normalizePersistedTaskOwner(owner) {
    if (owner === 'user')
        return 'user';
    if ((0, model_1.isProviderId)(owner))
        return owner;
    return 'user';
}
function normalizePersistedArtifacts(records) {
    if (!Array.isArray(records))
        return [];
    return records.filter((record) => {
        return Boolean(record
            && typeof record.id === 'string'
            && typeof record.title === 'string'
            && typeof record.workingPath === 'string'
            && typeof record.createdBy === 'string'
            && typeof record.lastUpdatedBy === 'string'
            && typeof record.createdAt === 'number'
            && typeof record.updatedAt === 'number'
            && typeof record.previewable === 'boolean'
            && typeof record.exportable === 'boolean'
            && typeof record.archived === 'boolean'
            && Array.isArray(record.linkedTaskIds)
            && (0, artifacts_1.isArtifactFormat)(record.format)
            && (0, artifacts_1.isArtifactStatus)(record.status));
    });
}
function buildInitialState() {
    const defaults = (0, appState_1.createDefaultAppState)();
    const persisted = loadPersistedState();
    // Merge only valid window roles
    let windows = defaults.windows;
    if (persisted.windows) {
        const merged = { ...defaults.windows };
        for (const role of windowRoles_1.PHYSICAL_WINDOW_ROLES) {
            if (persisted.windows[role]) {
                merged[role] = { ...defaults.windows[role], ...persisted.windows[role] };
            }
        }
        windows = merged;
    }
    // Restore persisted tasks
    let tasks = defaults.tasks;
    let activeTaskId = defaults.activeTaskId;
    if (persisted.tasks && Array.isArray(persisted.tasks)) {
        tasks = persisted.tasks
            .filter(t => t && t.id && t.title)
            .map(t => ({
            id: t.id,
            title: t.title,
            status: (t.status === 'running' ? 'completed' : t.status),
            owner: normalizePersistedTaskOwner(t.owner),
            artifactIds: Array.isArray(t.artifactIds) ? t.artifactIds.filter((artifactId) => typeof artifactId === 'string') : [],
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
        }));
        // Restore active task only if it still exists
        if (persisted.activeTaskId && tasks.some(t => t.id === persisted.activeTaskId)) {
            activeTaskId = persisted.activeTaskId;
        }
    }
    // Restore persisted token usage
    const tokenUsage = (persisted.tokenUsage &&
        typeof persisted.tokenUsage.inputTokens === 'number' &&
        typeof persisted.tokenUsage.outputTokens === 'number')
        ? persisted.tokenUsage
        : defaults.tokenUsage;
    const artifacts = normalizePersistedArtifacts(persisted.artifacts);
    const activeArtifactId = persisted.activeArtifactId && artifacts.some((artifact) => artifact.id === persisted.activeArtifactId)
        ? persisted.activeArtifactId
        : defaults.activeArtifactId;
    return {
        ...defaults,
        executionSplit: persisted.executionSplit ?? defaults.executionSplit,
        windows,
        tasks,
        activeTaskId,
        artifacts,
        activeArtifactId,
        tokenUsage,
    };
}
//# sourceMappingURL=persistence.js.map