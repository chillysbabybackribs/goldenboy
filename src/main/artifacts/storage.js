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
exports.getArtifactsRoot = getArtifactsRoot;
exports.ensureArtifactsRoot = ensureArtifactsRoot;
exports.getArtifactDirectory = getArtifactDirectory;
exports.ensureArtifactDirectory = ensureArtifactDirectory;
exports.buildArtifactFilename = buildArtifactFilename;
exports.buildArtifactWorkingPath = buildArtifactWorkingPath;
exports.ensureArtifactWorkingFile = ensureArtifactWorkingFile;
exports.isPathInArtifactsRoot = isPathInArtifactsRoot;
exports.isPathInArtifactDirectory = isPathInArtifactDirectory;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const workspaceRoot_1 = require("../workspaceRoot");
const ARTIFACTS_DIR = 'artifacts';
function sanitizeSegment(value) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}
function getArtifactsRoot() {
    return path.join(workspaceRoot_1.APP_WORKSPACE_ROOT, ARTIFACTS_DIR);
}
function ensureArtifactsRoot() {
    const root = getArtifactsRoot();
    fs.mkdirSync(root, { recursive: true });
    return root;
}
function getArtifactDirectory(artifactId) {
    return path.join(getArtifactsRoot(), artifactId);
}
function ensureArtifactDirectory(artifactId) {
    const dir = getArtifactDirectory(artifactId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}
function buildArtifactFilename(title, format) {
    const base = sanitizeSegment(title) || 'untitled';
    return `${base}.${format}`;
}
function buildArtifactWorkingPath(input) {
    return path.join(getArtifactDirectory(input.artifactId), buildArtifactFilename(input.title, input.format));
}
function ensureArtifactWorkingFile(input) {
    const dir = ensureArtifactDirectory(input.artifactId);
    const workingPath = path.join(dir, buildArtifactFilename(input.title, input.format));
    if (!fs.existsSync(workingPath)) {
        fs.writeFileSync(workingPath, '', 'utf-8');
    }
    return workingPath;
}
function isPathInArtifactsRoot(targetPath) {
    const relative = path.relative(getArtifactsRoot(), targetPath);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}
function isPathInArtifactDirectory(artifactId, targetPath) {
    const relative = path.relative(getArtifactDirectory(artifactId), path.resolve(targetPath));
    return !relative.startsWith('..') && !path.isAbsolute(relative);
}
//# sourceMappingURL=storage.js.map