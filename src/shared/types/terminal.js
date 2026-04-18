"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDefaultTerminalState = createDefaultTerminalState;
exports.createDefaultTerminalCommandState = createDefaultTerminalCommandState;
exports.createDefaultCommandState = createDefaultCommandState;
function createDefaultTerminalState() {
    return {
        session: null,
    };
}
function createDefaultTerminalCommandState() {
    return {
        dispatched: false,
        lastDispatchedCommand: null,
        lastUpdatedAt: 0,
    };
}
function createDefaultCommandState(cwd = '') {
    return {
        phase: 'idle',
        startedAt: null,
        lastExitCode: null,
        cwd,
        outputSinceCommandStart: '',
    };
}
//# sourceMappingURL=terminal.js.map