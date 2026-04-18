import * as fs from 'fs';
import * as crypto from 'crypto';
import * as path from 'path';
import {
  ArtifactActor,
  ArtifactMetadataPatch,
  ArtifactRecord,
  CreateArtifactInput,
} from '../../shared/types/artifacts';
import { appStateStore } from '../state/appStateStore';
import { ActionType } from '../state/actions';
import { runtimeLedgerStore } from '../models/runtimeLedgerStore';
import {
  ensureArtifactWorkingFile,
  getArtifactDirectory,
  ensureArtifactsRoot,
  isPathInArtifactDirectory,
} from './storage';

function cloneArtifact(record: ArtifactRecord): ArtifactRecord {
  return {
    ...record,
    linkedTaskIds: [...record.linkedTaskIds],
  };
}

function findTask(taskId: string): boolean {
  return appStateStore.getState().tasks.some((task) => task.id === taskId);
}

function assertTaskExists(taskId: string): void {
  if (!findTask(taskId)) {
    throw new Error(`Task not found: ${taskId}`);
  }
}

function normalizeCsvRows(content: string): string {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
}

export class ArtifactService {
  constructor() {
    ensureArtifactsRoot();
  }

  createArtifact(input: CreateArtifactInput): ArtifactRecord {
    const title = input.title.trim();
    if (!title) {
      throw new Error('Artifact title is required');
    }

    if (input.taskId) {
      assertTaskExists(input.taskId);
    }

    const artifactId = crypto.randomUUID();
    const now = Date.now();
    const linkedTaskIds = input.taskId ? [input.taskId] : [];
    const workingPath = ensureArtifactWorkingFile({
      artifactId,
      title,
      format: input.format,
    });

    const record: ArtifactRecord = {
      id: artifactId,
      title,
      format: input.format,
      workingPath: path.resolve(workingPath),
      sourcePath: input.sourcePath ? path.resolve(input.sourcePath) : undefined,
      createdBy: input.createdBy,
      lastUpdatedBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      status: 'created',
      linkedTaskIds,
      previewable: true,
      exportable: true,
      archived: false,
    };

    appStateStore.dispatch({ type: ActionType.ADD_ARTIFACT, artifact: record });
    if (input.taskId) {
      appStateStore.dispatch({ type: ActionType.LINK_TASK_ARTIFACT, taskId: input.taskId, artifactId });
    }
    appStateStore.dispatch({ type: ActionType.SET_ACTIVE_ARTIFACT, artifactId });
    runtimeLedgerStore.recordArtifactEvent({
      taskId: input.taskId ?? null,
      summary: `Created artifact ${title} (${input.format})`,
      metadata: { artifactId, action: 'create', format: input.format },
    });
    return cloneArtifact(record);
  }

  getArtifact(id: string): ArtifactRecord | null {
    const record = appStateStore.getState().artifacts.find((artifact) => artifact.id === id);
    return record ? cloneArtifact(record) : null;
  }

  listArtifacts(): ArtifactRecord[] {
    return appStateStore.getState().artifacts
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(cloneArtifact);
  }

  updateArtifactMetadata(id: string, patch: ArtifactMetadataPatch): ArtifactRecord {
    const existing = this.getArtifact(id);
    if (!existing) {
      throw new Error(`Artifact not found: ${id}`);
    }

    const nextPatch: ArtifactMetadataPatch = { ...patch };
    if (typeof nextPatch.title === 'string') {
      const trimmed = nextPatch.title.trim();
      if (!trimmed) throw new Error('Artifact title cannot be empty');
      nextPatch.title = trimmed;
    }
    if (typeof nextPatch.sourcePath === 'string' && nextPatch.sourcePath.trim()) {
      nextPatch.sourcePath = path.resolve(nextPatch.sourcePath);
    }
    if (nextPatch.archived === true) {
      nextPatch.status = 'archived';
    }

    appStateStore.dispatch({
      type: ActionType.UPDATE_ARTIFACT,
      artifactId: id,
      patch: {
        ...nextPatch,
        updatedAt: Date.now(),
      },
    });
    runtimeLedgerStore.recordArtifactEvent({
      taskId: existing.linkedTaskIds[0] ?? null,
      summary: `Updated artifact metadata for ${nextPatch.title || existing.title}`,
      metadata: { artifactId: id, action: 'metadata-update' },
    });

    return this.getArtifact(id)!;
  }

