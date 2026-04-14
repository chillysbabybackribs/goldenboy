import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { app } from 'electron';
import { estimateTokens, languageForPath } from '../fileKnowledge/FileChunker';
import type {
  DocumentAttachmentStatus,
  DocumentImportRequest,
  DocumentInvocationAttachment,
} from '../../shared/types/attachments';

type PersistedStore = {
  documents: StoredDocumentRecord[];
  chunks: StoredDocumentChunk[];
  updatedAt: number | null;
};

type StoredDocumentRecord = {
  id: string;
  taskId: string;
  name: string;
  mediaType: string;
  sourcePath: string;
  storagePath: string;
  sizeBytes: number;
  contentHash: string;
  status: DocumentAttachmentStatus;
  statusDetail: string | null;
  excerpt: string;
  chunkIds: string[];
  tokenEstimate: number;
  language: string;
  charCount: number;
  lineCount: number;
  importedAt: number;
  lastModifiedMs: number;
};

type StoredDocumentChunk = {
  id: string;
  attachmentId: string;
  taskId: string;
  ordinal: number;
  startLine: number;
  endLine: number;
  charCount: number;
  tokenEstimate: number;
  text: string;
};

export type DocumentSearchResult = {
  chunkId: string;
  attachmentId: string;
  name: string;
  startLine: number;
  endLine: number;
  snippet: string;
  score: number;
  tokenEstimate: number;
};

export type DocumentReadResult = {
  document: DocumentInvocationAttachment;
  content: string;
  truncated: boolean;
};

export type DocumentAttachmentStats = {
  documentCount: number;
  indexedDocumentCount: number;
  chunkCount: number;
  totalTokenEstimate: number;
  updatedAt: number | null;
};

const STORE_DIR = 'document-attachments';
const INDEX_FILE = 'index.json';
const FILES_DIR = 'files';
const MAX_EXCERPT_CHARS = 600;
const MAX_TEXT_EXTRACT_BYTES = 10_000_000;
const MAX_CHUNK_LINES = 80;
const MAX_CHUNK_CHARS = 5_000;

const TEXT_EXTRACTABLE_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.csv', '.log', '.xml', '.yaml', '.yml', '.toml',
  '.html', '.htm', '.css', '.js', '.jsx', '.ts', '.tsx', '.py', '.sh', '.go', '.rs',
  '.c', '.cpp', '.cc', '.h', '.hpp', '.java',
]);

const MEDIA_TYPES_BY_EXTENSION: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.log': 'text/plain',
  '.xml': 'application/xml',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.toml': 'application/toml',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.jsx': 'text/javascript',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.py': 'text/x-python',
  '.sh': 'text/x-shellscript',
  '.go': 'text/x-go',
  '.rs': 'text/x-rust',
  '.c': 'text/x-c',
  '.cpp': 'text/x-c++',
  '.cc': 'text/x-c++',
  '.h': 'text/x-c',
  '.hpp': 'text/x-c++',
  '.java': 'text/x-java-source',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function storeRoot(): string {
  return path.join(app.getPath('userData'), STORE_DIR);
}

function indexPath(): string {
  return path.join(storeRoot(), INDEX_FILE);
}

function filesRoot(): string {
  return path.join(storeRoot(), FILES_DIR);
}

function ensureStoreDirs(): void {
  fs.mkdirSync(filesRoot(), { recursive: true });
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function normalizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_.$/-]+/)
    .filter((token) => token.length >= 2);
}

function trimContent(content: string, maxChars: number): { content: string; truncated: boolean } {
  if (content.length <= maxChars) return { content, truncated: false };
  return {
    content: `${content.slice(0, maxChars)}\n...[document truncated]`,
    truncated: true,
  };
}

function normalizeMediaType(filePath: string, provided?: string): string {
  if (provided && provided.trim()) return provided.trim();
  return MEDIA_TYPES_BY_EXTENSION[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function isTextExtractable(filePath: string, mediaType: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_EXTRACTABLE_EXTENSIONS.has(ext)) return true;
  return mediaType.startsWith('text/');
}

function loadStore(): PersistedStore {
  try {
    const filePath = indexPath();
    if (!fs.existsSync(filePath)) {
      return { documents: [], chunks: [], updatedAt: null };
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as PersistedStore;
    return {
      documents: Array.isArray(parsed.documents) ? parsed.documents : [],
      chunks: Array.isArray(parsed.chunks) ? parsed.chunks : [],
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : null,
    };
  } catch {
    return { documents: [], chunks: [], updatedAt: null };
  }
}

function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function excerptFor(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_EXCERPT_CHARS);
}

function snippetFor(text: string, terms: string[]): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  const lower = compact.toLowerCase();
  const positions = terms.map((term) => lower.indexOf(term)).filter((position) => position >= 0);
  const first = positions.length > 0 ? Math.min(...positions) : 0;
  const start = Math.max(0, first - 120);
  const snippet = compact.slice(start, start + 360);
  return `${start > 0 ? '...' : ''}${snippet}${start + 360 < compact.length ? '...' : ''}`;
}

