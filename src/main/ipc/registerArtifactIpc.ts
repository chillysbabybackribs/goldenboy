import type { IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '../../shared/types/ipc';
import type { CreateArtifactInput } from '../../shared/types/artifacts';
import { artifactService } from '../artifacts/ArtifactService';

type SafeHandle = <TEventArgs extends unknown[], TResult>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: TEventArgs) => Promise<TResult> | TResult,
) => void;

export function registerArtifactIpc(safeHandle: SafeHandle): void {
  safeHandle(IPC_CHANNELS.ARTIFACT_CREATE, (_event, input: CreateArtifactInput) => {
    return artifactService.createArtifact(input);
  });

  safeHandle(IPC_CHANNELS.ARTIFACT_GET, (_event, artifactId: string) => {
    return artifactService.getArtifact(artifactId);
  });

  safeHandle(IPC_CHANNELS.ARTIFACT_LIST, () => {
    return artifactService.listArtifacts();
  });

  safeHandle(IPC_CHANNELS.ARTIFACT_SET_ACTIVE, (_event, artifactId: string | null) => {
    return artifactService.setActiveArtifact(artifactId);
  });

  safeHandle(IPC_CHANNELS.ARTIFACT_GET_ACTIVE, () => {
    return artifactService.getActiveArtifact();
  });

  safeHandle(IPC_CHANNELS.ARTIFACT_DELETE, (_event, input: { artifactId: string; deletedBy?: string }) => {
    if (typeof input?.artifactId !== 'string' || !input.artifactId.trim()) {
      throw new Error('artifact.delete requires a valid artifact id.');
    }
    return artifactService.deleteArtifact(input.artifactId, input.deletedBy);
  });

  safeHandle(IPC_CHANNELS.ARTIFACT_REPLACE_CONTENT, (_event, input: { artifactId?: string | null; content: string; updatedBy?: string }) => {
    if (typeof input?.content !== 'string') {
      throw new Error('Artifact replaceContent requires string content.');
    }
    return input?.artifactId
      ? artifactService.replaceContent(input.artifactId, input.content, input.updatedBy)
      : artifactService.replaceActiveArtifactContent(input.content, input.updatedBy);
  });

  safeHandle(IPC_CHANNELS.ARTIFACT_APPEND_CONTENT, (_event, input: { artifactId?: string | null; content: string; updatedBy?: string }) => {
    if (typeof input?.content !== 'string') {
      throw new Error('Artifact appendContent requires string content.');
    }
    return input?.artifactId
      ? artifactService.appendContent(input.artifactId, input.content, input.updatedBy)
      : artifactService.appendActiveArtifactContent(input.content, input.updatedBy);
  });
}
