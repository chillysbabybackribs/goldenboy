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
exports.createAllWindows = createAllWindows;
exports.ensureWindow = ensureWindow;
exports.getWindowByRole = getWindowByRole;
exports.getRoleByWebContentsId = getRoleByWebContentsId;
exports.showAllWindows = showAllWindows;
exports.focusWindow = focusWindow;
exports.applyDefaultBounds = applyDefaultBounds;
exports.setAppQuitting = setAppQuitting;
exports.destroyAllWindows = destroyAllWindows;
const electron_1 = require("electron");
const path = __importStar(require("path"));
const windowRoles_1 = require("../../shared/types/windowRoles");
const appStateStore_1 = require("../state/appStateStore");
const actions_1 = require("../state/actions");
const eventBus_1 = require("../events/eventBus");
const events_1 = require("../../shared/types/events");
const layoutPresets_1 = require("./layoutPresets");
const ids_1 = require("../../shared/utils/ids");
const BrowserService_1 = require("../browser/BrowserService");
const windows = new Map();
const roleByWebContentsId = new Map();
const WINDOW_BACKGROUND_COLOR = '#000000';
const STARTUP_WINDOW_ROLES = ['command', 'execution'];
function getRendererPath(role) {
    return path.join(__dirname, '..', '..', '..', 'renderer', role, 'index.html');
}
function getPreloadPath() {
    return path.join(__dirname, '..', '..', '..', 'preload', 'preload', 'preload.js');
}
function validateBounds(bounds) {
    const displays = electron_1.screen.getAllDisplays();
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    const onScreen = displays.some((d) => {
        const wa = d.workArea;
        return centerX >= wa.x && centerX < wa.x + wa.width &&
            centerY >= wa.y && centerY < wa.y + wa.height;
    });
    if (onScreen)
        return bounds;
    const primary = electron_1.screen.getPrimaryDisplay();
    const wa = primary.workArea;
    return {
        x: wa.x + Math.floor((wa.width - bounds.width) / 2),
        y: wa.y + Math.floor((wa.height - bounds.height) / 2),
        width: Math.min(bounds.width, wa.width),
        height: Math.min(bounds.height, wa.height),
    };
}
function createRoleWindow(role, options) {
    const existing = windows.get(role);
    if (existing && !existing.isDestroyed()) {
        return existing;
    }
    const state = appStateStore_1.appStateStore.getState();
    const winState = state.windows[role];
    const bounds = validateBounds(winState.bounds);
    const showOnReady = options?.showOnReady ?? STARTUP_WINDOW_ROLES.includes(role);
    const titleMap = {
        command: 'V2 Workspace - Command Center',
        execution: 'V2 Workspace - Execution',
        document: 'V2 Workspace - Documents',
    };
    const win = new electron_1.BrowserWindow({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        minWidth: 600,
        minHeight: 400,
        title: titleMap[role],
        backgroundColor: WINDOW_BACKGROUND_COLOR,
        webPreferences: {
            preload: getPreloadPath(),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            nodeIntegrationInWorker: false,
            nodeIntegrationInSubFrames: false,
            allowRunningInsecureContent: false,
        },
        show: false,
    });
    windows.set(role, win);
    roleByWebContentsId.set(win.webContents.id, role);
    win.loadFile(getRendererPath(role));
    win.once('ready-to-show', () => {
        if (showOnReady) {
            win.show();
            appStateStore_1.appStateStore.dispatch({ type: actions_1.ActionType.SET_WINDOW_VISIBLE, role, isVisible: true });
        }
        // Initialize browser surface when execution window is ready
        if (role === 'execution' && !BrowserService_1.browserService.isCreated()) {
            BrowserService_1.browserService.createSurface(win);
        }
    });
    // Debounced bounds tracking
    let boundsTimer = null;
    const onBoundsChanged = () => {
        if (boundsTimer)
            clearTimeout(boundsTimer);
        boundsTimer = setTimeout(() => {
            if (win.isDestroyed())
                return;
            const b = win.getBounds();
            const display = electron_1.screen.getDisplayMatching(b);
            eventBus_1.eventBus.emit(events_1.AppEventType.WINDOW_BOUNDS_CHANGED, {
                role,
                bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
                displayId: display.id,
            });
            boundsTimer = null;
        }, 300);
    };
    win.on('move', onBoundsChanged);
    win.on('resize', onBoundsChanged);
    win.on('focus', () => {
        eventBus_1.eventBus.emit(events_1.AppEventType.WINDOW_FOCUSED, { role });
    });
    win.on('blur', () => {
        appStateStore_1.appStateStore.dispatch({ type: actions_1.ActionType.SET_WINDOW_FOCUSED, role, isFocused: false });
    });
    // Hide on close instead of destroying (unless app is quitting)
    win.on('close', (e) => {
        if (global.__appQuitting)
            return;
        e.preventDefault();
        win.hide();
        appStateStore_1.appStateStore.dispatch({ type: actions_1.ActionType.SET_WINDOW_VISIBLE, role, isVisible: false });
        appStateStore_1.appStateStore.dispatch({
            type: actions_1.ActionType.ADD_LOG,
            log: {
                id: (0, ids_1.generateId)('log'),
                timestamp: Date.now(),
                level: 'info',
                source: 'system',
                message: `${role} window hidden`,
            },
        });
    });
    return win;
}
function createAllWindows() {
    for (const role of STARTUP_WINDOW_ROLES) {
        createRoleWindow(role, { showOnReady: true });
    }
}
function ensureWindow(role, options) {
    return createRoleWindow(role, options);
}
function getWindowByRole(role) {
    const win = windows.get(role);
    return win && !win.isDestroyed() ? win : undefined;
}
function getRoleByWebContentsId(webContentsId) {
    return roleByWebContentsId.get(webContentsId);
}
function showAllWindows() {
    for (const role of STARTUP_WINDOW_ROLES) {
        const win = windows.get(role);
        if (!win)
            continue;
        if (!win.isDestroyed()) {
            win.show();
            appStateStore_1.appStateStore.dispatch({ type: actions_1.ActionType.SET_WINDOW_VISIBLE, role, isVisible: true });
        }
    }
}
function focusWindow(role, options) {
    const win = ensureWindow(role, { showOnReady: false });
    if (win && !win.isDestroyed()) {
        if (options?.fullScreen) {
            win.setFullScreen(true);
        }
        else if (win.isFullScreen()) {
            win.setFullScreen(false);
        }
        if (options?.maximize) {
            win.maximize();
        }
        win.show();
        win.focus();
        appStateStore_1.appStateStore.dispatch({ type: actions_1.ActionType.SET_WINDOW_VISIBLE, role, isVisible: true });
    }
}
function applyDefaultBounds() {
    const bounds = (0, layoutPresets_1.getDefaultWindowBounds)();
    for (const role of windowRoles_1.PHYSICAL_WINDOW_ROLES) {
        const win = windows.get(role);
        if (win && !win.isDestroyed()) {
            const b = bounds[role];
            win.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
        }
    }
}
function setAppQuitting() {
    global.__appQuitting = true;
}
function destroyAllWindows() {
    for (const [, win] of windows) {
        if (!win.isDestroyed()) {
            win.destroy();
        }
    }
    windows.clear();
    roleByWebContentsId.clear();
}
//# sourceMappingURL=windowManager.js.map