"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.agentPromptBuilder = exports.AgentPromptBuilder = void 0;
exports.buildResponseStyleAddendum = buildResponseStyleAddendum;
const fs = __importStar(require("fs"));
const model_1 = require("../../shared/types/model");
const workspaceRoot_1 = require("../workspaceRoot");
const sourceValidationPolicy_1 = require("./sourceValidationPolicy");
const taskProfile_1 = require("./taskProfile");
const AGENT_CONTRACT_PATH = (0, workspaceRoot_1.resolveWorkspacePath)('AGENT.md');
const ALWAYS_ON_CONTRACT_SECTIONS = new Set([
    'Application Mental Model',
    'Runtime Path',
    'Operating Rules',
    'Result Validation Discipline',
    'Token Discipline',
    'Sub-Agent Rules',
    'Response Style',
]);
let cachedContract = null;
const EXECUTION_GUARDRAILS = [
    'Use authoritative sources for factual or decision-impacting claims; if verification is incomplete, say so briefly.',
    'Track the active user constraints internally and validate the result against them before claiming success.',
    'Treat any RUNTIME VALIDATION block as authoritative: VALID only when every checked constraint passes; INVALID or INCOMPLETE must be reported honestly.',
    'When the user asks for a real action, use tools to do the work, verify the outcome, and avoid destructive or irreversible actions unless explicitly requested.',
].join('\n');
const TOOLING_GUARDRAILS = [
    'If a needed capability is missing, use runtime.search_tools first; request a broader tool pack only when a wide surface is actually needed.',
    'Restate important tool findings in assistant text because the user cannot see raw tool payloads.',
    'Use artifact.* tools for managed workspace artifacts (`md`, `txt`, `html`, `csv`); use filesystem.* for repository files and arbitrary local files.',
].join('\n');
const PRIMARY_PROVIDER_GUARDRAILS = [
    'Use only V2 browser, filesystem, terminal, and research tools for external actions. Do not use provider-native web features.',
    'Never use shell commands for web access. Use browser.research_search for research, browser.navigate + browser.extract_page for direct URLs, and browser.search_web to open a search page.',
].join('\n');
const RUNTIME_IDENTITY = [
    'You are the user\'s persistent V2 workspace agent, not a generic chatbot.',
    'Act on the user\'s behalf inside this application: proactively inspect the relevant source of truth first, then use the right V2 tools to complete the task.',
    'For web or current-information tasks, use the owned browser and browser research tools. For OS, repo, and file tasks, use filesystem, terminal, artifact, and chat/task memory tools as appropriate.',
    'Start from observed state, not assumptions. End with a concrete result, the key observed evidence, and any remaining blocker if the task could not be completed.',
].join('\n');
class AgentPromptBuilder {
    /**
     * Lazy-load variant: builds minimal prompt without skills.
     * Skills are compiled on demand in subsequent turns via buildSkillsForNames().
     */
    buildSystemPrompt(input) {
        const baseContract = buildBaseContract(readCachedContract());
        const skillText = input.skills.length > 0
            ? input.skills.map(skill => `\n\n## Skill: ${skill.name}\n\n${compactSkillBody(skill.body)}`).join('')
            : '';
        const toolText = input.tools.length > 0
            ? input.tools.map(tool => tool.name).join(', ')
            : 'No tools registered.';
        return [
            baseContract,
            `\n\n## Runtime Identity\n\n${RUNTIME_IDENTITY}`,
            `\n\n## Execution Guardrails\n\n${EXECUTION_GUARDRAILS}`,
            (0, sourceValidationPolicy_1.shouldUseStrictSourceValidation)(input.config.task)
                ? `\n\n## Strict Source Validation Protocol\n\n${sourceValidationPolicy_1.STRICT_SOURCE_VALIDATION_PROTOCOL}`
                : '',
            `\n\n## Runtime Context\n\nMode: ${input.config.mode}\nRole: ${input.config.role}\nAgent ID: ${input.config.agentId}\n${buildCurrentDateTimeLine()}\nWorkspace root: ${workspaceRoot_1.APP_WORKSPACE_ROOT}${input.config.cwd ? `\nCurrent working directory: ${input.config.cwd}` : ''}`,
            input.config.systemPromptAddendum?.trim()
                ? `\n\n## Additional Invocation Instructions\n\n${input.config.systemPromptAddendum.trim()}`
                : '',
            `\n\n## Tooling Guardrails\n\n${TOOLING_GUARDRAILS}`,
            input.config.agentId === model_1.PRIMARY_PROVIDER_ID
                ? `\n\n## V2 Guardrails\n\n${PRIMARY_PROVIDER_GUARDRAILS}`
                : '',
            `\n\n## Available Tools\n\n${toolText}`,
            skillText,
        ].join('');
    }
    /**
     * Builds skill text for requested skill names.
     * Use this to lazily append skills to context in later turns.
     */
    buildSkillsForNames(skillNames, allSkills) {
        if (!skillNames || skillNames.length === 0)
            return '';
        const skillMap = new Map(allSkills.map(s => [s.name, s]));
        const available = skillNames
            .map(name => skillMap.get(name))
            .filter((skill) => skill !== undefined);
        if (available.length === 0)
            return '';
        return available
            .map(skill => `## Skill: ${skill.name}\n\n${compactSkillBody(skill.body)}`)
            .join('\n\n');
    }
}
exports.AgentPromptBuilder = AgentPromptBuilder;
exports.agentPromptBuilder = new AgentPromptBuilder();
function readCachedContract() {
    if (!fs.existsSync(AGENT_CONTRACT_PATH))
        return 'V2 agent contract file is missing.';
    const stat = fs.statSync(AGENT_CONTRACT_PATH);
    if (cachedContract && cachedContract.path === AGENT_CONTRACT_PATH && cachedContract.mtimeMs === stat.mtimeMs) {
        return cachedContract.text;
    }
    const text = fs.readFileSync(AGENT_CONTRACT_PATH, 'utf-8');
    cachedContract = {
        path: AGENT_CONTRACT_PATH,
        mtimeMs: stat.mtimeMs,
        text,
    };
    return text;
}
function buildBaseContract(contract) {
    const sections = parseMarkdownSections(contract);
    if (sections.length === 0)
        return contract;
    const intro = sections.find(section => section.headingLevel === 1);
    const kept = sections.filter(section => section.headingLevel === 2 && ALWAYS_ON_CONTRACT_SECTIONS.has(section.heading));
    return [
        intro?.content.trim() ?? '',
        ...kept.map(section => section.content.trim()),
    ]
        .filter(Boolean)
        .join('\n\n');
}
function compactSkillBody(body) {
    const sections = parseMarkdownSections(body);
    if (sections.length === 0)
        return body.trim();
    const intro = sections.find(section => section.headingLevel === 1);
    const workflow = sections.find(section => section.headingLevel === 2 && section.heading === 'Workflow');
    const preferredTools = sections.find(section => section.headingLevel === 2 && section.heading === 'Preferred Tools');
    return [
        intro?.content.trim() ?? '',
        workflow ? normalizeListSection(workflow.content.trim()) : '',
        preferredTools ? normalizeListSection(preferredTools.content.trim()) : '',
    ]
        .filter(Boolean)
        .join('\n\n');
}
function parseMarkdownSections(markdown) {
    const lines = markdown.split('\n');
    const sections = [];
    let currentHeading = '';
    let currentLevel = 0;
    let currentLines = [];
    const flush = () => {
        if (!currentHeading && currentLevel === 0 && currentLines.length === 0)
            return;
        sections.push({
            heading: currentHeading,
            headingLevel: currentLevel,
            content: currentLines.join('\n').trim(),
        });
    };
    for (const line of lines) {
        const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
        if (match) {
            flush();
            currentLevel = match[1].length;
            currentHeading = match[2].trim();
            currentLines = [line];
            continue;
        }
        currentLines.push(line);
    }
    flush();
    return sections.filter(section => section.content);
}
function normalizeListSection(section) {
    return section
        .split('\n')
        .map(line => line.trimEnd())
        .join('\n')
        .trim();
}
function buildCurrentDateTimeLine() {
    const now = new Date();
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const local = new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short',
    }).format(now);
    return `Current date/time: ${local} (${timeZone}). Use this as the authoritative current date/time context for relative-date reasoning and freshness checks.`;
}
function buildResponseStyleAddendum(task) {
    const normalized = task.toLowerCase();
    if ((0, taskProfile_1.looksLikeResearchTask)(task) || (0, taskProfile_1.looksLikeBrowserAutomationTask)(task)) {
        return [
            'For browser, research, and web tasks:',
            '1. Do not narrate your plan or restate obvious tool actions.',
            '2. Keep interim text to zero or one short sentence before tool calls; prefer no interim text when the next step is obvious from the tool call.',
            '3. As soon as observed browser evidence or verified tool results satisfy the task, stop calling tools and produce the final answer immediately.',
            '4. Do not add an extra recap after the task is complete.',
            '5. Keep the final answer concise and focused on the result, not the tool trace.',
            '6. Do not emit step-by-step progress commentary like "checking", "verifying", "reading", or "running" for routine tool work.',
        ].join('\n');
    }
    if (/\b(review|audit|regression|pull request|diff|requested changes|code review)\b/.test(normalized)) {
        return [
            'For review and audit tasks, produce the final answer in this order:',
            '1. Findings first, ordered by severity.',
            '2. Each finding must include a file reference when available.',
            '3. Keep the change summary brief and only after findings.',
            '4. If no findings were found, say that explicitly.',
            'Do not narrate the tool trace in the final answer.',
        ].join('\n');
    }
    if (/\b(debug|diagnose|investigate|troubleshoot|root cause|failing|crash|error|exception)\b/.test(normalized)) {
        return [
            'For debugging tasks, produce the final answer in this order:',
            '1. Root cause or strongest current hypothesis.',
            '2. Evidence from observed files, commands, or runtime state.',
            '3. Fix or next action.',
            'Do not narrate the tool trace in the final answer.',
        ].join('\n');
    }
    return '';
}
//# sourceMappingURL=AgentPromptBuilder.js.map