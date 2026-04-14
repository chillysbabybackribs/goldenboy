import type { AgentToolDefinition } from '../AgentTypes';
import { documentAttachmentStore } from '../../attachments/DocumentAttachmentStore';

function objectInput(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? input as Record<string, unknown> : {};
}

function requireTaskId(taskId?: string): string {
  if (!taskId) throw new Error('Document attachment tools require an active task id.');
  return taskId;
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Expected non-empty string input: ${key}`);
  }
  return value;
}

function optionalNumber(input: Record<string, unknown>, key: string, fallback: number): number {
  const value = input[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export const DOCUMENT_ATTACHMENT_TOOL_NAMES = [
  'attachments.list',
  'attachments.search',
  'attachments.read_chunk',
  'attachments.read_document',
  'attachments.stats',
] as const;

export function createAttachmentToolDefinitions(): AgentToolDefinition[] {
  return [
    {
      name: 'attachments.list',
      description: 'List document attachments staged for the current task, including indexing status and short excerpts.',
      inputSchema: { type: 'object', properties: {} },
      async execute(_input, context) {
        const taskId = requireTaskId(context.taskId);
        const documents = documentAttachmentStore.listTaskDocuments(taskId);
        return {
          summary: `Found ${documents.length} staged document attachments`,
          data: { taskId, documents },
        };
      },
    },
    {
      name: 'attachments.search',
      description: 'Search indexed task document attachments for relevant passages. Use before reading full chunks.',
      inputSchema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string' },
          limit: { type: 'number' },
        },
      },
      async execute(input, context) {
        const taskId = requireTaskId(context.taskId);
        const obj = objectInput(input);
        const query = requireString(obj, 'query');
        const results = documentAttachmentStore.search(taskId, query, {
          limit: optionalNumber(obj, 'limit', 8),
        });
        return {
          summary: `Found ${results.length} matching document chunks`,
          data: { taskId, query, results },
        };
      },
    },
    {
      name: 'attachments.read_chunk',
      description: 'Read a specific indexed document chunk by chunk id.',
      inputSchema: {
        type: 'object',
        required: ['chunkId'],
        properties: {
          chunkId: { type: 'string' },
          maxChars: { type: 'number' },
        },
      },
      async execute(input, context) {
        const taskId = requireTaskId(context.taskId);
        const obj = objectInput(input);
        const chunkId = requireString(obj, 'chunkId');
        const chunk = documentAttachmentStore.readChunk(taskId, chunkId, optionalNumber(obj, 'maxChars', 3000));
        if (!chunk) throw new Error(`Document chunk not found: ${chunkId}`);
        return {
          summary: `Read document chunk ${chunk.id}`,
          data: chunk,
        };
      },
    },
    {
      name: 'attachments.read_document',
      description: 'Read a staged document attachment by document id. Prefer attachments.search plus attachments.read_chunk for large files.',
      inputSchema: {
        type: 'object',
        required: ['documentId'],
        properties: {
          documentId: { type: 'string' },
          maxChars: { type: 'number' },
        },
      },
      async execute(input, context) {
        const taskId = requireTaskId(context.taskId);
        const obj = objectInput(input);
        const documentId = requireString(obj, 'documentId');
        const result = documentAttachmentStore.readDocument(taskId, documentId, optionalNumber(obj, 'maxChars', 4000));
        if (!result) throw new Error(`Document attachment not found: ${documentId}`);
        return {
          summary: `Read document attachment ${result.document.name}`,
          data: result,
        };
      },
    },
    {
      name: 'attachments.stats',
      description: 'Return counts and token estimates for staged task document attachments.',
      inputSchema: { type: 'object', properties: {} },
      async execute(_input, context) {
        const taskId = requireTaskId(context.taskId);
        const stats = documentAttachmentStore.getStats(taskId);
        return {
          summary: `Document attachments: ${stats.documentCount} files, ${stats.chunkCount} chunks`,
          data: stats,
        };
      },
    },
  ];
}
