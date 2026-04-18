"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Audit test: capture tools passed to Codex for different task types
const runtimeScope_1 = require("./src/main/agent/runtimeScope");
const AgentToolExecutor_1 = require("./src/main/agent/AgentToolExecutor");
const tasks = [
    {
        type: 'research',
        prompt: 'search for codex optimal tools implementation',
    },
    {
        type: 'implementation',
        prompt: 'edit the TaskProfile file to add browser-specific tools',
    },
    {
        type: 'debug',
        prompt: 'why is the build failing with this error message',
    },
    {
        type: 'review',
        prompt: 'review the pull request for code quality',
    },
    {
        type: 'orchestration',
        prompt: 'plan a migration of the database schema across three services using sub-agents',
    },
];
const allTools = AgentToolExecutor_1.agentToolExecutor.list();
console.log('\n=== CODEX TOOL AUDIT ===\n');
console.log(`Total available tools: ${allTools.length}\n`);
console.log('Tool breakdown:');
const byCategory = allTools.reduce((acc, tool) => {
    const category = tool.name.split('.')[0];
    if (!acc[category])
        acc[category] = [];
    acc[category].push(tool.name);
    return acc;
}, {});
for (const [category, tools] of Object.entries(byCategory)) {
    console.log(`  ${category}: ${tools.length}`);
}
console.log('\n=== TASK-SPECIFIC TOOL SELECTION ===\n');
for (const task of tasks) {
    const scope = (0, runtimeScope_1.scopeForPrompt)(task.prompt);
    const selectedTools = scope.allowedTools === 'all'
        ? allTools
        : allTools.filter(t => scope.allowedTools.includes(t.name));
    console.log(`Task: ${task.type}`);
    console.log(`  Prompt: "${task.prompt}"`);
    console.log(`  Scope result: allowedTools = ${scope.allowedTools === 'all' ? 'ALL' : `array of ${scope.allowedTools.length}`}`);
    console.log(`  Tools passed to model: ${selectedTools.length}/${allTools.length}`);
    console.log(`  Skills loaded: ${scope.skillNames.join(', ')}`);
    if (scope.allowedTools !== 'all') {
        console.log(`  Specific tools:`);
        const toolsByCategory = selectedTools.reduce((acc, tool) => {
            const category = tool.name.split('.')[0];
            if (!acc[category])
                acc[category] = [];
            acc[category].push(tool.name);
            return acc;
        }, {});
        for (const [category, tools] of Object.entries(toolsByCategory)) {
            console.log(`    ${category}: ${tools.length}`);
        }
    }
    console.log();
}
console.log('\n=== CONCLUSION ===\n');
const wastedToolsPerRun = allTools.length - allTools.filter(t => {
    // Most tasks only need browser, filesystem, terminal, and chat
    const essentialCategories = ['browser', 'filesystem', 'terminal', 'chat'];
    const category = t.name.split('.')[0];
    return essentialCategories.includes(category);
}).length;
console.log(`Currently: ALL ${allTools.length} tools passed to every run`);
console.log(`Potential waste: ~${wastedToolsPerRun} unnecessary subagent tools in non-orchestration tasks`);
console.log(`Opportunity: Reduce system prompt bloat by filtering tools per task type`);
//# sourceMappingURL=test-tools-audit.js.map