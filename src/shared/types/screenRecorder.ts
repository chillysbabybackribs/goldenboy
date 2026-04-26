export interface ScreenRecorderSource {
  id: string;
  displayId: string | null;
  name: string;
  thumbnailDataUrl: string | null;
}

export interface ScreenRecorderPendingFile {
  fileName: string;
  bytes: Uint8Array;
}

export interface ScreenRecorderSavedFile {
  fileName: string;
  path: string;
  byteLength: number;
}

export interface ScreenRecorderSaveResult {
  directory: string;
  files: ScreenRecorderSavedFile[];
}
