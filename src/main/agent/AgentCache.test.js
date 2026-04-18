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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vitest_1 = require("vitest");
const AgentCache_1 = require("./AgentCache");
const TEMP_FILE = path.join(process.cwd(), 'tmp-agent-cache-read.txt');
(0, vitest_1.describe)('AgentCache', () => {
    (0, vitest_1.afterEach)(() => {
        fs.rmSync(TEMP_FILE, { force: true });
    });
    (0, vitest_1.it)('changes filesystem.read cache keys when the file contents change', async () => {
        fs.writeFileSync(TEMP_FILE, 'first', 'utf-8');
        const relativePath = path.relative(process.cwd(), TEMP_FILE);
        const firstKey = (0, AgentCache_1.makeToolCacheKey)('filesystem.read', { path: relativePath });
        await new Promise(resolve => setTimeout(resolve, 20));
        fs.writeFileSync(TEMP_FILE, 'second revision', 'utf-8');
        const secondKey = (0, AgentCache_1.makeToolCacheKey)('filesystem.read', { path: relativePath });
        (0, vitest_1.expect)(secondKey).not.toBe(firstKey);
    });
});
//# sourceMappingURL=AgentCache.test.js.map