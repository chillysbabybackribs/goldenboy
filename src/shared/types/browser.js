"use strict";
// ═══════════════════════════════════════════════════════════════════════════
// Browser Runtime Types — Full browser subsystem with tabs, bookmarks,
// extensions, settings, zoom, find-in-page, downloads, permissions
// ═══════════════════════════════════════════════════════════════════════════
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDefaultSettings = createDefaultSettings;
exports.createDefaultBrowserState = createDefaultBrowserState;
function createDefaultSettings() {
    return {
        homepage: 'https://www.google.com',
        searchEngine: 'google',
        defaultZoom: 1.0,
        javascript: true,
        images: true,
        popups: false,
        importChromeCookies: null,
    };
}
function createDefaultBrowserState() {
    return {
        surfaceStatus: 'idle',
        navigation: {
            url: '',
            title: '',
            canGoBack: false,
            canGoForward: false,
            isLoading: false,
            loadingProgress: null,
            favicon: '',
            lastNavigationAt: null,
        },
        profile: {
            id: 'workspace-browser',
            partition: 'persist:workspace-browser',
            persistent: true,
            userAgent: null,
        },
        tabs: [],
        activeTabId: '',
        splitLeftTabId: null,
        splitRightTabId: null,
        history: [],
        bookmarks: [],
        activeDownloads: [],
        completedDownloads: [],
        recentPermissions: [],
        pendingDialogs: [],
        extensions: [],
        findInPage: { active: false, query: '', activeMatch: 0, totalMatches: 0 },
        settings: createDefaultSettings(),
        lastError: null,
        createdAt: null,
    };
}
//# sourceMappingURL=browser.js.map