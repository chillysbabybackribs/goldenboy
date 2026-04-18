"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.summarizeToolDefinitions = summarizeToolDefinitions;
exports.createUnrestrictedDevToolSchemas = createUnrestrictedDevToolSchemas;
const browserTools_1 = require("./tools/browserTools");
const chatTools_1 = require("./tools/chatTools");
const attachmentTools_1 = require("./tools/attachmentTools");
const filesystemTools_1 = require("./tools/filesystemTools");
const runtimeTools_1 = require("./tools/runtimeTools");
const terminalTools_1 = require("./tools/terminalTools");
const subagentTools_1 = require("./tools/subagentTools");
function summarizeToolDefinitions(tools) {
    return tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}
function createUnrestrictedDevToolSchemas(providerFactory) {
    return summarizeToolDefinitions([
        ...(0, attachmentTools_1.createAttachmentToolDefinitions)(),
        ...(0, runtimeTools_1.createRuntimeToolDefinitions)(),
        ...(0, browserTools_1.createBrowserToolDefinitions)(),
        ...(0, chatTools_1.createChatToolDefinitions)(),
        ...(0, filesystemTools_1.createFilesystemToolDefinitions)(),
        ...(0, terminalTools_1.createTerminalToolDefinitions)(),
        ...(0, subagentTools_1.createSubAgentToolDefinitions)(providerFactory),
    ]);
}
//# sourceMappingURL=AgentToolSchemas.js.map