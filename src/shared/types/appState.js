"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDefaultWindowState = createDefaultWindowState;
exports.createDefaultAppState = createDefaultAppState;
exports.presetToRatio = presetToRatio;
const terminal_1 = require("./terminal");
const browser_1 = require("./browser");
const model_1 = require("./model");
function createDefaultWindowState(role) {
    return {
        role,
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        isVisible: false,
        isFocused: false,
        displayId: 0,
    };
}
function createDefaultAppState() {
    return {
        windows: {
            command: createDefaultWindowState('command'),
            execution: createDefaultWindowState('execution'),
            document: createDefaultWindowState('document'),
        },
        executionSplit: { preset: 'balanced', ratio: 0.5 },
        tasks: [],
        activeTaskId: null,
        artifacts: [],
        activeArtifactId: null,
        logs: [],
        browser: { status: 'idle', lastUpdatedAt: null, detail: '' },
        terminal: { status: 'idle', lastUpdatedAt: null, detail: '' },
        terminalSession: (0, terminal_1.createDefaultTerminalState)(),
        terminalCommand: (0, terminal_1.createDefaultTerminalCommandState)(),
        browserRuntime: (0, browser_1.createDefaultBrowserState)(),
        surfaceActions: [],
        providers: {
            [model_1.PRIMARY_PROVIDER_ID]: (0, model_1.createDefaultProviderRuntime)(model_1.PRIMARY_PROVIDER_ID),
            [model_1.HAIKU_PROVIDER_ID]: (0, model_1.createDefaultProviderRuntime)(model_1.HAIKU_PROVIDER_ID),
        },
        tokenUsage: { inputTokens: 0, outputTokens: 0 },
    };
}
// Map preset to default ratio
function presetToRatio(preset) {
    switch (preset) {
        case 'balanced': return 0.5;
        case 'focus-browser': return 0.7;
        case 'focus-terminal': return 0.3;
    }
}
//# sourceMappingURL=appState.js.map