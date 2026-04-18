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
exports.fileKnowledgeStore = exports.FileKnowledgeStore = void 0;
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const electron_1 = require("electron");
const FileChunker_1 = require("./FileChunker");
const workspaceRoot_1 = require("../workspaceRoot");
const CACHE_FILE = 'file-knowledge-cache.json';
const MAX_FILE_BYTES = 500_000;
const MAX_FILES = 2000;
const MAX_SNIPPET_CHARS = 360;
const MAX_RG_BUFFER = 8 * 1024 * 1024;
const MAX_RG_ARG_CHARS = 12_000;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.next', 'coverage', '.cache']);
const INDEX_EXTENSIONS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.css', '.html', '.yml', '.yaml', '.txt',
]);
function cachePath() {
    return path.join(electron_1.app.getPath('userData'), CACHE_FILE);
}
function hash(input) {
    return crypto.createHash('sha1').update(input).digest('hex').slice(0, 16);
}
function normalizeQuery(query) {
    return query.toLowerCase().split(/[^a-z0-9_.$/-]+/).filter(token => token.length >= 2);
}
function fileIdFor(relativePath, contentHash) {
    return `file_${hash(`${relativePath}:${contentHash}`)}`;
}
function normalizePathKey(filePath) {
    return path.resolve(filePath);
}
function isIndexableFile(filePath) {
    return INDEX_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}
