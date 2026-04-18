"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.estimateTokens = estimateTokens;
exports.languageForPath = languageForPath;
exports.chunkFile = chunkFile;
const MAX_CHUNK_LINES = 80;
const MAX_CHUNK_CHARS = 5000;
function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}
function languageForPath(filePath) {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    const map = {
        ts: 'typescript',
        tsx: 'typescript',
        js: 'javascript',
        jsx: 'javascript',
        json: 'json',
        md: 'markdown',
        css: 'css',
        html: 'html',
        yml: 'yaml',
        yaml: 'yaml',
    };
    return map[ext] || ext || 'text';
}
function chunkFile(input) {
    const lines = input.content.split('\n');
    const chunks = [];
    let startLine = 1;
    let ordinal = 0;
    while (startLine <= lines.length) {
        let endLine = Math.min(lines.length, startLine + MAX_CHUNK_LINES - 1);
        let text = lines.slice(startLine - 1, endLine).join('\n');
        while (text.length > MAX_CHUNK_CHARS && endLine > startLine) {
            endLine = Math.max(startLine, endLine - 10);
            text = lines.slice(startLine - 1, endLine).join('\n');
        }
        chunks.push({
            id: `${input.fileId}_chunk_${ordinal}`,
            fileId: input.fileId,
            path: input.path,
            relativePath: input.relativePath,
            language: input.language,
            startLine,
            endLine,
            ordinal,
            charCount: text.length,
            tokenEstimate: estimateTokens(text),
            contentHash: input.contentHash,
            indexedAt: input.indexedAt,
        });
        startLine = endLine + 1;
        ordinal++;
    }
    return chunks;
}
//# sourceMappingURL=FileChunker.js.map