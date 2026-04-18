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
exports.agentCache = exports.AgentCache = void 0;
exports.makeToolCacheKey = makeToolCacheKey;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const workspaceRoot_1 = require("../workspaceRoot");
const DEFAULT_TTL_MS = 30_000;
class AgentCache {
    toolResults = new Map();
    getToolResult(key) {
        const entry = this.toolResults.get(key);
        if (!entry)
            return null;
        if (entry.expiresAt <= Date.now()) {
            this.toolResults.delete(key);
            return null;
        }
        return entry.value;
    }
    setToolResult(key, value, ttlMs = DEFAULT_TTL_MS) {
        this.toolResults.set(key, {
            value,
            expiresAt: Date.now() + ttlMs,
        });
    }
    invalidateByToolPrefix(prefix) {
        for (const key of this.toolResults.keys()) {
            if (key.startsWith(prefix)) {
                this.toolResults.delete(key);
            }
        }
    }
    clear() {
        this.toolResults.clear();
    }
}
exports.AgentCache = AgentCache;
function makeToolCacheKey(name, input) {
    const freshness = cacheFreshnessKey(name, input);
    return freshness
        ? `${name}:${freshness}:${stableStringify(input)}`
        : `${name}:${stableStringify(input)}`;
}
function cacheFreshnessKey(name, input) {
    if (name !== 'filesystem.read')
        return null;
    const obj = input && typeof input === 'object' ? input : {};
    if (typeof obj.path !== 'string' || obj.path.trim() === '')
        return null;
    const resolved = path.resolve(workspaceRoot_1.APP_WORKSPACE_ROOT, obj.path);
    try {
        const stat = fs.statSync(resolved);
        return `${resolved}:${stat.size}:${stat.mtimeMs}`;
    }
    catch {
        return `${resolved}:missing`;
    }
}
function stableStringify(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(stableStringify).join(',')}]`;
    const record = value;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}
exports.agentCache = new AgentCache();
//# sourceMappingURL=AgentCache.js.map