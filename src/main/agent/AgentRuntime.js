"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentRuntime = void 0;
exports.assertInitialBrowserScope = assertInitialBrowserScope;
const AgentPromptBuilder_1 = require("./AgentPromptBuilder");
const AgentRunStore_1 = require("./AgentRunStore");
const AgentSkillLoader_1 = require("./AgentSkillLoader");
const AgentToolExecutor_1 = require("./AgentToolExecutor");
const toolPacks_1 = require("./toolPacks");
const toolBindingScope_1 = require("./toolBindingScope");
const appStateStore_1 = require("../state/appStateStore");
const actions_1 = require("../state/actions");
const ids_1 = require("../../shared/utils/ids");
const model_1 = require("../../shared/types/model");
const taskProfile_1 = require("./taskProfile");
class AgentRuntime {
    provider;
    constructor(provider) {
        this.provider = provider;
    }
    abort() {
        if (this.provider.abort) {
            this.provider.abort();
        }
    }
    async run(config) {
        const run = AgentRunStore_1.agentRunStore.createRun({
            parentRunId: config.parentRunId ?? null,
            depth: config.depth ?? 0,
            role: config.role,
            task: config.task,
            mode: config.mode,
        });
        AgentRunStore_1.agentRunStore.updateRun(run.id, { status: 'running' });
        try {
            const fullToolCatalog = filterToolCatalogForConfig(AgentToolExecutor_1.agentToolExecutor.list(), config);
            const hydratableToolCatalogDefs = filterHydratableToolCatalogForConfig(fullToolCatalog, config);
            const initialToolDefs = filterCallableToolsForConfig(hydratableToolCatalogDefs, config);
            const toolCatalogDefs = hydratableToolCatalogDefs;
            const initialTools = initialToolDefs.map((tool) => ({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema,
            }));
            const toolBindingStore = (0, toolBindingScope_1.createToolBindingStore)(initialTools, toolCatalogDefs.map((tool) => ({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema,
            })));
            const preflightExpansions = (0, toolPacks_1.resolvePreflightToolPackExpansions)(config.task, toolBindingStore.getCallableTools().map(tool => ({ name: tool.name })), toolCatalogDefs.map(tool => ({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema,
            })));
            for (const expansion of preflightExpansions) {
                toolBindingStore.queueTools(expansion.tools);
                toolBindingStore.beginTurn();
            }
            const tools = toolBindingStore.getCallableTools();
            const callableToolNames = new Set(tools.map((tool) => tool.name));
            const callableToolDefs = toolCatalogDefs.filter((tool) => callableToolNames.has(tool.name));
            assertInitialBrowserScope(config.task, tools.map(tool => tool.name), config.requiresGroundedResearchHydration === true);
            // OPTIMIZATION: Lazy-load skills.
            // If config.skillNames is provided, load them for the system prompt.
            // Otherwise, defer skill loading until the model requests them (via context addendum).
            const skillNames = config.skillNames ?? [];
            const skills = skillNames.length > 0
                ? AgentSkillLoader_1.agentSkillLoader.loadSkills(skillNames)
                : [];
            const responseStyleAddendum = (0, AgentPromptBuilder_1.buildResponseStyleAddendum)(config.task);
            const systemPrompt = AgentPromptBuilder_1.agentPromptBuilder.buildSystemPrompt({
                config: responseStyleAddendum
                    ? {
                        ...config,
                        systemPromptAddendum: [config.systemPromptAddendum?.trim(), responseStyleAddendum].filter(Boolean).join('\n\n'),
                    }
                    : config,
                skills,
                tools: callableToolDefs,
            });
            logPromptBudget(run.id, config, {
                systemPrompt,
                contextPrompt: config.contextPrompt,
                skillCount: skills.length,
                tools: tools.map(tool => ({
                    name: tool.name,
                    description: tool.description,
                    inputSchema: tool.inputSchema,
                })),
                lazyLoadEnabled: skillNames.length === 0,
                preflightExpansions,
            });
            const result = await this.provider.invoke({
                runId: run.id,
                agentId: config.agentId,
                mode: config.mode,
                taskId: config.taskId,
                systemPrompt,
                task: config.task,
                contextPrompt: config.contextPrompt,
                maxToolTurns: config.maxToolTurns,
                promptTools: tools,
                toolCatalog: toolCatalogDefs.map(tool => ({
                    name: tool.name,
                    description: tool.description,
                    inputSchema: tool.inputSchema,
                })),
                toolBindings: toolBindingStore.getBindings(),
                attachments: config.attachments,
                onToken: config.onToken,
                onStatus: config.onStatus,
                onItem: config.onItem,
            });
            AgentRunStore_1.agentRunStore.finishRun(run.id, 'completed', result.output.slice(0, 500));
            return {
                ...result,
                runId: run.id,
            };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            AgentRunStore_1.agentRunStore.finishRun(run.id, 'failed', null, message);
            throw err;
        }
    }
}
exports.AgentRuntime = AgentRuntime;
function assertInitialBrowserScope(task, toolNames, requireBrowserScope = false) {
    const profile = (0, taskProfile_1.buildTaskProfile)(task);
    if (!requireBrowserScope && profile.kind !== 'research' && profile.kind !== 'browser-automation')
        return;
    const hasBrowserTool = toolNames.some((name) => name.startsWith('browser.'));
    if (hasBrowserTool)
        return;
    throw new Error(requireBrowserScope
        ? 'Grounded research run blocked: initial MCP tool scope did not expose any browser.* tools.'
        : `Browser task blocked: initial MCP tool scope for ${profile.kind} did not expose any browser.* tools.`);
}
function logPromptBudget(runId, config, input) {
    const systemChars = input.systemPrompt.length;
    const contextChars = input.contextPrompt?.length ?? 0;
    const taskChars = config.task.length;
    const sharedChars = systemChars + contextChars + taskChars;
    const toolPayloadChars = estimateProviderToolPayloadChars(config.agentId, input.tools);
    const totalChars = sharedChars + toolPayloadChars;
    appStateStore_1.appStateStore.dispatch({
        type: actions_1.ActionType.ADD_LOG,
        log: {
            id: (0, ids_1.generateId)('log'),
            timestamp: Date.now(),
            level: 'info',
            source: resolveLogSource(config.agentId),
            taskId: config.taskId,
            message: [
                `Prompt budget run=${runId}`,
                `agent=${config.agentId}`,
                `role=${config.role}`,
                `skills=${input.skillCount}`,
                `tools=${input.tools.length}`,
                `maxToolTurns=${config.maxToolTurns ?? 'default'}`,
                `sharedChars=${sharedChars}`,
                `sharedTokens=${Math.ceil(sharedChars / 4)}`,
                `toolPayloadChars=${toolPayloadChars}`,
                `toolPayloadTokens=${Math.ceil(toolPayloadChars / 4)}`,
                `totalChars=${totalChars}`,
                `totalEstTokens=${Math.ceil(totalChars / 4)}`,
                input.preflightExpansions?.length
                    ? `preflightPacks=${input.preflightExpansions.map((expansion) => `${expansion.pack}:${expansion.reason}`).join('|')}`
                    : '',
                input.lazyLoadEnabled ? 'lazyLoad=enabled' : '',
            ].filter(Boolean).join(' '),
        },
    });
}
function estimateProviderToolPayloadChars(agentId, tools) {
    if (tools.length === 0)
        return 0;
    if (agentId === 'haiku') {
        return JSON.stringify(tools.map((tool) => ({
            name: tool.name.replace(/\./g, '__'),
            description: `${tool.description}\n\nV2 tool name: ${tool.name}`,
            input_schema: tool.inputSchema,
        }))).length;
    }
    return tools.map((tool) => {
        const schema = JSON.stringify(tool.inputSchema, null, 2);
        return [
            `- ${tool.name}`,
            `  Description: ${tool.description}`,
            `  Input schema: ${schema}`,
        ].join('\n');
    }).join('\n\n').length;
}
function resolveLogSource(agentId) {
    return (0, model_1.isProviderId)(agentId) ? agentId : 'system';
}
function filterCallableToolsForConfig(tools, config) {
    const allowed = config.allowedTools === 'all' || !config.allowedTools
        ? null
        : new Set(config.allowedTools);
    return tools.filter((tool) => {
        if (config.canSpawnSubagents === false && tool.name.startsWith('subagent.'))
            return false;
        return !allowed || allowed.has(tool.name);
    });
}
function filterHydratableToolCatalogForConfig(tools, config) {
    const hydratable = config.hydratableTools
        ?? (config.restrictToolCatalogToAllowedTools ? config.allowedTools : undefined);
    const allowed = hydratable === 'all' || !hydratable
        ? null
        : new Set(hydratable);
    return tools.filter((tool) => {
        if (config.canSpawnSubagents === false && tool.name.startsWith('subagent.'))
            return false;
        return !allowed || allowed.has(tool.name);
    });
}
function filterToolCatalogForConfig(tools, config) {
    return tools.filter((tool) => {
        if (config.canSpawnSubagents === false && tool.name.startsWith('subagent.'))
            return false;
        return true;
    });
}
//# sourceMappingURL=AgentRuntime.js.map