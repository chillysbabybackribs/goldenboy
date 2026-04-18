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
exports.APP_WORKSPACE_ROOT = void 0;
exports.resolveWorkspacePath = resolveWorkspacePath;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function findWorkspaceRoot(startDir) {
    let current = path.resolve(startDir);
    while (true) {
        if (fs.existsSync(path.join(current, 'package.json'))) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current)
            break;
        current = parent;
    }
    return path.resolve(startDir, '..', '..');
}
// Resolve the repository root from either source or built output layouts.
const DEFAULT_WORKSPACE_ROOT = findWorkspaceRoot(__dirname);
exports.APP_WORKSPACE_ROOT = path.resolve(process.env.V2_WORKSPACE_ROOT && process.env.V2_WORKSPACE_ROOT.trim()
    ? process.env.V2_WORKSPACE_ROOT
    : DEFAULT_WORKSPACE_ROOT);
function resolveWorkspacePath(...segments) {
    return path.resolve(exports.APP_WORKSPACE_ROOT, ...segments);
}
//# sourceMappingURL=workspaceRoot.js.map