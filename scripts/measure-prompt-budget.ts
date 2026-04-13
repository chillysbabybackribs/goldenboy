/**
 * Measure system prompt size before and after lazy-load optimization.
 * This is a standalone measurement script, not part of the runtime.
 */

import * as fs from 'fs';
import * as path from 'path';
import { AgentPromptBuilder } from '../src/main/agent/AgentPromptBuilder';
import { agentSkillLoader } from '../src/main/agent/AgentSkillLoader';
import { agentToolExecutor } from '../src/main/agent/AgentToolExecutor';

const APP_WORKSPACE_ROOT = path.resolve(__dirname, '..');

// Mock config for measurement
const mockConfig = {
  agentId: 'haiku' as const,
  role: 'primary' as const,
  mode: 'unrestricted-dev' as const,
  task: 'This is a test task.',
  taskId: 'test-task-001',
  depth: 0,
};

function estimateTokens(textOrChars: string | number): number {
  // Rough estimate: 1 token ≈ 4 characters (OpenAI standard)
  const chars = typeof textOrChars === 'string' ? textOrChars.length : textOrChars;
  return Math.ceil(chars / 4);
}

async function measurePromptBudget() {
  console.log('=== Lazy-Load Prompt Optimization Measurement ===\n');

  const builder = new AgentPromptBuilder();

  // Scenario 1: Load ALL skills upfront (old behavior)
  console.log('BEFORE (All skills loaded upfront):');
  const allSkillNames = ['browser-operation', 'filesystem-operation', 'local-debug'];
  const allSkills = agentSkillLoader.loadSkills(allSkillNames);
  const allTools = agentToolExecutor.list();

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
    skills: [],  // No skills loaded initially
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
      skills: agentSkillLoader.loadSkills([skillName]),
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
