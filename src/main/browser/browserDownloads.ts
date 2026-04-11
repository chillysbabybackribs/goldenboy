// ═══════════════════════════════════════════════════════════════════════════
// Browser Downloads — Download lifecycle tracking for the browser surface
// ═══════════════════════════════════════════════════════════════════════════
//
// Downloads are saved to the user's default Downloads directory.
// Progress and completion are tracked and published to the event bus.

import { app } from 'electron';
import * as path from 'path';
import { BrowserDownloadState } from '../../shared/types/browser';
import { generateId } from '../../shared/utils/ids';

export function getDownloadDir(): string {
  return app.getPath('downloads');
}

export function createDownloadEntry(url: string, filename: string, savePath: string): BrowserDownloadState {
  return {
    id: generateId('dl'),
    filename,
    url,
    savePath,
    state: 'progressing',
    receivedBytes: 0,
    totalBytes: 0,
    startedAt: Date.now(),
  };
}

export function resolveDownloadPath(suggestedFilename: string): string {
  return path.join(getDownloadDir(), suggestedFilename);
}
