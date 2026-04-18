// ═══════════════════════════════════════════════════════════════════════════
// Terminal Session Store — Persistent terminal data across sessions
// ═══════════════════════════════════════════════════════════════════════════

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

const DATA_FILE = 'terminal-data.json';

function getDataPath(): string {
  return path.join(app.getPath('userData'), DATA_FILE);
}

export type PersistedTerminalData = {
  lastCwd: string | null;
  shell: string;
};

function createDefaults(): PersistedTerminalData {
  return {
    lastCwd: null,
    shell: '',
  };
}

export function loadTerminalData(): PersistedTerminalData {
  try {
    const filePath = getDataPath();
    if (!fs.existsSync(filePath)) return createDefaults();
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      lastCwd: typeof parsed.lastCwd === 'string' ? parsed.lastCwd : null,
      shell: typeof parsed.shell === 'string' ? parsed.shell : '',
    };
  } catch {
    return createDefaults();
  }
}

export function saveTerminalData(data: PersistedTerminalData): void {
  try {
    const filePath = getDataPath();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to persist terminal data:', err);
  }
}