function scoreChunk(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const term of terms) {
    const matches = lower.split(term).length - 1;
    score += Math.min(matches, 8);
    if (lower.includes(term)) score += 4;
  }
  return score;
}

function buildChunks(
  attachmentId: string,
  taskId: string,
  text: string,
): StoredDocumentChunk[] {
  const lines = text.split('\n');
  const chunks: StoredDocumentChunk[] = [];
  let startLine = 1;
  let ordinal = 0;

  while (startLine <= lines.length) {
    let endLine = Math.min(lines.length, startLine + MAX_CHUNK_LINES - 1);
    let chunkText = lines.slice(startLine - 1, endLine).join('\n');

    while (chunkText.length > MAX_CHUNK_CHARS && endLine > startLine) {
      endLine = Math.max(startLine, endLine - 10);
      chunkText = lines.slice(startLine - 1, endLine).join('\n');
    }

    chunks.push({
      id: `${attachmentId}_chunk_${ordinal}`,
      attachmentId,
      taskId,
      ordinal,
      startLine,
      endLine,
      charCount: chunkText.length,
      tokenEstimate: estimateTokens(chunkText),
      text: chunkText,
    });

    startLine = endLine + 1;
    ordinal++;
  }

  return chunks;
}

export class DocumentAttachmentStore {
  private documents = new Map<string, StoredDocumentRecord>();
  private chunks = new Map<string, StoredDocumentChunk>();
  private updatedAt: number | null = null;

  constructor() {
    ensureStoreDirs();
    const loaded = loadStore();
    for (const document of loaded.documents) {
      this.documents.set(document.id, document);
    }
    for (const chunk of loaded.chunks) {
      this.chunks.set(chunk.id, chunk);
    }
    this.updatedAt = loaded.updatedAt;
  }

  async importDocuments(taskId: string, documents: DocumentImportRequest[]): Promise<DocumentInvocationAttachment[]> {
    if (!documents.length) return [];
    ensureStoreDirs();
    const imported: DocumentInvocationAttachment[] = [];

    for (const input of documents) {
      const sourcePath = path.resolve(input.path);
      const stat = fs.statSync(sourcePath);
      if (!stat.isFile()) {
        throw new Error(`Not a file: ${sourcePath}`);
      }

      const contentHash = await hashFile(sourcePath);
      const existing = this.findByTaskAndHash(taskId, contentHash);
      if (existing) {
        imported.push(this.toInvocationAttachment(existing));
        continue;
      }

      const importedAt = Date.now();
      const name = (input.name && input.name.trim()) || path.basename(sourcePath);
      const mediaType = normalizeMediaType(sourcePath, input.mediaType);
      const id = `doc_${crypto.createHash('sha1').update(`${taskId}:${contentHash}:${name}`).digest('hex').slice(0, 16)}`;
      const taskDir = path.join(filesRoot(), safeSegment(taskId));
      fs.mkdirSync(taskDir, { recursive: true });
      const storagePath = path.join(taskDir, `${id}_${safeSegment(name)}`);
      fs.copyFileSync(sourcePath, storagePath);

      let status: DocumentAttachmentStatus = 'stored';
      let statusDetail: string | null = null;
      let excerpt = '';
      let tokenEstimate = 0;
      let charCount = 0;
      let lineCount = 0;
      const language = languageForPath(name);
      let builtChunks: StoredDocumentChunk[] = [];

      if (isTextExtractable(sourcePath, mediaType)) {
        if (stat.size > MAX_TEXT_EXTRACT_BYTES) {
          status = 'stored';
          statusDetail = `Text extraction not attempted because the file exceeds ${MAX_TEXT_EXTRACT_BYTES} bytes.`;
        } else {
          try {
            const text = fs.readFileSync(sourcePath, 'utf-8').replace(/\u0000/g, '');
            excerpt = excerptFor(text);
            tokenEstimate = estimateTokens(text);
            charCount = text.length;
            lineCount = text.split('\n').length;
            builtChunks = buildChunks(id, taskId, text);
            status = 'indexed';
          } catch (error) {
            status = 'failed';
            statusDetail = error instanceof Error ? error.message : String(error);
          }
        }
      } else {
        status = 'unsupported';
        statusDetail = `No extractor is available yet for ${mediaType}.`;
      }

      const record: StoredDocumentRecord = {
        id,
        taskId,
        name,
        mediaType,
        sourcePath,
        storagePath,
        sizeBytes: input.sizeBytes ?? stat.size,
        contentHash,
        status,
        statusDetail,
        excerpt,
        chunkIds: builtChunks.map((chunk) => chunk.id),
        tokenEstimate,
        language,
        charCount,
        lineCount,
        importedAt,
        lastModifiedMs: input.lastModifiedMs ?? stat.mtimeMs,
      };

      this.documents.set(record.id, record);
      for (const chunk of builtChunks) {
        this.chunks.set(chunk.id, chunk);
      }
      this.updatedAt = importedAt;
      imported.push(this.toInvocationAttachment(record));
    }

    this.save();
    return imported;
  }

