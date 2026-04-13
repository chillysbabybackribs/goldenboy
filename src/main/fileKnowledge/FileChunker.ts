import { CachedFileChunk } from './FileCacheTypes';

const MAX_CHUNK_LINES = 80;
const MAX_CHUNK_CHARS = 5000;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function languageForPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
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

export function chunkFile(input: {
  fileId: string;
  path: string;
  relativePath: string;
  language: string;
  content: string;
  contentHash: string;
  indexedAt: number;
}): CachedFileChunk[] {
  const lines = input.content.split('\n');
  const chunks: CachedFileChunk[] = [];
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
