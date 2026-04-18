import type { IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '../../shared/types/ipc';
import { documentService } from '../document/DocumentService';

type SafeHandle = <TEventArgs extends unknown[], TResult>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: TEventArgs) => Promise<TResult> | TResult,
) => void;

export function registerDocumentIpc(safeHandle: SafeHandle): void {
  safeHandle(IPC_CHANNELS.DOCUMENT_OPEN_ARTIFACT, (_event, artifactId: string) => {
    if (typeof artifactId !== 'string' || !artifactId.trim()) {
      throw new Error('document.openArtifact requires a valid artifact id.');
    }
    return documentService.openArtifact(artifactId);
  });

  safeHandle(IPC_CHANNELS.DOCUMENT_GET_CURRENT, () => {
    return documentService.getCurrentArtifactView();
  });

  safeHandle(IPC_CHANNELS.DOCUMENT_GET_ARTIFACT, (_event, artifactId: string) => {
    if (typeof artifactId !== 'string' || !artifactId.trim()) {
      throw new Error('document.getArtifact requires a valid artifact id.');
    }
    return documentService.getArtifactView(artifactId);
  });

  safeHandle(IPC_CHANNELS.DOCUMENT_LIST_ARTIFACTS, () => {
    return documentService.listArtifacts();
  });

  safeHandle(IPC_CHANNELS.DOCUMENT_SET_CURRENT, (_event, artifactId: string | null) => {
    if (artifactId !== null && (typeof artifactId !== 'string' || !artifactId.trim())) {
      throw new Error('document.setCurrent requires a valid artifact id or null.');
    }
    return documentService.setCurrentArtifact(artifactId);
  });
}
