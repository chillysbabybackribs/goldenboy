"use strict";
// ═══════════════════════════════════════════════════════════════════════════
// Browser Downloads — Download lifecycle tracking for the browser surface
// ═══════════════════════════════════════════════════════════════════════════
//
// Downloads are saved to the user's default Downloads directory.
// Progress and completion are tracked and published to the event bus.
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
exports.getDownloadDir = getDownloadDir;
exports.createDownloadEntry = createDownloadEntry;
exports.resolveDownloadPath = resolveDownloadPath;
const electron_1 = require("electron");
const path = __importStar(require("path"));
const ids_1 = require("../../shared/utils/ids");
function getDownloadDir() {
    return electron_1.app.getPath('downloads');
}
function createDownloadEntry(url, filename, savePath) {
    return {
        id: (0, ids_1.generateId)('dl'),
        filename,
        url,
        savePath,
        state: 'progressing',
        receivedBytes: 0,
        totalBytes: 0,
        startedAt: Date.now(),
        completedAt: null,
        sourceTabId: null,
        sourcePageUrl: null,
        existsOnDisk: false,
        fileSize: null,
        error: null,
    };
}
function resolveDownloadPath(suggestedFilename) {
    return path.join(getDownloadDir(), suggestedFilename);
}
//# sourceMappingURL=browserDownloads.js.map