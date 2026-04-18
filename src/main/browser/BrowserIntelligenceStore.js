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
exports.loadSiteStrategies = loadSiteStrategies;
exports.saveSiteStrategies = saveSiteStrategies;
exports.appendSurfaceFixture = appendSurfaceFixture;
exports.getSurfaceFixturesPath = getSurfaceFixturesPath;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const electron_1 = require("electron");
const SITE_STRATEGIES_FILE = 'browser-site-strategies.json';
const SURFACE_FIXTURES_FILE = 'browser-surface-fixtures.jsonl';
function ensureUserDataDir() {
    const dir = electron_1.app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}
function readJson(filename, fallback) {
    try {
        const filePath = path.join(ensureUserDataDir(), filename);
        if (!fs.existsSync(filePath))
            return fallback;
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
    catch {
        return fallback;
    }
}
function writeJson(filename, value) {
    try {
        const filePath = path.join(ensureUserDataDir(), filename);
        fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
    }
    catch (err) {
        console.error(`Failed to persist ${filename}:`, err);
    }
}
function appendJsonl(filename, value) {
    try {
        const filePath = path.join(ensureUserDataDir(), filename);
        fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, 'utf-8');
    }
    catch (err) {
        console.error(`Failed to append ${filename}:`, err);
    }
}
function loadSiteStrategies() {
    const parsed = readJson(SITE_STRATEGIES_FILE, []);
    return Array.isArray(parsed) ? parsed : [];
}
function saveSiteStrategies(strategies) {
    writeJson(SITE_STRATEGIES_FILE, strategies);
}
function appendSurfaceFixture(fixture) {
    appendJsonl(SURFACE_FIXTURES_FILE, fixture);
}
function getSurfaceFixturesPath() {
    return path.join(ensureUserDataDir(), SURFACE_FIXTURES_FILE);
}
//# sourceMappingURL=BrowserIntelligenceStore.js.map