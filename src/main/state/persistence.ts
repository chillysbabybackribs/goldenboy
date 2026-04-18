import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { AppState, createDefaultAppState, ExecutionSplitState, TaskRecord } from '../../shared/types/appState';
import { ArtifactRecord, isArtifactFormat, isArtifactStatus } from '../../shared/types/artifacts';
import { PHYSICAL_WINDOW_ROLES, PhysicalWindowRole } from '../../shared/types/windowRoles';
import { isProviderId } from '../../shared/types/model';

const STATE_FILE = 'workspace-state.json';

function getStatePath(): string {
  return path.join(app.getPath('userData'), STATE_FILE);
}

type PersistedTaskRecord = {
  id: string;
  title: string;
  status: string;
  owner: string;
  artifactIds?: string[];
  createdAt: number;
  updatedAt: number;
};

type PersistedArtifactRecord = ArtifactRecord;

type PersistedState = {
  executionSplit: ExecutionSplitState;
  windows: AppState['windows'];
  tasks?: PersistedTaskRecord[];
  activeTaskId?: string | null;
  artifacts?: PersistedArtifactRecord[];
  activeArtifactId?: string | null;
  tokenUsage?: { inputTokens: number; outputTokens: number };
};

export function loadPersistedState(): Partial<PersistedState> {
  try {
    const filePath = getStatePath();
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);

    // Migration: if the persisted state has old 3-window roles (browser/terminal/command)
    // but not the new 2-window roles (command/execution), migrate cleanly
    if (parsed.windows) {
      const hasOldRoles = 'browser' in parsed.windows || 'terminal' in parsed.windows;
      const hasNewRoles = 'execution' in parsed.windows;

      if (hasOldRoles && !hasNewRoles) {
        // Old format — discard window positions, keep split state if any
        return {
          executionSplit: parsed.executionSplit ?? undefined,
        };
      }
    }

    // Validate the persisted split state
    if (parsed.executionSplit) {
      const ratio = parsed.executionSplit.ratio;
      if (typeof ratio !== 'number' || ratio < 0.1 || ratio > 0.9) {
        parsed.executionSplit.ratio = 0.5;
      }
      const validPresets = ['balanced', 'focus-browser', 'focus-terminal'];
      if (!validPresets.includes(parsed.executionSplit.preset)) {
        parsed.executionSplit.preset = 'balanced';
      }
    }

    return parsed as PersistedState;
  } catch {
    return {};
  }
}

export function savePersistedState(state: AppState): void {
  try {
    const persisted: PersistedState = {
      executionSplit: state.executionSplit,
      windows: state.windows,
      tasks: state.tasks.map(t => ({
        id: t.id,
        title: t.title,
        status: t.status,
        owner: t.owner,
        artifactIds: t.artifactIds,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      })),
      activeTaskId: state.activeTaskId,
      artifacts: state.artifacts,
      activeArtifactId: state.activeArtifactId,
      tokenUsage: state.tokenUsage,
    };
    const filePath = getStatePath();
    fs.writeFileSync(filePath, JSON.stringify(persisted, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to persist state:', err);
  }
}

function normalizePersistedTaskOwner(owner: string): TaskRecord['owner'] {
  if (owner === 'user') return 'user';
  if (isProviderId(owner)) return owner;
  return 'user';
}

function normalizePersistedArtifacts(records: PersistedArtifactRecord[] | undefined): ArtifactRecord[] {
  if (!Array.isArray(records)) return [];
  return records.filter((record): record is ArtifactRecord => {
    return Boolean(
      record
      && typeof record.id === 'string'
      && typeof record.title === 'string'
      && typeof record.workingPath === 'string'
      && typeof record.createdBy === 'string'
      && typeof record.lastUpdatedBy === 'string'
      && typeof record.createdAt === 'number'
      && typeof record.updatedAt === 'number'
      && typeof record.previewable === 'boolean'
      && typeof record.exportable === 'boolean'
      && typeof record.archived === 'boolean'
      && Array.isArray(record.linkedTaskIds)
      && isArtifactFormat(record.format)
      && isArtifactStatus(record.status)
    );
  });
}

export function buildInitialState(): AppState {
  const defaults = createDefaultAppState();
  const persisted = loadPersistedState();

  // Merge only valid window roles
  let windows = defaults.windows;
  if (persisted.windows) {
    const merged: Record<string, any> = { ...defaults.windows };
    for (const role of PHYSICAL_WINDOW_ROLES as readonly PhysicalWindowRole[]) {
      if (persisted.windows[role]) {
        merged[role] = { ...defaults.windows[role], ...persisted.windows[role] };
      }
    }
    windows = merged as AppState['windows'];
  }

  // Restore persisted tasks
  let tasks = defaults.tasks;
  let activeTaskId = defaults.activeTaskId;
  if (persisted.tasks && Array.isArray(persisted.tasks)) {
    tasks = persisted.tasks
      .filter(t => t && t.id && t.title)
      .map(t => ({
        id: t.id,
        title: t.title,
        status: (t.status === 'running' ? 'completed' : t.status) as TaskRecord['status'],
        owner: normalizePersistedTaskOwner(t.owner),
        artifactIds: Array.isArray(t.artifactIds) ? t.artifactIds.filter((artifactId): artifactId is string => typeof artifactId === 'string') : [],
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      } as TaskRecord));
    // Restore active task only if it still exists
    if (persisted.activeTaskId && tasks.some(t => t.id === persisted.activeTaskId)) {
      activeTaskId = persisted.activeTaskId;
    }
  }

  // Restore persisted token usage
  const tokenUsage = (persisted.tokenUsage &&
    typeof persisted.tokenUsage.inputTokens === 'number' &&
    typeof persisted.tokenUsage.outputTokens === 'number')
    ? persisted.tokenUsage
    : defaults.tokenUsage;

  const artifacts = normalizePersistedArtifacts(persisted.artifacts);
  const activeArtifactId = persisted.activeArtifactId && artifacts.some((artifact) => artifact.id === persisted.activeArtifactId)
    ? persisted.activeArtifactId
    : defaults.activeArtifactId;

  return {
    ...defaults,
    executionSplit: persisted.executionSplit ?? defaults.executionSplit,
    windows,
    tasks,
    activeTaskId,
    artifacts,
    activeArtifactId,
    tokenUsage,
  };
}