  linkArtifactToTask(artifactId: string, taskId: string): ArtifactRecord {
    const artifact = this.getArtifact(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }
    assertTaskExists(taskId);
    if (artifact.linkedTaskIds.includes(taskId)) {
      return artifact;
    }

    appStateStore.dispatch({
      type: ActionType.UPDATE_ARTIFACT,
      artifactId,
      patch: {
        linkedTaskIds: [...artifact.linkedTaskIds, taskId],
        updatedAt: Date.now(),
      },
    });
    appStateStore.dispatch({ type: ActionType.LINK_TASK_ARTIFACT, taskId, artifactId });
    runtimeLedgerStore.recordArtifactEvent({
      taskId,
      summary: `Linked artifact ${artifact.title} to task ${taskId}`,
      metadata: { artifactId, action: 'link-task' },
    });
    return this.getArtifact(artifactId)!;
  }

  setActiveArtifact(artifactId: string | null): ArtifactRecord | null {
    if (artifactId !== null && !this.getArtifact(artifactId)) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }
    appStateStore.dispatch({ type: ActionType.SET_ACTIVE_ARTIFACT, artifactId });
    const active = artifactId ? this.getArtifact(artifactId) : null;
    runtimeLedgerStore.recordArtifactEvent({
      taskId: active?.linkedTaskIds[0] ?? null,
      summary: active ? `Activated artifact ${active.title}` : 'Cleared active artifact',
      metadata: { artifactId, action: 'set-active' },
    });
    return this.getActiveArtifact();
  }

  getActiveArtifact(): ArtifactRecord | null {
    const activeArtifactId = appStateStore.getState().activeArtifactId;
    return activeArtifactId ? this.getArtifact(activeArtifactId) : null;
  }

  deleteArtifact(artifactId: string, _deletedBy?: ArtifactActor): { deletedArtifactId: string; nextActiveArtifact: ArtifactRecord | null } {
    const artifact = this.getArtifact(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    const artifactDirectory = getArtifactDirectory(artifact.id);
    if (!isPathInArtifactDirectory(artifact.id, artifact.workingPath)) {
      throw new Error(`Artifact working path escapes managed storage: ${artifact.workingPath}`);
    }

    if (fs.existsSync(artifactDirectory)) {
      fs.rmSync(artifactDirectory, { recursive: true, force: true });
    }

    appStateStore.dispatch({ type: ActionType.DELETE_ARTIFACT, artifactId: artifact.id });
    runtimeLedgerStore.recordArtifactEvent({
      taskId: artifact.linkedTaskIds[0] ?? null,
      summary: `Deleted artifact ${artifact.title}`,
      metadata: { artifactId: artifact.id, action: 'delete' },
    });

    const remainingArtifacts = this.listArtifacts().filter((entry) => entry.id !== artifact.id);
    const nextActiveArtifact = remainingArtifacts[0] ?? null;
    appStateStore.dispatch({ type: ActionType.SET_ACTIVE_ARTIFACT, artifactId: nextActiveArtifact?.id ?? null });
    return {
      deletedArtifactId: artifact.id,
      nextActiveArtifact,
    };
  }

  readContent(artifactId: string): { artifact: ArtifactRecord; content: string } {
    const artifact = this.getArtifact(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }
    if (!isPathInArtifactDirectory(artifact.id, artifact.workingPath)) {
      throw new Error(`Artifact working path escapes managed storage: ${artifact.workingPath}`);
    }
    const content = fs.existsSync(artifact.workingPath)
      ? fs.readFileSync(artifact.workingPath, 'utf-8')
      : '';
    return { artifact, content };
  }

  readActiveArtifactContent(): { artifact: ArtifactRecord; content: string } {
    const active = this.getActiveArtifact();
    if (!active) throw new Error('No active artifact is selected.');
    return this.readContent(active.id);
  }

  replaceContent(artifactId: string, content: string, updatedBy?: ArtifactActor): ArtifactRecord {
    if (typeof content !== 'string') {
      throw new Error('Artifact content must be a string');
    }
    const artifact = this.requireWritableArtifact(artifactId);
    const actor = this.resolveUpdatedBy(updatedBy);

    this.beginWrite(artifact.id, actor);
    try {
      fs.writeFileSync(artifact.workingPath, content, 'utf-8');
      this.finishWrite(artifact.id, actor);
      this.linkArtifactIfTaskActor(artifact.id, actor);
      runtimeLedgerStore.recordArtifactEvent({
        taskId: this.getArtifact(artifact.id)?.linkedTaskIds[0] ?? null,
        summary: `Replaced content for artifact ${artifact.title}`,
        metadata: { artifactId: artifact.id, action: 'replace-content', actor },
      });
      return this.getArtifact(artifact.id)!;
    } catch (error) {
      this.failWrite(artifact.id, actor);
      throw error;
    }
  }

  appendContent(artifactId: string, content: string, updatedBy?: ArtifactActor): ArtifactRecord {
    if (typeof content !== 'string') {
      throw new Error('Artifact content must be a string');
    }
    const artifact = this.requireWritableArtifact(artifactId);
    const actor = this.resolveUpdatedBy(updatedBy);
    if (artifact.format === 'html') {
      throw new Error('Append is not supported for html artifacts.');
    }
    if (artifact.format !== 'md' && artifact.format !== 'txt' && artifact.format !== 'csv') {
      throw new Error(`Append is not supported for ${artifact.format} artifacts.`);
    }

    this.beginWrite(artifact.id, actor);
    try {
      if (artifact.format === 'csv') {
        const rows = normalizeCsvRows(content);
        const existing = fs.existsSync(artifact.workingPath)
          ? fs.readFileSync(artifact.workingPath, 'utf-8')
          : '';
        const prefix = existing.length > 0 && rows.length > 0 && !existing.endsWith('\n') ? '\n' : '';
        fs.appendFileSync(artifact.workingPath, `${prefix}${rows}`, 'utf-8');
      } else {
        fs.appendFileSync(artifact.workingPath, content, 'utf-8');
      }
      this.finishWrite(artifact.id, actor);
      this.linkArtifactIfTaskActor(artifact.id, actor);
      runtimeLedgerStore.recordArtifactEvent({
        taskId: this.getArtifact(artifact.id)?.linkedTaskIds[0] ?? null,
        summary: `Appended content to artifact ${artifact.title}`,
        metadata: { artifactId: artifact.id, action: 'append-content', actor },
      });
      return this.getArtifact(artifact.id)!;
    } catch (error) {
      this.failWrite(artifact.id, actor);
      throw error;
    }
  }

  replaceActiveArtifactContent(content: string, updatedBy?: ArtifactActor): ArtifactRecord {
    const active = this.getActiveArtifact();
    if (!active) throw new Error('No active artifact is selected.');
    return this.replaceContent(active.id, content, updatedBy);
  }

  appendActiveArtifactContent(content: string, updatedBy?: ArtifactActor): ArtifactRecord {
    const active = this.getActiveArtifact();
    if (!active) throw new Error('No active artifact is selected.');
    return this.appendContent(active.id, content, updatedBy);
  }

  private requireWritableArtifact(artifactId: string): ArtifactRecord {
    const artifact = this.getArtifact(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }
    if (artifact.archived || artifact.status === 'archived') {
      throw new Error(`Artifact is archived: ${artifactId}`);
    }
    if (!isPathInArtifactDirectory(artifact.id, artifact.workingPath)) {
      throw new Error(`Artifact working path escapes managed storage: ${artifact.workingPath}`);
    }
    return artifact;
  }

  private resolveUpdatedBy(updatedBy?: ArtifactActor): ArtifactActor {
    if (typeof updatedBy === 'string' && updatedBy.trim()) {
      return updatedBy.trim();
    }
    return appStateStore.getState().activeTaskId || 'system';
  }

  private beginWrite(artifactId: string, actor: ArtifactActor): void {
    appStateStore.dispatch({
      type: ActionType.UPDATE_ARTIFACT,
      artifactId,
      patch: {
        status: 'updating',
        lastUpdatedBy: actor,
        updatedAt: Date.now(),
      },
    });
  }

  private finishWrite(artifactId: string, actor: ArtifactActor): void {
    appStateStore.dispatch({
      type: ActionType.UPDATE_ARTIFACT,
      artifactId,
      patch: {
        status: 'active',
        lastUpdatedBy: actor,
        updatedAt: Date.now(),
      },
    });
  }

  private failWrite(artifactId: string, actor: ArtifactActor): void {
    appStateStore.dispatch({
      type: ActionType.UPDATE_ARTIFACT,
      artifactId,
      patch: {
        status: 'failed',
        lastUpdatedBy: actor,
        updatedAt: Date.now(),
      },
    });
  }

  private linkArtifactIfTaskActor(artifactId: string, actor: ArtifactActor): void {
    if (actor !== 'user' && actor !== 'system' && findTask(actor)) {
      this.linkArtifactToTask(artifactId, actor);
    }
  }
}

export const artifactService = new ArtifactService();
