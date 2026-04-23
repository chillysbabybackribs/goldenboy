export type CodeHeatmapNodeKind = 'file' | 'directory';

export type CodeHeatmapNode = {
  kind: CodeHeatmapNodeKind;
  path: string;
  editCount: number;
  lastEditedAt: number;
  intensity: number;
};

export type CodeHeatmapEditEvent = {
  path: string;
  timestamp: number;
};

export type CodeHeatmapSnapshot = {
  root: string;
  watching: boolean;
  startedAt: number | null;
  updatedAt: number | null;
  totalEdits: number;
  watchedDirectoryCount: number;
  ignoredPaths: string[];
  hottestFiles: CodeHeatmapNode[];
  hottestDirectories: CodeHeatmapNode[];
  recentEdits: CodeHeatmapEditEvent[];
};
