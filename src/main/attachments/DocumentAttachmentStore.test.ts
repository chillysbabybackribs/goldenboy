import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => process.env.V2_TEST_USER_DATA || os.tmpdir(),
  },
}));

describe('DocumentAttachmentStore', () => {
  let userDataDir = '';
  let workspaceDir = '';

  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-document-attachments-user-data-'));
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-document-attachments-workspace-'));
    process.env.V2_TEST_USER_DATA = userDataDir;
  });

  afterEach(() => {
    delete process.env.V2_TEST_USER_DATA;
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it('imports, indexes, searches, and clears task documents', async () => {
    const sourcePath = path.join(workspaceDir, 'notes.md');
    fs.writeFileSync(
      sourcePath,
      [
        '# Incident Notes',
        '',
        'The websocket reconnect bug happens after idle sleep.',
        'We should add retry backoff and connection state logging.',
        '',
        'Final action item: patch the reconnect guard.',
      ].join('\n'),
      'utf-8',
    );

    const { DocumentAttachmentStore } = await import('./DocumentAttachmentStore');
    const store = new DocumentAttachmentStore();

    const imported = await store.importDocuments('task-1', [
      {
        path: sourcePath,
        name: 'notes.md',
        mediaType: 'text/markdown',
      },
    ]);

    expect(imported).toHaveLength(1);
    expect(imported[0].status).toBe('indexed');
    expect(imported[0].chunkCount).toBeGreaterThan(0);

    const deduped = await store.importDocuments('task-1', [
      {
        path: sourcePath,
        name: 'notes.md',
        mediaType: 'text/markdown',
      },
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].id).toBe(imported[0].id);
    expect(store.listTaskDocuments('task-1')).toHaveLength(1);

    const results = store.search('task-1', 'reconnect guard');
    expect(results.length).toBeGreaterThan(0);

    const chunk = store.readChunk('task-1', results[0].chunkId, 500);
    expect(chunk).toBeTruthy();
    expect(chunk?.text).toContain('reconnect');

    const document = store.readDocument('task-1', imported[0].id, 2000);
    expect(document).toBeTruthy();
    expect(document?.content).toContain('websocket reconnect bug');

    const statsBeforeClear = store.getStats('task-1');
    expect(statsBeforeClear.documentCount).toBe(1);
    expect(statsBeforeClear.indexedDocumentCount).toBe(1);

    store.clearTask('task-1');

    expect(store.listTaskDocuments('task-1')).toEqual([]);
    expect(store.search('task-1', 'reconnect')).toEqual([]);
    expect(store.getStats('task-1').documentCount).toBe(0);
  });

  it('stores unsupported binary-like documents without indexing them', async () => {
    const sourcePath = path.join(workspaceDir, 'report.pdf');
    fs.writeFileSync(sourcePath, Buffer.from('%PDF-1.4 fake pdf payload', 'utf-8'));

    const { DocumentAttachmentStore } = await import('./DocumentAttachmentStore');
    const store = new DocumentAttachmentStore();

    const imported = await store.importDocuments('task-2', [
      {
        path: sourcePath,
        name: 'report.pdf',
        mediaType: 'application/pdf',
      },
    ]);

    expect(imported).toHaveLength(1);
    expect(imported[0].status).toBe('unsupported');
    expect(imported[0].chunkCount).toBe(0);
    expect(imported[0].statusDetail).toContain('No extractor is available yet');
    expect(store.search('task-2', 'pdf')).toEqual([]);
  });
});
