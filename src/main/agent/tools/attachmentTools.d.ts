import type { AgentToolDefinition } from '../AgentTypes';
export declare const DOCUMENT_ATTACHMENT_TOOL_NAMES: readonly ["attachments.list", "attachments.search", "attachments.read_chunk", "attachments.read_document", "attachments.stats"];
export declare function createAttachmentToolDefinitions(): AgentToolDefinition[];
