"use strict";
// ═══════════════════════════════════════════════════════════════════════════
// Browser Session Store — Persistent browser data across sessions
// History, bookmarks, settings, and tab state
// ═══════════════════════════════════════════════════════════════════════════
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
exports.loadBrowserHistory = loadBrowserHistory;
exports.loadLastUrls = loadLastUrls;
exports.loadActiveTabIndex = loadActiveTabIndex;
exports.saveBrowserHistory = saveBrowserHistory;
exports.loadBookmarks = loadBookmarks;
exports.saveBookmarks = saveBookmarks;
exports.loadSettings = loadSettings;
exports.saveSettings = saveSettings;
exports.flushAll = flushAll;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const electron_1 = require("electron");
const browser_1 = require("../../shared/types/browser");
const DATA_FILE = 'browser-data.json';
const MAX_HISTORY_ENTRIES = 2000;
function getDataPath() {
    return path.join(electron_1.app.getPath('userData'), DATA_FILE);
}
function loadData() {
    try {
        const filePath = getDataPath();
        if (!fs.existsSync(filePath)) {
            // Check for legacy file and migrate
            const legacyPath = path.join(electron_1.app.getPath('userData'), 'browser-history.json');
            if (fs.existsSync(legacyPath)) {
                const raw = fs.readFileSync(legacyPath, 'utf-8');
                const legacy = JSON.parse(raw);
                const migrated = {
                    history: Array.isArray(legacy.history) ? legacy.history : [],
                    bookmarks: [],
                    settings: (0, browser_1.createDefaultSettings)(),
                    lastUrls: legacy.lastUrl ? [legacy.lastUrl] : [],
                    activeTabIndex: 0,
                };
                // Add favicon field to old entries
                migrated.history = migrated.history.map(h => ({ ...h, favicon: h.favicon || '' }));
                saveData(migrated);
                return migrated;
            }
            return { history: [], bookmarks: [], settings: (0, browser_1.createDefaultSettings)(), lastUrls: [], activeTabIndex: 0 };
        }
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
            history: Array.isArray(parsed.history) ? parsed.history.slice(-MAX_HISTORY_ENTRIES) : [],
            bookmarks: Array.isArray(parsed.bookmarks) ? parsed.bookmarks : [],
            settings: parsed.settings ? { ...(0, browser_1.createDefaultSettings)(), ...parsed.settings } : (0, browser_1.createDefaultSettings)(),
            lastUrls: Array.isArray(parsed.lastUrls) ? parsed.lastUrls : [],
            activeTabIndex: typeof parsed.activeTabIndex === 'number' ? parsed.activeTabIndex : 0,
        };
    }
    catch {
        return { history: [], bookmarks: [], settings: (0, browser_1.createDefaultSettings)(), lastUrls: [], activeTabIndex: 0 };
    }
}
function saveData(data) {
    try {
        const filePath = getDataPath();
        data.history = data.history.slice(-MAX_HISTORY_ENTRIES);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    }
    catch (err) {
        console.error('Failed to persist browser data:', err);
    }
}
// Cached in memory, written to disk on save
let cached = null;
function getData() {
    if (!cached)
        cached = loadData();
    return cached;
}
// ─── History ────────────────────────────────────────────────────────────────
function loadBrowserHistory() {
    return [...getData().history];
}
function loadLastUrls() {
    return [...getData().lastUrls];
}
function loadActiveTabIndex() {
    return getData().activeTabIndex;
}
function saveBrowserHistory(history, lastUrls, activeTabIndex) {
    const data = getData();
    data.history = history;
    data.lastUrls = lastUrls;
    data.activeTabIndex = activeTabIndex;
    cached = data;
    saveData(data);
}
// ─── Bookmarks ──────────────────────────────────────────────────────────────
function loadBookmarks() {
    return [...getData().bookmarks];
}
function saveBookmarks(bookmarks) {
    const data = getData();
    data.bookmarks = bookmarks;
    cached = data;
    saveData(data);
}
// ─── Settings ───────────────────────────────────────────────────────────────
function loadSettings() {
    return { ...getData().settings };
}
function saveSettings(settings) {
    const data = getData();
    data.settings = settings;
    cached = data;
    saveData(data);
}
// ─── Flush ──────────────────────────────────────────────────────────────────
function flushAll() {
    if (cached)
        saveData(cached);
}
//# sourceMappingURL=browserSessionStore.js.map