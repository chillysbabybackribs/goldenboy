"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const registerIpc_1 = require("./ipc/registerIpc");
const eventRouter_1 = require("./events/eventRouter");
const windowManager_1 = require("./windows/windowManager");
const appStateStore_1 = require("./state/appStateStore");
const TerminalService_1 = require("./terminal/TerminalService");
const BrowserService_1 = require("./browser/BrowserService");
const AgentModelService_1 = require("./agent/AgentModelService");
const disableGpu = process.env.V2_DISABLE_HARDWARE_ACCELERATION === '1';
if (disableGpu) {
    process.env.ELECTRON_DISABLE_GPU = '1';
    electron_1.app.disableHardwareAcceleration();
    electron_1.app.commandLine.appendSwitch('disable-gpu');
    electron_1.app.commandLine.appendSwitch('disable-gpu-compositing');
    electron_1.app.commandLine.appendSwitch('disable-gpu-sandbox');
}
const gotLock = electron_1.app.requestSingleInstanceLock();
if (!gotLock) {
    electron_1.app.quit();
}
else {
    electron_1.app.on('second-instance', () => {
        (0, windowManager_1.showAllWindows)();
    });
}
electron_1.app.on('ready', () => {
    electron_1.app.on('web-contents-created', (_event, webContents) => {
        webContents.on('will-attach-webview', (event, webPreferences, params) => {
            webPreferences.preload = '';
            webPreferences.nodeIntegration = false;
            webPreferences.contextIsolation = true;
            webPreferences.sandbox = true;
            webPreferences.webSecurity = true;
            if (params?.src && params.src.startsWith('file://')) {
                event.preventDefault();
            }
        });
    });
    TerminalService_1.terminalService.init();
    AgentModelService_1.agentModelService.init();
    (0, registerIpc_1.registerIpc)();
    (0, eventRouter_1.initEventRouter)();
    (0, windowManager_1.createAllWindows)();
    (0, windowManager_1.applyDefaultBounds)();
});
electron_1.app.on('before-quit', () => {
    (0, windowManager_1.setAppQuitting)();
    TerminalService_1.terminalService.setAppQuitting();
    TerminalService_1.terminalService.persistNow();
    BrowserService_1.browserService.dispose();
    TerminalService_1.terminalService.dispose();
    appStateStore_1.appStateStore.persistNow();
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
electron_1.app.on('activate', () => {
    if (electron_1.BrowserWindow.getAllWindows().length === 0) {
        (0, windowManager_1.createAllWindows)();
        (0, windowManager_1.applyDefaultBounds)();
    }
    else {
        (0, windowManager_1.showAllWindows)();
    }
});
//# sourceMappingURL=main.js.map