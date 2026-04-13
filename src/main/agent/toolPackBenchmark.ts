import { AgentPromptBuilder } from './AgentPromptBuilder';
import { createBrowserToolDefinitions } from './tools/browserTools';
import { createChatToolDefinitions } from './tools/chatTools';
import { createFilesystemToolDefinitions } from './tools/filesystemTools';
import { createRuntimeToolDefinitions } from './tools/runtimeTools';
import { createTerminalToolDefinitions } from './tools/terminalTools';
import { createSubAgentToolDefinitions } from './tools/subagentTools';
import type { AgentProvider, AgentToolDefinition } from './AgentTypes';
import type { AgentTaskKind, AgentToolPackPreset } from '../../shared/types/model';
import { AGENT_TOOL_PACK_PRESETS } from '../../shared/types/model';
import { buildTaskProfile } from './taskProfile';

type BenchmarkTask = {
  kind: AgentTaskKind;
  prompt: string;
};

type BenchmarkRow = {
  kind: AgentTaskKind;
  preset: AgentToolPackPreset;
  toolCount: number;
  categories: string;
  systemPromptTokens: number;
  codexToolTokens: number;
  haikuToolTokens: number;
};

const TASKS: BenchmarkTask[] = [
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

function estimateTokens(textOrChars: string | number): number {
  const chars = typeof textOrChars === 'string' ? textOrChars.length : textOrChars;
  return Math.ceil(chars / 4);
}

function createBenchmarkTools(): AgentToolDefinition[] {
  const providerFactory = (): AgentProvider => ({
    async invoke() {
      throw new Error('benchmark stub provider should never be invoked');
    },
  });

  return [
    ...createRuntimeToolDefinitions(),
    ...createBrowserToolDefinitions(),
    ...createChatToolDefinitions(),
    ...createFilesystemToolDefinitions(),
    ...createTerminalToolDefinitions(),
    ...createSubAgentToolDefinitions(providerFactory),
  ];
}

function summarizeCategories(tools: Pick<AgentToolDefinition, 'name'>[]): string {
  const counts = tools.reduce((acc, tool) => {
    const category = tool.name.split('.')[0];
    acc.set(category, (acc.get(category) || 0) + 1);
    return acc;
  }, new Map<string, number>());

  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, count]) => `${category}:${count}`)
    .join(' ');
}

function formatCodexToolSection(tools: Pick<AgentToolDefinition, 'name' | 'description' | 'inputSchema'>[]): string {
  if (tools.length === 0) return 'No tools are available in this runtime.';
  return tools.map((tool) => {
    const schema = JSON.stringify(tool.inputSchema, null, 2);
    return [
      `- ${tool.name}`,
      `  Description: ${tool.description}`,
      `  Input schema: ${schema}`,
    ].join('\n');
  }).join('\n\n');
}

function formatHaikuToolPayload(tools: Pick<AgentToolDefinition, 'name' | 'description' | 'inputSchema'>[]): string {
  return JSON.stringify(tools.map((tool) => ({
    name: tool.name.replace(/\./g, '__'),
    description: `${tool.description}\n\nV2 tool name: ${tool.name}`,
    input_schema: tool.inputSchema,
  })));
}

function selectTools(
  allTools: AgentToolDefinition[],
  preset: AgentToolPackPreset,
  task: BenchmarkTask,
): AgentToolDefinition[] {
  const profile = buildTaskProfile(task.prompt, {
    kind: task.kind,
    toolPackPreset: preset,
  });
  if (profile.allowedTools === 'all') return allTools;
  const allowed = new Set(profile.allowedTools);
  return allTools.filter((tool) => allowed.has(tool.name));
}

function pad(value: string | number, width: number): string {
  return String(value).padEnd(width, ' ');
}

export function buildToolPackBenchmarkReport(): string {
  const tools = createBenchmarkTools();
  const promptBuilder = new AgentPromptBuilder();

  const rows: BenchmarkRow[] = [];
  for (const task of TASKS) {
    for (const preset of AGENT_TOOL_PACK_PRESETS) {
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
