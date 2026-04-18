"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createChatToolDefinitions = createChatToolDefinitions;
const ChatKnowledgeStore_1 = require("../../chatKnowledge/ChatKnowledgeStore");
const appStateStore_1 = require("../../state/appStateStore");
const actions_1 = require("../../state/actions");
const ids_1 = require("../../../shared/utils/ids");
function objectInput(input) {
    return typeof input === 'object' && input !== null ? input : {};
}
function requireTaskId(taskId) {
    if (!taskId)
        throw new Error('Chat memory is unavailable because this agent run has no task id.');
    return taskId;
}
function requireString(input, key) {
    const value = input[key];
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`Expected non-empty string input: ${key}`);
    }
    return value;
}
function optionalString(input, key) {
    const value = input[key];
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}
function optionalNumber(input, key, fallback) {
    const value = input[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function optionalBoolean(input, key, fallback) {
    const value = input[key];
    return typeof value === 'boolean' ? value : fallback;
}
function optionalRole(input) {
    const value = optionalString(input, 'role');
    if (!value)
        return undefined;
    if (value === 'user' || value === 'assistant' || value === 'tool' || value === 'system')
        return value;
    throw new Error(`Invalid chat role: ${value}`);
}
function logChatRecall(message, level = 'info') {
    appStateStore_1.appStateStore.dispatch({
        type: actions_1.ActionType.ADD_LOG,
        log: {
            id: (0, ids_1.generateId)('log'),
            timestamp: Date.now(),
            level,
            source: 'system',
            message,
        },
    });
}
function createChatToolDefinitions() {
    return [
        {
            name: 'chat.thread_summary',
            description: 'Return the compact summary and index of the current chat thread. Use this before deeper recall when you need orientation.',
            inputSchema: { type: 'object' },
            async execute(_input, context) {
                const taskId = requireTaskId(context.taskId);
                const summary = ChatKnowledgeStore_1.chatKnowledgeStore.threadSummary(taskId) || 'No chat memory summary is available yet.';
                logChatRecall('Read chat thread summary');
                return {
                    summary: 'Read chat thread summary',
                    data: { taskId, summary },
                };
            },
        },
        {
            name: 'chat.read_last',
            description: 'Read the last messages in the current chat thread. Use for immediate follow-ups like continue, do that, same approach, or what about the previous result.',
            inputSchema: {
                type: 'object',
                properties: {
                    count: { type: 'number' },
                    maxChars: { type: 'number' },
                    role: { type: 'string', enum: ['user', 'assistant', 'tool', 'system'] },
                },
            },
            async execute(input, context) {
                const taskId = requireTaskId(context.taskId);
                const obj = objectInput(input);
                const result = ChatKnowledgeStore_1.chatKnowledgeStore.readLast(taskId, {
                    count: optionalNumber(obj, 'count', 2),
                    maxChars: optionalNumber(obj, 'maxChars', 3000),
                    role: optionalRole(obj),
                });
                logChatRecall(`Read last ${result.messages.length} chat messages (~${result.tokenEstimate} tokens)`);
                return {
                    summary: `Read ${result.messages.length} recent chat messages`,
                    data: result,
                };
            },
        },
        {
            name: 'chat.search',
            description: 'Search cached chat history by query. Returns snippets and message ids; use chat.read_window or chat.read_message for full context.',
            inputSchema: {
                type: 'object',
                required: ['query'],
                properties: {
                    query: { type: 'string' },
                    role: { type: 'string', enum: ['user', 'assistant', 'tool', 'system'] },
                    includeTools: { type: 'boolean' },
                    limit: { type: 'number' },
                    maxSnippetChars: { type: 'number' },
                },
            },
            async execute(input, context) {
                const taskId = requireTaskId(context.taskId);
                const obj = objectInput(input);
                const query = requireString(obj, 'query');
                const result = ChatKnowledgeStore_1.chatKnowledgeStore.search(taskId, {
                    query,
                    role: optionalRole(obj),
                    includeTools: optionalBoolean(obj, 'includeTools', false),
                    limit: optionalNumber(obj, 'limit', 5),
                    maxSnippetChars: optionalNumber(obj, 'maxSnippetChars', 420),
                });
                logChatRecall(`Chat search ${result.results.length > 0 ? 'hit' : 'miss'} for "${query}" (${result.results.length} matches)`, result.results.length > 0 ? 'info' : 'warn');
                return {
                    summary: `Found ${result.results.length} chat matches`,
                    data: result,
                };
            },
        },
        {
            name: 'chat.read_message',
            description: 'Read one full cached chat message by message id. Prefer this after chat.search returns a specific relevant id.',
            inputSchema: {
                type: 'object',
                required: ['messageId'],
                properties: {
                    messageId: { type: 'string' },
                    maxChars: { type: 'number' },
                },
            },
            async execute(input, context) {
                const taskId = requireTaskId(context.taskId);
                const obj = objectInput(input);
                const messageId = requireString(obj, 'messageId');
                const result = ChatKnowledgeStore_1.chatKnowledgeStore.readMessage(taskId, messageId, optionalNumber(obj, 'maxChars', 3000));
                if (!result)
                    throw new Error(`Chat message not found: ${messageId}`);
                logChatRecall(`Read chat message ${messageId} (~${result.tokenEstimate} tokens)`);
                return {
                    summary: `Read chat message ${messageId}`,
                    data: result,
                };
            },
        },
        {
            name: 'chat.read_window',
            description: 'Read a bounded message window around a cached chat message id. Use after chat.search when nearby turns are needed.',
            inputSchema: {
                type: 'object',
                properties: {
                    messageId: { type: 'string' },
                    before: { type: 'number' },
                    after: { type: 'number' },
                    maxChars: { type: 'number' },
                },
            },
            async execute(input, context) {
                const taskId = requireTaskId(context.taskId);
                const obj = objectInput(input);
                const result = ChatKnowledgeStore_1.chatKnowledgeStore.readWindow(taskId, {
                    messageId: optionalString(obj, 'messageId'),
                    before: optionalNumber(obj, 'before', 2),
                    after: optionalNumber(obj, 'after', 2),
                    maxChars: optionalNumber(obj, 'maxChars', 3000),
                });
                logChatRecall(`Read chat window with ${result.messages.length} messages (~${result.tokenEstimate} tokens)`);
                return {
                    summary: `Read ${result.messages.length} chat messages around selected context`,
                    data: result,
                };
            },
        },
        {
            name: 'chat.recall',
            description: 'Progressive chat memory recall. Uses recent messages for follow-ups and search plus window reads for older topic-specific context.',
            inputSchema: {
                type: 'object',
                required: ['query'],
                properties: {
                    query: { type: 'string' },
                    intent: { type: 'string' },
                    maxChars: { type: 'number' },
                },
            },
            async execute(input, context) {
                const taskId = requireTaskId(context.taskId);
                const obj = objectInput(input);
                const query = requireString(obj, 'query');
                const result = ChatKnowledgeStore_1.chatKnowledgeStore.recall(taskId, {
                    query,
                    intent: optionalString(obj, 'intent'),
                    maxChars: optionalNumber(obj, 'maxChars', 3000),
                });
                logChatRecall(`Chat recall used ${result.strategy} for "${query}" (~${result.tokenEstimate} tokens)`);
                return {
                    summary: `Recalled chat context with ${result.strategy}`,
                    data: result,
                };
            },
        },
        {
            name: 'chat.cache_stats',
            description: 'Return chat cache size and token estimates for the current task.',
            inputSchema: { type: 'object' },
            async execute(_input, context) {
                const taskId = requireTaskId(context.taskId);
                const stats = ChatKnowledgeStore_1.chatKnowledgeStore.getStats(taskId);
                return {
                    summary: `Chat cache has ${stats.messageCount} messages`,
                    data: stats,
                };
            },
        },
    ];
}
//# sourceMappingURL=chatTools.js.map