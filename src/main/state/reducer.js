"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.appReducer = appReducer;
const actions_1 = require("./actions");
function appReducer(state, action) {
    switch (action.type) {
        case actions_1.ActionType.SET_WINDOW_BOUNDS:
            return {
                ...state,
                windows: {
                    ...state.windows,
                    [action.role]: {
                        ...state.windows[action.role],
                        bounds: action.bounds,
                        displayId: action.displayId,
                    },
                },
            };
        case actions_1.ActionType.SET_WINDOW_FOCUSED: {
            const updated = { ...state.windows };
            for (const role of Object.keys(updated)) {
                updated[role] = { ...updated[role], isFocused: role === action.role && action.isFocused };
            }
            return { ...state, windows: updated };
        }
        case actions_1.ActionType.SET_WINDOW_VISIBLE:
            return {
                ...state,
                windows: {
                    ...state.windows,
                    [action.role]: { ...state.windows[action.role], isVisible: action.isVisible },
                },
            };
        case actions_1.ActionType.SET_EXECUTION_SPLIT:
            return { ...state, executionSplit: action.split };
        case actions_1.ActionType.ADD_TASK:
            return {
                ...state,
                tasks: [...state.tasks, action.task],
                activeTaskId: action.task.id,
            };
        case actions_1.ActionType.DELETE_TASK: {
            const tasks = state.tasks.filter((t) => t.id !== action.taskId);
            const activeTaskId = state.activeTaskId === action.taskId
                ? tasks.reduce((latestId, task) => {
                    if (!latestId)
                        return task.id;
                    const latestTask = tasks.find((entry) => entry.id === latestId);
                    return (latestTask?.updatedAt ?? 0) >= task.updatedAt ? latestId : task.id;
                }, null)
                : state.activeTaskId;
            return {
                ...state,
                tasks,
                activeTaskId,
                logs: state.logs.filter((log) => log.taskId !== action.taskId),
                surfaceActions: state.surfaceActions.filter((actionRecord) => actionRecord.taskId !== action.taskId),
            };
        }
        case actions_1.ActionType.UPDATE_TASK:
            return {
                ...state,
                tasks: state.tasks.map((t) => t.id === action.taskId ? { ...t, ...action.updates } : t),
            };
        case actions_1.ActionType.LINK_TASK_ARTIFACT:
            return {
                ...state,
                tasks: state.tasks.map((task) => {
                    if (task.id !== action.taskId)
                        return task;
                    if (task.artifactIds.includes(action.artifactId))
                        return task;
                    return {
                        ...task,
                        artifactIds: [...task.artifactIds, action.artifactId],
                        updatedAt: Date.now(),
                    };
                }),
            };
        case actions_1.ActionType.UNLINK_TASK_ARTIFACT:
            return {
                ...state,
                tasks: state.tasks.map((task) => {
                    if (task.id !== action.taskId)
                        return task;
                    if (!task.artifactIds.includes(action.artifactId))
                        return task;
                    return {
                        ...task,
                        artifactIds: task.artifactIds.filter((artifactId) => artifactId !== action.artifactId),
                        updatedAt: Date.now(),
                    };
                }),
            };
        case actions_1.ActionType.SET_ACTIVE_TASK:
            return { ...state, activeTaskId: action.taskId };
        case actions_1.ActionType.ADD_ARTIFACT:
            return {
                ...state,
                artifacts: [...state.artifacts, action.artifact],
                activeArtifactId: action.artifact.id,
            };
        case actions_1.ActionType.DELETE_ARTIFACT:
            return {
                ...state,
                artifacts: state.artifacts.filter((artifact) => artifact.id !== action.artifactId),
                activeArtifactId: state.activeArtifactId === action.artifactId ? null : state.activeArtifactId,
                tasks: state.tasks.map((task) => (task.artifactIds.includes(action.artifactId)
                    ? {
                        ...task,
                        artifactIds: task.artifactIds.filter((artifactId) => artifactId !== action.artifactId),
                        updatedAt: Date.now(),
                    }
                    : task)),
            };
        case actions_1.ActionType.UPDATE_ARTIFACT:
            return {
                ...state,
                artifacts: state.artifacts.map((artifact) => artifact.id === action.artifactId ? { ...artifact, ...action.patch } : artifact),
            };
        case actions_1.ActionType.SET_ACTIVE_ARTIFACT:
            return {
                ...state,
                activeArtifactId: action.artifactId,
            };
        case actions_1.ActionType.ADD_LOG: {
            const logs = [...state.logs, action.log];
            return { ...state, logs: logs.length > 500 ? logs.slice(-500) : logs };
        }
        case actions_1.ActionType.SET_SURFACE_STATUS:
            return { ...state, [action.surface]: action.status };
        case actions_1.ActionType.SET_TERMINAL_SESSION:
            return {
                ...state,
                terminalSession: { session: action.session },
            };
        case actions_1.ActionType.SET_TERMINAL_COMMAND:
            return {
                ...state,
                terminalCommand: action.command,
            };
        case actions_1.ActionType.SET_BROWSER_RUNTIME:
            return {
                ...state,
                browserRuntime: action.browserRuntime,
            };
        case actions_1.ActionType.ADD_SURFACE_ACTION: {
            const actions = [...state.surfaceActions, action.record];
            // Keep bounded to 200 most recent
            return { ...state, surfaceActions: actions.length > 200 ? actions.slice(-200) : actions };
        }
        case actions_1.ActionType.UPDATE_SURFACE_ACTION:
            return {
                ...state,
                surfaceActions: state.surfaceActions.map((a) => a.id === action.id ? { ...a, ...action.updates } : a),
            };
        case actions_1.ActionType.SET_PROVIDER_RUNTIME:
            return {
                ...state,
                providers: {
                    ...state.providers,
                    [action.providerId]: action.runtime,
                },
            };
        case actions_1.ActionType.ACCUMULATE_TOKEN_USAGE:
            return {
                ...state,
                tokenUsage: {
                    inputTokens: state.tokenUsage.inputTokens + action.inputTokens,
                    outputTokens: state.tokenUsage.outputTokens + action.outputTokens,
                },
            };
        case actions_1.ActionType.RESET_TOKEN_USAGE:
            return {
                ...state,
                tokenUsage: { inputTokens: 0, outputTokens: 0 },
            };
        case actions_1.ActionType.REPLACE_STATE:
            return action.state;
        default:
            return state;
    }
}
//# sourceMappingURL=reducer.js.map