"use strict";
/**
 * Measure system prompt size before and after lazy-load optimization.
 * This is a standalone measurement script, not part of the runtime.
 */
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
const path = __importStar(require("path"));
const AgentPromptBuilder_1 = require("../src/main/agent/AgentPromptBuilder");
const AgentSkillLoader_1 = require("../src/main/agent/AgentSkillLoader");
const AgentToolExecutor_1 = require("../src/main/agent/AgentToolExecutor");
const APP_WORKSPACE_ROOT = path.resolve(__dirname, '..');
// Mock config for measurement
const mockConfig = {
    agentId: 'haiku',
    role: 'primary',
    mode: 'unrestricted-dev',
    task: 'This is a test task.',
    taskId: 'test-task-001',
    depth: 0,
};
function estimateTokens(textOrChars) {
    // Rough estimate: 1 token ≈ 4 characters (OpenAI standard)
    const chars = typeof textOrChars === 'string' ? textOrChars.length : textOrChars;
    return Math.ceil(chars / 4);
}
async function measurePromptBudget() {
    console.log('=== Lazy-Load Prompt Optimization Measurement ===\n');
    const builder = new AgentPromptBuilder_1.AgentPromptBuilder();
    // Scenario 1: Load ALL skills upfront (old behavior)
    console.log('BEFORE (All skills loaded upfront):');
    const allSkillNames = ['browser-operation', 'filesystem-operation', 'local-debug'];
    const allSkills = AgentSkillLoader_1.agentSkillLoader.loadSkills(allSkillNames);
    const allTools = AgentToolExecutor_1.agentToolExecutor.list();
    const fullPrompt = builder.buildSystemPrompt({
        config: mockConfig,
        skills: allSkills,
        tools: allTools,
    });
    const fullChars = fullPrompt.length;
    const fullTokens = estimateTokens(fullPrompt);
    console.log(`  Skills loaded: ${allSkills.length}`);
    console.log(`  Tools registered: ${allTools.length}`);
    console.log(`  Prompt characters: ${fullChars.toLocaleString()}`);
    console.log(`  Estimated tokens: ${fullTokens.toLocaleString()}`);
    console.log();
    // Scenario 2: Lazy-load (empty skills)
    console.log('AFTER (Lazy-load enabled):');
    const lazyPrompt = builder.buildSystemPrompt({
        config: mockConfig,
        skills: [], // No skills loaded initially
        tools: allTools,
    });
    const lazyChars = lazyPrompt.length;
    const lazyTokens = estimateTokens(lazyPrompt);
    console.log(`  Skills loaded: 0`);
    console.log(`  Tools registered: ${allTools.length}`);
    console.log(`  Prompt characters: ${lazyChars.toLocaleString()}`);
    console.log(`  Estimated tokens: ${lazyTokens.toLocaleString()}`);
    console.log();
    // Impact analysis
    const charReduction = fullChars - lazyChars;
    const charReductionPct = (charReduction / fullChars) * 100;
    const tokenReduction = fullTokens - lazyTokens;
    const tokenReductionPct = (tokenReduction / fullTokens) * 100;
    console.log('=== IMPACT ===');
    console.log(`Character reduction: ${charReduction.toLocaleString()} chars (${charReductionPct.toFixed(1)}%)`);
    console.log(`Token reduction: ${tokenReduction.toLocaleString()} tokens (${tokenReductionPct.toFixed(1)}%)`);
    console.log();
    // Per-skill breakdown
    console.log('=== Per-Skill Breakdown ===');
    for (const skillName of allSkillNames) {
        const skillPrompt = builder.buildSystemPrompt({
            config: mockConfig,
            skills: AgentSkillLoader_1.agentSkillLoader.loadSkills([skillName]),
            tools: [],
        });
        const skillChars = skillPrompt.length - lazyChars;
        console.log(`  ${skillName}: ${skillChars.toLocaleString()} chars (${estimateTokens(skillChars)} tokens)`);
    }
    console.log();
    // Future optimization potential
    console.log('=== Future Optimization Potential ===');
    console.log('1. Lazy-load skills on demand via model request');
    console.log('2. Pre-compile skill lookup index to avoid re-reading files');
    console.log('3. Cache parsed markdown sections to avoid re-parsing');
    console.log();
}
// Run measurement
measurePromptBudget().catch(console.error);
//# sourceMappingURL=measure-prompt-budget.js.map