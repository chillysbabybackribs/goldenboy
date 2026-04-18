"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const OPEN_PROMPT_SYNC_CHANNEL = 'browser:prompt-open-sync';
const POLL_PROMPT_SYNC_CHANNEL = 'browser:prompt-poll-sync';
const browserWindow = globalThis;
function sleepMs(ms) {
    if (typeof SharedArrayBuffer === 'function' && typeof Atomics !== 'undefined' && typeof Atomics.wait === 'function') {
        const buffer = new SharedArrayBuffer(4);
        const view = new Int32Array(buffer);
        Atomics.wait(view, 0, 0, ms);
        return;
    }
    const end = Date.now() + ms;
    while (Date.now() < end) {
        // Busy wait fallback for environments without SharedArrayBuffer.
    }
}
function installPromptFallback() {
    const nativePrompt = typeof browserWindow.prompt === 'function'
        ? browserWindow.prompt.bind(browserWindow)
        : null;
    browserWindow.prompt = function promptFallback(message, defaultValue) {
        const text = typeof message === 'string' ? message : '';
        const defaultPrompt = typeof defaultValue === 'string' ? defaultValue : '';
        if (nativePrompt) {
            try {
                return nativePrompt(text, defaultPrompt);
            }
            catch (err) {
                const errorText = err instanceof Error ? err.message : String(err);
                if (!/prompt\(\)\s+is\s+not\s+supported/i.test(errorText)) {
                    throw err;
                }
            }
        }
        const openResult = electron_1.ipcRenderer.sendSync(OPEN_PROMPT_SYNC_CHANNEL, {
            message: text,
            defaultPrompt,
            url: browserWindow.location?.href || '',
        });
        const dialogId = openResult?.dialogId;
        if (!dialogId)
            return null;
        for (;;) {
            const pollResult = electron_1.ipcRenderer.sendSync(POLL_PROMPT_SYNC_CHANNEL, { dialogId });
            if (pollResult?.done) {
                return typeof pollResult.value === 'string' ? pollResult.value : null;
            }
            sleepMs(50);
        }
    };
    const bridge = {
        openSync(message, defaultPrompt, url) {
            const openResult = electron_1.ipcRenderer.sendSync(OPEN_PROMPT_SYNC_CHANNEL, {
                message: typeof message === 'string' ? message : '',
                defaultPrompt: typeof defaultPrompt === 'string' ? defaultPrompt : '',
                url: typeof url === 'string' ? url : browserWindow.location?.href || '',
            });
            const dialogId = openResult?.dialogId;
            if (!dialogId)
                return null;
            for (;;) {
                const pollResult = electron_1.ipcRenderer.sendSync(POLL_PROMPT_SYNC_CHANNEL, { dialogId });
                if (pollResult?.done) {
                    return typeof pollResult.value === 'string' ? pollResult.value : null;
                }
                sleepMs(50);
            }
        },
    };
    electron_1.contextBridge.exposeInMainWorld('browserPromptShim', bridge);
}
installPromptFallback();
//# sourceMappingURL=browserTabPreload.js.map