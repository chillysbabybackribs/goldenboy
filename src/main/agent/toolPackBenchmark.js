"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildToolPackBenchmarkReport = buildToolPackBenchmarkReport;
const AgentPromptBuilder_1 = require("./AgentPromptBuilder");
const browserTools_1 = require("./tools/browserTools");
const chatTools_1 = require("./tools/chatTools");
const attachmentTools_1 = require("./tools/attachmentTools");
const filesystemTools_1 = require("./tools/filesystemTools");
const runtimeTools_1 = require("./tools/runtimeTools");
const terminalTools_1 = require("./tools/terminalTools");
const subagentTools_1 = require("./tools/subagentTools");
const model_1 = require("../../shared/types/model");
const taskProfile_1 = require("./taskProfile");
const TASKS = [
    {
        kind: 'research',
        prompt: 'Search the web for the latest Anthropic model pricing',
    },
    {
        kind: 'implementation',
        prompt: 'Patch this TypeScript file and run the local build',
    },
    {
        kind: 'debug',
        prompt: 'Debug why the renderer build is failing with a TypeScript error',
    },
    {
        kind: 'review',
        prompt: 'Review this PR diff and identify regressions before merge',
    },
    {
        kind: 'orchestration',
        prompt: 'Split this repo-wide migration across sub-agents and coordinate the work',
    },
    {
        kind: 'general',
        prompt: 'Figure out the next step for this workspace task',
    },
];
function estimateTokens(textOrChars) {
    const chars = typeof textOrChars === 'string' ? textOrChars.length : textOrChars;
    return Math.ceil(chars / 4);
}
function createBenchmarkTools() {
    const providerFactory = () => ({
        async invoke() {
            throw new Error('benchmark stub provider should never be invoked');
        },
    });
    return [
        ...(0, attachmentTools_1.createAttachmentToolDefinitions)(),
        ...(0, runtimeTools_1.createRuntimeToolDefinitions)(),
        ...(0, browserTools_1.createBrowserToolDefinitions)(),
        ...(0, chatTools_1.createChatToolDefinitions)(),
        ...(0, filesystemTools_1.createFilesystemToolDefinitions)(),
        ...(0, terminalTools_1.createTerminalToolDefinitions)(),
        ...(0, subagentTools_1.createSubAgentToolDefinitions)(providerFactory),
    ];
}
function summarizeCategories(tools) {
    const counts = tools.reduce((acc, tool) => {
        const category = tool.name.split('.')[0];
        acc.set(category, (acc.get(category) || 0) + 1);
        return acc;
    }, new Map());
    return Array.from(counts.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([category, count]) => `${category}:${count}`)
        .join(' ');
}
function formatCodexToolSection(tools) {
    if (tools.length === 0)
        return 'No tools are available in this runtime.';
    return tools.map((tool) => {
        const schema = JSON.stringify(tool.inputSchema, null, 2);
        return [
            `- ${tool.name}`,
            `  Description: ${tool.description}`,
            `  Input schema: ${schema}`,
        ].join('\n');
    }).join('\n\n');
}
function formatHaikuToolPayload(tools) {
    return JSON.stringify(tools.map((tool) => ({
        name: tool.name.replace(/\./g, '__'),
        description: `${tool.description}\n\nV2 tool name: ${tool.name}`,
        input_schema: tool.inputSchema,
    })));
}
function selectTools(allTools, preset, task) {
    const profile = (0, taskProfile_1.buildTaskProfile)(task.prompt, {
        kind: task.kind,
        toolPackPreset: preset,
    });
    if (profile.allowedTools === 'all')
        return allTools;
    const allowed = new Set(profile.allowedTools);
    return allTools.filter((tool) => allowed.has(tool.name));
}
function pad(value, width) {
    return String(value).padEnd(width, ' ');
}
function buildToolPackBenchmarkReport() {
    const tools = createBenchmarkTools();
    const promptBuilder = new AgentPromptBuilder_1.AgentPromptBuilder();
    const rows = [];
    for (const task of TASKS) {
        for (const preset of model_1.AGENT_TOOL_PACK_PRESETS) {
            const selectedTools = selectTools(tools, preset, task);
            const systemPrompt = promptBuilder.buildSystemPrompt({
                config: {
                    mode: 'unrestricted-dev',
                    agentId: 'benchmark',
                    role: 'primary',
                    task: task.prompt,
                    taskId: `benchmark-${task.kind}-${preset}`,
                },
                skills: [],
                tools: selectedTools,
            });
            rows.push({
                kind: task.kind,
                preset,
                toolCount: selectedTools.length,
                categories: summarizeCategories(selectedTools),
                systemPromptTokens: estimateTokens(systemPrompt),
                codexToolTokens: estimateTokens(formatCodexToolSection(selectedTools)),
                haikuToolTokens: estimateTokens(formatHaikuToolPayload(selectedTools)),
            });
        }
    }
    const header = [
        pad('Kind', 16),
        pad('Preset', 10),
        pad('Tools', 7),
        pad('SysTok', 8),
        pad('CodexTok', 10),
        pad('HaikuTok', 10),
        'Categories',
    ].join(' ');
    const separator = '-'.repeat(header.length);
    const body = rows.map((row) => [
        pad(row.kind, 16),
        pad(row.preset, 10),
        pad(row.toolCount, 7),
        pad(row.systemPromptTokens, 8),
        pad(row.codexToolTokens, 10),
        pad(row.haikuToolTokens, 10),
        row.categories,
    ].join(' ')).join('\n');
    return [
        '=== Tool Pack Benchmark ===',
        '',
        `Registered tools: ${tools.length}`,
        '',
        header,
        separator,
        body,
        '',
        'Notes:',
        '- `SysTok` is the shared system prompt token estimate with the selected tool names.',
        '- `CodexTok` is the token estimate for the Codex tool-planning section.',
        '- `HaikuTok` is the token estimate for the serialized Anthropic tool payload.',
    ].join('\n');
}
//# sourceMappingURL=toolPackBenchmark.js.map