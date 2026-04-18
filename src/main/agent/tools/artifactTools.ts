import type { AgentToolDefinition } from '../AgentTypes';
import { artifactService } from '../../artifacts/ArtifactService';
import { isArtifactFormat } from '../../../shared/types/artifacts';

function objectInput(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? input as Record<string, unknown> : {};
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Expected non-empty string input: ${key}`);
  }
  return value;
}

function requireContentString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string') {
    throw new Error(`Expected string input: ${key}`);
  }
  return value;
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function optionalNumber(input: Record<string, unknown>, key: string, fallback: number): number {
  const value = input[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function trimContent(content: string, maxChars: number): { content: string; truncated: boolean } {
  if (content.length <= maxChars) return { content, truncated: false };
  return {
    content: `${content.slice(0, maxChars)}\n...[artifact content truncated]`,
    truncated: true,
  };
}

function requireFormat(input: Record<string, unknown>, key: string) {
  const format = requireString(input, key).toLowerCase();
  if (!isArtifactFormat(format)) {
    throw new Error(`Unsupported artifact format: ${format}`);
  }
  return format;
}

function resolveArtifactId(input: Record<string, unknown>): string | null {
  const artifactId = optionalString(input, 'artifactId');
  return artifactId ?? null;
}

function resolveActor(taskId?: string): string {
  return taskId || 'system';
}

function toToolArtifact(artifact: {
  id: string;
  title: string;
  format: string;
  createdBy: string;
  lastUpdatedBy: string;
  createdAt: number;
  updatedAt: number;
  status: string;
  linkedTaskIds: string[];
  previewable: boolean;
  exportable: boolean;
  archived: boolean;
}) {
  return {
    id: artifact.id,
    title: artifact.title,
    format: artifact.format,
    createdBy: artifact.createdBy,
    lastUpdatedBy: artifact.lastUpdatedBy,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
    status: artifact.status,
    linkedTaskIds: [...artifact.linkedTaskIds],
    previewable: artifact.previewable,
    exportable: artifact.exportable,
    archived: artifact.archived,
  };
}

function selectArtifactRecord(input: Record<string, unknown>) {
  const artifactId = resolveArtifactId(input);
  return artifactId
    ? artifactService.getArtifact(artifactId)
    : artifactService.getActiveArtifact();
}

export const ARTIFACT_TOOL_NAMES = [
  'artifact.list',
  'artifact.get',
  'artifact.get_active',
  'artifact.read',
  'artifact.create',
  'artifact.delete',
  'artifact.replace_content',
  'artifact.append_content',
] as const;

export function createArtifactToolDefinitions(): AgentToolDefinition[] {
  return [
    {
      name: 'artifact.list',
      description: 'List workspace artifacts from the registry. Use this to discover existing artifacts before creating a new one.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number' },
        },
      },
      async execute(input) {
        const obj = objectInput(input);
        const limit = Math.max(1, Math.min(optionalNumber(obj, 'limit', 50), 200));
        const artifacts = artifactService.listArtifacts().slice(0, limit).map(toToolArtifact);
        return {
          summary: `Found ${artifacts.length} workspace artifacts`,
          data: { artifacts },
        };
      },
    },
    {
      name: 'artifact.get',
      description: 'Get workspace artifact metadata by id. If artifactId is omitted, returns the current active artifact.',
      inputSchema: {
        type: 'object',
        properties: {
          artifactId: { type: 'string' },
        },
      },
      async execute(input) {
        const obj = objectInput(input);
        const artifact = selectArtifactRecord(obj);
        if (!artifact) {
          throw new Error(resolveArtifactId(obj)
            ? `Artifact not found: ${resolveArtifactId(obj)}`
            : 'No active artifact is selected.');
        }
        return {
          summary: `Loaded artifact ${artifact.title}`,
          data: { artifact: toToolArtifact(artifact) },
        };
      },
    },
    {
      name: 'artifact.get_active',
      description: 'Get the current active artifact metadata. Use this for follow-up requests like "update this document".',
      inputSchema: { type: 'object', properties: {} },
      async execute() {
        const artifact = artifactService.getActiveArtifact();
        return {
          summary: artifact ? `Active artifact: ${artifact.title}` : 'No active artifact selected',
          data: { artifact: artifact ? toToolArtifact(artifact) : null },
        };
      },
    },
    {
      name: 'artifact.read',
      description: 'Read artifact content from managed workspace storage. If artifactId is omitted, reads the current active artifact.',
      inputSchema: {
        type: 'object',
        properties: {
          artifactId: { type: 'string' },
          maxChars: { type: 'number' },
        },
      },
      async execute(input) {
        const obj = objectInput(input);
        const artifactId = resolveArtifactId(obj);
        const result = artifactId
          ? artifactService.readContent(artifactId)
          : artifactService.readActiveArtifactContent();
        const trimmed = trimContent(result.content, Math.max(200, Math.min(optionalNumber(obj, 'maxChars', 8000), 20000)));
        return {
          summary: `Read artifact ${result.artifact.title}`,
          data: {
            artifact: toToolArtifact(result.artifact),
            content: trimmed.content,
            truncated: trimmed.truncated,
          },
        };
      },
    },
    {
      name: 'artifact.create',
      description: 'Create a managed workspace artifact. Use this instead of filesystem.write for supported workspace artifacts (md, txt, html, csv).',
      inputSchema: {
        type: 'object',
        required: ['title', 'format'],
        properties: {
          title: { type: 'string' },
          format: { type: 'string', enum: ['md', 'txt', 'html', 'csv'] },
          sourcePath: { type: 'string' },
        },
      },
      async execute(input, context) {
        const obj = objectInput(input);
        const artifact = artifactService.createArtifact({
          title: requireString(obj, 'title'),
          format: requireFormat(obj, 'format'),
          sourcePath: optionalString(obj, 'sourcePath'),
          createdBy: resolveActor(context.taskId),
          taskId: context.taskId,
        });
        return {
          summary: `Created ${artifact.title}`,
          data: { artifact: toToolArtifact(artifact) },
        };
      },
    },
    {
      name: 'artifact.delete',
      description: 'Delete a managed workspace artifact and remove its managed storage. Use this instead of filesystem.delete for supported workspace artifacts.',
      inputSchema: {
        type: 'object',
        properties: {
          artifactId: { type: 'string' },
        },
      },
      async execute(input, context) {
        const obj = objectInput(input);
        const artifact = selectArtifactRecord(obj);
        if (!artifact) {
          throw new Error(resolveArtifactId(obj)
            ? `Artifact not found: ${resolveArtifactId(obj)}`
            : 'No active artifact is selected.');
        }
        const deleted = artifactService.deleteArtifact(artifact.id, resolveActor(context.taskId));
        return {
          summary: `Deleted ${artifact.title}`,
          data: {
            deletedArtifactId: deleted.deletedArtifactId,
            nextActiveArtifact: deleted.nextActiveArtifact ? toToolArtifact(deleted.nextActiveArtifact) : null,
          },
        };
      },
    },
    {
      name: 'artifact.replace_content',
      description: 'Replace the full content of a managed artifact. If artifactId is omitted, replaces the current active artifact.',
      inputSchema: {
        type: 'object',
        required: ['content'],
        properties: {
          artifactId: { type: 'string' },
          content: { type: 'string' },
        },
      },
      async execute(input, context) {
        const obj = objectInput(input);
        const content = requireContentString(obj, 'content');
        const artifactId = resolveArtifactId(obj);
        const artifact = artifactId
          ? artifactService.replaceContent(artifactId, content, resolveActor(context.taskId))
          : artifactService.replaceActiveArtifactContent(content, resolveActor(context.taskId));
        return {
          summary: `Updated ${artifact.title}`,
          data: { artifact: toToolArtifact(artifact) },
        };
      },
    },
    {
      name: 'artifact.append_content',
      description: 'Append content to a managed artifact. Supported only for md, txt, and csv. If artifactId is omitted, appends to the current active artifact.',
      inputSchema: {
        type: 'object',
        required: ['content'],
        properties: {
          artifactId: { type: 'string' },
          content: { type: 'string' },
        },
      },
      async execute(input, context) {
        const obj = objectInput(input);
        const content = requireContentString(obj, 'content');
        const artifactId = resolveArtifactId(obj);
        const artifact = artifactId
          ? artifactService.appendContent(artifactId, content, resolveActor(context.taskId))
          : artifactService.appendActiveArtifactContent(content, resolveActor(context.taskId));
        return {
          summary: `Appended to ${artifact.title}`,
          data: { artifact: toToolArtifact(artifact) },
        };
      },
    },
  ];
}