function clampReadChars(maxChars) {
    return Math.max(200, Math.min(Math.floor(maxChars), 20_000));
}
function makeSnippetFromLine(lineText, terms) {
    const lower = lineText.toLowerCase();
    const positions = terms.map(term => lower.indexOf(term)).filter(index => index >= 0);
    const first = positions.length > 0 ? Math.min(...positions) : 0;
    const start = Math.max(0, first - 120);
    const snippet = lineText.slice(start, start + MAX_SNIPPET_CHARS).replace(/\s+/g, ' ').trim();
    return `${start > 0 ? '...' : ''}${snippet}${start + MAX_SNIPPET_CHARS < lineText.length ? '...' : ''}`;
}
function trimContent(content, maxChars) {
    if (content.length <= maxChars)
        return { content, truncated: false };
    return {
        content: `${content.slice(0, maxChars)}\n...[file truncated]`,
        truncated: true,
    };
}
function readLinesFromDisk(filePath, startLine, endLine, maxChars) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split('\n');
    const normalizedStart = Math.min(Math.max(startLine, 1), Math.max(lines.length, 1));
    const normalizedEnd = Math.min(Math.max(endLine, normalizedStart), lines.length);
    const text = lines.slice(normalizedStart - 1, normalizedEnd).join('\n');
    const trimmed = trimContent(text, maxChars);
    return {
        content: trimmed.content,
        truncated: trimmed.truncated,
        totalLines: lines.length,
    };
}
class FileKnowledgeStore {
    files = new Map();
    chunks = new Map();
    indexedAt = null;
    searchCount = 0;
    searchHitCount = 0;
    searchMissCount = 0;
    chunkReadCount = 0;
    constructor() {
        this.load();
    }
    indexWorkspace(root = workspaceRoot_1.APP_WORKSPACE_ROOT, input) {
        const indexedAt = Date.now();
        const filePaths = walkIndexableFiles(root, input?.limit || MAX_FILES);
        const nextFiles = new Map();
        const nextChunks = new Map();
        const existingByPath = new Map(Array.from(this.files.values()).map(record => [normalizePathKey(record.path), record]));
        let skippedFiles = 0;
        for (const filePath of filePaths) {
            try {
                const stat = fs.statSync(filePath);
                if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
                    skippedFiles++;
                    continue;
                }
                const relativePath = path.relative(root, filePath);
                const existing = existingByPath.get(normalizePathKey(filePath));
                if (existing
                    && existing.relativePath === relativePath
                    && existing.sizeBytes === stat.size
                    && existing.mtimeMs === stat.mtimeMs) {
                    const reused = this.cloneExistingRecord(existing, {
                        path: filePath,
                        relativePath,
                        indexedAt,
                    });
                    if (reused) {
                        nextFiles.set(reused.record.id, reused.record);
                        for (const chunk of reused.chunks)
                            nextChunks.set(chunk.id, chunk);
                        continue;
                    }
                }
                const built = this.buildRecord(filePath, root, stat, indexedAt);
                if (!built) {
                    skippedFiles++;
                    continue;
                }
                nextFiles.set(built.record.id, built.record);
                for (const chunk of built.chunks)
                    nextChunks.set(chunk.id, chunk);
            }
            catch {
                skippedFiles++;
            }
        }
        this.files = nextFiles;
        this.chunks = nextChunks;
        this.indexedAt = indexedAt;
        this.save();
        return {
            indexedFiles: this.files.size,
            chunkCount: this.chunks.size,
            skippedFiles,
            indexedAt,
        };
    }
    listFiles(input) {
        return Array.from(this.files.values())
            .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
            .slice(0, input?.limit || 200)
            .map(file => ({ ...file }));
    }
    search(query, input) {
        this.searchCount++;
        const terms = normalizeQuery(query);
        if (terms.length === 0) {
            this.searchMissCount++;
            return [];
        }
        const candidates = Array.from(this.files.values())
            .filter(record => !input?.pathPrefix || record.relativePath.startsWith(input.pathPrefix))
            .filter(record => !input?.language || record.language === input.language);
        if (candidates.length === 0) {
            this.searchMissCount++;
            return [];
        }
        const matches = this.runSearch(terms, candidates.map(record => record.path));
        const candidateMap = new Map(candidates.map(record => [normalizePathKey(record.path), record]));
        const byChunk = new Map();
        for (const match of matches) {
            const current = candidateMap.get(normalizePathKey(match.path));
            const record = current || this.refreshFile(match.path)?.record || null;
            if (!record)
                continue;
            if (!candidateMap.has(normalizePathKey(record.path)))
                continue;
            const chunk = this.findChunkForLine(record, match.lineNumber);
            if (!chunk)
                continue;
            const score = this.scoreMatch(record, match.lineText, terms);
            const existing = byChunk.get(chunk.id);
            const snippet = makeSnippetFromLine(match.lineText, terms);
            const next = {
                chunkId: chunk.id,
                fileId: record.id,
                path: record.path,
                relativePath: record.relativePath,
                language: record.language,
                startLine: chunk.startLine,
                endLine: chunk.endLine,
                snippet,
                score,
                tokenEstimate: Math.min(chunk.tokenEstimate, (0, FileChunker_1.estimateTokens)(snippet)),
            };
            if (!existing || next.score > existing.score) {
                byChunk.set(chunk.id, next);
            }
        }
        const limit = Math.min(input?.limit || 10, 50);
        const results = Array.from(byChunk.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
        if (results.length > 0)
            this.searchHitCount++;
        else
            this.searchMissCount++;
        return results;
    }
    answerFromCache(query, input) {
        const sources = this.search(query, { ...input, limit: input?.limit || 5 });
        const excerpts = sources
            .map(source => this.readChunk(source.chunkId, 1200))
            .filter((chunk) => Boolean(chunk))
            .map(chunk => `### ${chunk.relativePath}:${chunk.startLine}\n${chunk.text || ''}`);
        const answer = excerpts.length > 0
            ? excerpts.join('\n\n')
            : 'No indexed file matches were found. Use filesystem.search or filesystem.read as a fallback.';
        return {
            query,
            answer,
            sources,
            tokenEstimate: (0, FileChunker_1.estimateTokens)(answer),
        };
    }
    readChunk(chunkId, maxChars = 3000) {
        const chunk = this.resolveFreshChunk(chunkId);
        if (!chunk)
            return null;
        this.chunkReadCount++;
        const window = readLinesFromDisk(chunk.path, chunk.startLine, chunk.endLine, clampReadChars(maxChars));
        return {
            ...chunk,
            text: window.content,
            tokenEstimate: (0, FileChunker_1.estimateTokens)(window.content),
        };
    }
    readWindowForPath(filePath, input) {
        const record = this.findFreshRecordByPath(filePath) || this.refreshFile(filePath)?.record || null;
        if (!record)
            return null;
        const maxChars = clampReadChars(input?.maxChars ?? 6_000);
        const startLine = Math.max(input?.startLine || 1, 1);
        const selectedChunks = this.selectChunksForWindow(record, {
            startLine,
            endLine: input?.endLine,
            maxChars,
        });
        if (selectedChunks.length === 0)
            return null;
        const rangeStart = input?.startLine || selectedChunks[0].startLine;
        const rangeEnd = input?.endLine || selectedChunks[selectedChunks.length - 1].endLine;
        const window = readLinesFromDisk(record.path, rangeStart, rangeEnd, maxChars);
        return {
            path: record.path,
            relativePath: record.relativePath,
            content: window.content,
            truncated: window.truncated,
            startLine: rangeStart,
            endLine: rangeEnd,
            totalLines: window.totalLines,
            chunkCount: selectedChunks.length,
        };
    }
    getFreshChunksForPath(filePath) {
        const record = this.findFreshRecordByPath(filePath) || this.refreshFile(filePath)?.record || null;
        if (!record)
            return null;
        const chunks = record.chunkIds
            .map(chunkId => this.chunks.get(chunkId))
            .filter((chunk) => Boolean(chunk));
        if (chunks.length !== record.chunkIds.length)
            return null;
        return chunks.map(chunk => ({ ...chunk }));
    }
    refreshFile(filePath, root = workspaceRoot_1.APP_WORKSPACE_ROOT) {
        const normalizedPath = normalizePathKey(filePath);
        const existing = this.findRecordByPath(normalizedPath);
        try {
            const stat = fs.statSync(normalizedPath);
            if (!stat.isFile() || stat.size > MAX_FILE_BYTES || !isIndexableFile(normalizedPath)) {
                this.removeFile(normalizedPath);
                return null;
            }
            const relativePath = path.relative(root, normalizedPath);
            if (existing
                && existing.relativePath === relativePath
                && existing.sizeBytes === stat.size
                && existing.mtimeMs === stat.mtimeMs) {
                const reused = this.cloneExistingRecord(existing, {
                    path: normalizedPath,
                    relativePath,
                    indexedAt: Date.now(),
                });
                if (reused) {
                    this.replaceRecord(normalizedPath, reused.record, reused.chunks);
                    return {
                        record: { ...reused.record },
                        chunks: reused.chunks.map(chunk => ({ ...chunk })),
                        reused: true,
                    };
                }
            }
            const built = this.buildRecord(normalizedPath, root, stat, Date.now());
            if (!built) {
                this.removeFile(normalizedPath);
                return null;
            }
            this.replaceRecord(normalizedPath, built.record, built.chunks);
            return {
                record: { ...built.record },
                chunks: built.chunks.map(chunk => ({ ...chunk })),
                reused: false,
            };
        }
        catch {
            this.removeFile(normalizedPath);
            return null;
        }
    }
    removeFile(filePath) {
        const existing = this.findRecordByPath(filePath);
        if (!existing)
            return false;
        this.deleteRecord(existing);
        this.save();
        return true;
    }
    removePathTree(filePath) {
        const normalizedPath = normalizePathKey(filePath);
        const prefix = `${normalizedPath}${path.sep}`;
        const matches = Array.from(this.files.values())
            .filter((record) => {
            const recordPath = normalizePathKey(record.path);
            return recordPath === normalizedPath || recordPath.startsWith(prefix);
        });
        if (matches.length === 0)
            return 0;
        for (const record of matches) {
            this.deleteRecord(record);
        }
        this.save();
        return matches.length;
    }
    getStats() {
        const chunks = Array.from(this.chunks.values());
        return {
            fileCount: this.files.size,
            chunkCount: this.chunks.size,
            totalTokenEstimate: chunks.reduce((sum, chunk) => sum + chunk.tokenEstimate, 0),
            indexedAt: this.indexedAt,
            searchCount: this.searchCount,
            searchHitCount: this.searchHitCount,
            searchMissCount: this.searchMissCount,
            chunkReadCount: this.chunkReadCount,
        };
    }
    load() {
        try {
            const filePath = cachePath();
            if (!fs.existsSync(filePath))
                return;
            const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            this.indexedAt = parsed.indexedAt || null;
            for (const file of parsed.files || [])
                this.files.set(file.id, file);
            for (const chunk of parsed.chunks || [])
                this.chunks.set(chunk.id, chunk);
        }
        catch {
            this.files.clear();
            this.chunks.clear();
            this.indexedAt = null;
        }
    }
    save() {
        const filePath = cachePath();
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const payload = {
            files: Array.from(this.files.values()),
            chunks: Array.from(this.chunks.values()).map(chunk => {
                const { text: _text, ...rest } = chunk;
                return rest;
            }),
            indexedAt: this.indexedAt,
        };
        fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
    }
    buildRecord(filePath, root, stat, indexedAt) {
        if (!isIndexableFile(filePath))
            return null;
        const content = fs.readFileSync(filePath, 'utf-8');
        const contentHash = hash(content);
        const relativePath = path.relative(root, filePath);
        const fileId = fileIdFor(relativePath, contentHash);
        const language = (0, FileChunker_1.languageForPath)(filePath);
        const chunks = (0, FileChunker_1.chunkFile)({
            fileId,
            path: filePath,
            relativePath,
            language,
            content,
            contentHash,
            indexedAt,
        });
        const record = {
            id: fileId,
            path: filePath,
            relativePath,
            language,
            contentHash,
            sizeBytes: stat.size,
            mtimeMs: stat.mtimeMs,
            chunkIds: chunks.map(chunk => chunk.id),
            indexedAt,
        };
        return { record, chunks };
    }
    cloneExistingRecord(existing, input) {
        const chunks = existing.chunkIds
            .map(chunkId => this.chunks.get(chunkId))
            .filter((chunk) => Boolean(chunk))
            .map(chunk => ({
            ...chunk,
            path: input.path,
            relativePath: input.relativePath,
            indexedAt: input.indexedAt,
        }));
        if (chunks.length !== existing.chunkIds.length)
            return null;
        return {
            record: {
                ...existing,
                path: input.path,
                relativePath: input.relativePath,
                indexedAt: input.indexedAt,
            },
            chunks,
        };
    }
    replaceRecord(filePath, record, chunks) {
        const existing = this.findRecordByPath(filePath);
        if (existing)
            this.deleteRecord(existing);
        this.files.set(record.id, record);
        for (const chunk of chunks)
            this.chunks.set(chunk.id, chunk);
        this.indexedAt = Date.now();
        this.save();
    }
    deleteRecord(record) {
        this.files.delete(record.id);
        for (const chunkId of record.chunkIds)
            this.chunks.delete(chunkId);
    }
    findRecordByPath(filePath) {
        const normalizedPath = normalizePathKey(filePath);
        for (const record of this.files.values()) {
            if (normalizePathKey(record.path) === normalizedPath)
                return record;
        }
        return null;
    }
    findFreshRecordByPath(filePath) {
        const record = this.findRecordByPath(filePath);
        if (!record)
            return null;
        try {
            const stat = fs.statSync(normalizePathKey(filePath));
            if (!stat.isFile())
                return null;
            return stat.size === record.sizeBytes && stat.mtimeMs === record.mtimeMs
                ? record
                : null;
        }
        catch {
            return null;
        }
    }
    resolveFreshChunk(chunkId) {
        const chunk = this.chunks.get(chunkId);
        if (!chunk)
            return null;
        const record = this.findFreshRecordByPath(chunk.path) || this.refreshFile(chunk.path)?.record || null;
        if (!record)
            return null;
        const freshChunk = this.findChunkByOrdinal(record, chunk.ordinal);
        return freshChunk ? { ...freshChunk } : null;
    }
    findChunkForLine(record, lineNumber) {
        for (const chunkId of record.chunkIds) {
            const chunk = this.chunks.get(chunkId);
            if (chunk && lineNumber >= chunk.startLine && lineNumber <= chunk.endLine) {
                return chunk;
            }
        }
        return null;
    }
    findChunkByOrdinal(record, ordinal) {
        for (const chunkId of record.chunkIds) {
            const chunk = this.chunks.get(chunkId);
            if (chunk && chunk.ordinal === ordinal)
                return chunk;
        }
        return null;
    }
    selectChunksForWindow(record, input) {
        const selected = [];
        let accumulatedChars = 0;
        for (const chunkId of record.chunkIds) {
            const chunk = this.chunks.get(chunkId);
            if (!chunk)
                continue;
            if (chunk.endLine < input.startLine)
                continue;
            selected.push(chunk);
            accumulatedChars += chunk.charCount;
            if (input.endLine && chunk.endLine >= input.endLine)
                break;
            if (!input.endLine && accumulatedChars >= input.maxChars)
                break;
        }
        return selected;
    }
    scoreMatch(record, lineText, terms) {
        const haystack = lineText.toLowerCase();
        let score = 0;
        for (const term of terms) {
            const matches = haystack.split(term).length - 1;
            score += matches;
            if (record.relativePath.toLowerCase().includes(term))
                score += 4;
        }
        return score;
    }
    runSearch(terms, candidatePaths) {
        try {
            return this.runRipgrep(terms, candidatePaths);
        }
        catch {
            return this.fallbackSearchCandidates(terms, candidatePaths);
        }
    }
    runRipgrep(terms, candidatePaths) {
        if (candidatePaths.length === 0)
            return [];
        const matches = [];
        for (const batch of chunkPathsForArgBudget(candidatePaths, MAX_RG_ARG_CHARS)) {
            const searchArgs = batch.map(filePath => toSearchArg(filePath));
            const args = [
                '--json',
                '--line-number',
                '--ignore-case',
                '--fixed-strings',
                '--color',
                'never',
                ...terms.flatMap(term => ['-e', term]),
                ...searchArgs,
            ];
            const result = (0, child_process_1.spawnSync)('rg', args, {
                cwd: workspaceRoot_1.APP_WORKSPACE_ROOT,
                encoding: 'utf-8',
                maxBuffer: MAX_RG_BUFFER,
            });
            if (result.error) {
                const code = result.error.code;
                if (code === 'E2BIG') {
                    throw result.error;
                }
                continue;
            }
            if (result.status !== 0 && result.status !== 1)
                continue;
            const lines = (result.stdout || '').split('\n').filter(Boolean);
            for (const line of lines) {
                try {
                    const parsed = JSON.parse(line);
                    if (parsed.type !== 'match')
                        continue;
                    const filePath = parsed.data?.path?.text;
                    const lineNumber = parsed.data?.line_number;
                    const lineText = parsed.data?.lines?.text;
                    if (!filePath || typeof lineNumber !== 'number' || typeof lineText !== 'string')
                        continue;
                    matches.push({
                        path: path.resolve(filePath),
                        lineNumber,
                        lineText: lineText.replace(/\n$/, ''),
                    });
                }
                catch {
                    // Ignore malformed rg lines.
                }
            }
        }
        return matches;
    }
    fallbackSearchCandidates(terms, candidatePaths) {
        const matches = [];
        for (const filePath of candidatePaths) {
            try {
                const text = fs.readFileSync(filePath, 'utf-8');
                const lines = text.split('\n');
                for (let index = 0; index < lines.length; index++) {
                    const lineText = lines[index];
                    const lower = lineText.toLowerCase();
                    if (terms.every(term => lower.includes(term)) || terms.some(term => lower.includes(term))) {
                        matches.push({
                            path: filePath,
                            lineNumber: index + 1,
                            lineText,
                        });
                    }
                }
            }
            catch {
                // Ignore unreadable files and continue.
            }
        }
        return matches;
    }
}
exports.FileKnowledgeStore = FileKnowledgeStore;
function walkIndexableFiles(root, limit) {
    const files = [];
    const stack = [root];
    while (stack.length > 0 && files.length < limit) {
        const current = stack.pop();
        let entries;
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (!SKIP_DIRS.has(entry.name))
                    stack.push(fullPath);
                continue;
            }
            if (!entry.isFile())
                continue;
            if (!isIndexableFile(fullPath))
                continue;
            files.push(fullPath);
            if (files.length >= limit)
                break;
        }
    }
    return files;
}
function chunkPathsForArgBudget(items, maxArgChars) {
    const out = [];
    let current = [];
    let currentChars = 0;
    for (const item of items) {
        const nextArg = toSearchArg(item);
        if (current.length > 0 && currentChars + nextArg.length > maxArgChars) {
            out.push(current);
            current = [];
            currentChars = 0;
        }
        current.push(item);
        currentChars += nextArg.length;
    }
    if (current.length > 0) {
        out.push(current);
    }
    return out;
}
function toSearchArg(filePath) {
    const relative = path.relative(workspaceRoot_1.APP_WORKSPACE_ROOT, filePath);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
        return relative;
    }
    return filePath;
}
exports.fileKnowledgeStore = new FileKnowledgeStore();
//# sourceMappingURL=FileKnowledgeStore.js.map