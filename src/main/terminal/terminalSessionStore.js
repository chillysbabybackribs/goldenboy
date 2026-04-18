"use strict";
// ═══════════════════════════════════════════════════════════════════════════
// Terminal Session Store — Persistent terminal data across sessions
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
exports.loadTerminalData = loadTerminalData;
exports.saveTerminalData = saveTerminalData;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const electron_1 = require("electron");
const DATA_FILE = 'terminal-data.json';
function getDataPath() {
    return path.join(electron_1.app.getPath('userData'), DATA_FILE);
}
function createDefaults() {
    return {
        lastCwd: null,
        shell: '',
    };
}
function loadTerminalData() {
    try {
        const filePath = getDataPath();
        if (!fs.existsSync(filePath))
            return createDefaults();
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
            lastCwd: typeof parsed.lastCwd === 'string' ? parsed.lastCwd : null,
            shell: typeof parsed.shell === 'string' ? parsed.shell : '',
        };
    }
    catch {
        return createDefaults();
    }
}
function saveTerminalData(data) {
    try {
        const filePath = getDataPath();
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    }
    catch (err) {
        console.error('Failed to persist terminal data:', err);
    }
}
//# sourceMappingURL=terminalSessionStore.js.map