  listTaskDocuments(taskId: string): DocumentInvocationAttachment[] {
    return Array.from(this.documents.values())
      .filter((document) => document.taskId === taskId)
      .sort((a, b) => a.importedAt - b.importedAt)
      .map((document) => this.toInvocationAttachment(document));
  }

  search(taskId: string, query: string, input?: { limit?: number }): DocumentSearchResult[] {
    const terms = normalizeQuery(query);
    if (terms.length === 0) return [];

    const results: DocumentSearchResult[] = [];
    for (const document of this.documents.values()) {
      if (document.taskId !== taskId || document.status !== 'indexed') continue;
      for (const chunkId of document.chunkIds) {
        const chunk = this.chunks.get(chunkId);
        if (!chunk) continue;
        const score = scoreChunk(chunk.text, terms);
        if (score <= 0) continue;
        results.push({
          chunkId: chunk.id,
          attachmentId: document.id,
          name: document.name,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          snippet: snippetFor(chunk.text, terms),
          score,
          tokenEstimate: Math.min(chunk.tokenEstimate, estimateTokens(chunk.text)),
        });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(input?.limit || 8, 50));
  }

  readChunk(taskId: string, chunkId: string, maxChars = 3000): (StoredDocumentChunk & { text: string; truncated: boolean }) | null {
    const chunk = this.chunks.get(chunkId);
    if (!chunk || chunk.taskId !== taskId) return null;
    const trimmed = trimContent(chunk.text, maxChars);
    return {
      ...chunk,
      text: trimmed.content,
      truncated: trimmed.truncated,
    };
  }

  readDocument(taskId: string, documentId: string, maxChars = 4000): DocumentReadResult | null {
    const document = this.documents.get(documentId);
    if (!document || document.taskId !== taskId) return null;
    if (document.status !== 'indexed') {
      return {
        document: this.toInvocationAttachment(document),
        content: document.excerpt,
        truncated: false,
      };
    }

    const text = document.chunkIds
      .map((chunkId) => this.chunks.get(chunkId)?.text || '')
      .join('\n');
    const trimmed = trimContent(text, maxChars);
    return {
      document: this.toInvocationAttachment(document),
      content: trimmed.content,
      truncated: trimmed.truncated,
    };
  }

  getStats(taskId: string): DocumentAttachmentStats {
    const documents = Array.from(this.documents.values()).filter((document) => document.taskId === taskId);
    const chunkCount = documents.reduce((sum, document) => sum + document.chunkIds.length, 0);
    const totalTokenEstimate = documents.reduce((sum, document) => sum + document.tokenEstimate, 0);
    return {
      documentCount: documents.length,
      indexedDocumentCount: documents.filter((document) => document.status === 'indexed').length,
      chunkCount,
      totalTokenEstimate,
      updatedAt: this.updatedAt,
    };
  }

  clearTask(taskId: string): void {
    const taskDocuments = Array.from(this.documents.values()).filter((document) => document.taskId === taskId);
    if (taskDocuments.length === 0) return;

    for (const document of taskDocuments) {
      this.documents.delete(document.id);
      for (const chunkId of document.chunkIds) {
        this.chunks.delete(chunkId);
      }
    }

    fs.rmSync(path.join(filesRoot(), safeSegment(taskId)), { recursive: true, force: true });
    this.updatedAt = Date.now();
    this.save();
  }

  private save(): void {
    ensureStoreDirs();
    const payload: PersistedStore = {
      documents: Array.from(this.documents.values()),
      chunks: Array.from(this.chunks.values()),
      updatedAt: this.updatedAt,
    };
    fs.writeFileSync(indexPath(), JSON.stringify(payload, null, 2), 'utf-8');
  }

  private findByTaskAndHash(taskId: string, contentHash: string): StoredDocumentRecord | null {
    for (const document of this.documents.values()) {
      if (document.taskId === taskId && document.contentHash === contentHash) {
        return document;
      }
    }
    return null;
  }

  private toInvocationAttachment(document: StoredDocumentRecord): DocumentInvocationAttachment {
    return {
      type: 'document',
      id: document.id,
      name: document.name,
      mediaType: document.mediaType,
      sizeBytes: document.sizeBytes,
      status: document.status,
      statusDetail: document.statusDetail,
      excerpt: document.excerpt,
      chunkCount: document.chunkIds.length,
      tokenEstimate: document.tokenEstimate,
      language: document.language,
    };
  }
}

export const documentAttachmentStore = new DocumentAttachmentStore();
