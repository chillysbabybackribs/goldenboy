import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HAIKU_PROVIDER_ID } from '../../../shared/types/model';
import { resolveWorkspacePath } from '../../workspaceRoot';
import { AgentRuntime } from '../AgentRuntime';
import { AgentToolDefinition } from '../AgentTypes';
import { HaikuProvider } from '../HaikuProvider';
import {
  looksLikeBrowserAutomationTask,
  scopeForPrompt,
  withBrowserSearchDirective,
} from '../runtimeScope';

const RESPONSE_DIR = path.join(os.tmpdir(), 'v2-haiku-browser-session-responses');

function objectInput(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? input as Record<string, unknown> : {};
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Expected non-empty string input: ${key}`);
  }
  return value.trim();
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function slugify(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'task';
}

function createDefaultResponsePath(prompt: string): string {
  const slug = slugify(prompt).slice(0, 48);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(RESPONSE_DIR, `${stamp}-${slug}.md`);
}

function resolveResponsePath(rawPath: string | undefined, prompt: string): string {
  if (!rawPath) return createDefaultResponsePath(prompt);
  return path.isAbsolute(rawPath) ? rawPath : resolveWorkspacePath(rawPath);
}

function resolveBrowserTaskKind(prompt: string): 'research' | 'browser-automation' {
  return looksLikeBrowserAutomationTask(prompt) ? 'browser-automation' : 'research';
}

export function createHaikuBrowserSessionToolDefinition(): AgentToolDefinition {
  return {
    name: 'runtime.haiku_browser_session',
    description: [
      'Run a normal Haiku browser session against the live V2 browser using the exact prompt text you provide.',
      'This is a thin pass-through: it reuses the standard browser task profile and writes Haiku’s exact final response to disk without wrapping or summarizing it.',
      'Use this when you want the app’s Haiku browser behavior rather than a parent-directed worker.',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['prompt'],
      properties: {
        prompt: { type: 'string' },
        responsePath: { type: 'string' },
      },
    },
    async execute(input, context) {
      if (context.agentId === HAIKU_PROVIDER_ID) {
        throw new Error('runtime.haiku_browser_session cannot be called from a Haiku parent run.');
      }

      const obj = objectInput(input);
      const prompt = requireString(obj, 'prompt');
      const responsePath = resolveResponsePath(optionalString(obj, 'responsePath'), prompt);
      const taskKind = resolveBrowserTaskKind(prompt);
      const runtimePrompt = withBrowserSearchDirective(prompt, { kind: taskKind });
      const runtimeScope = scopeForPrompt(prompt, { kind: taskKind });

      context.onProgress?.('haiku-browser-session:start');

      const runtime = new AgentRuntime(new HaikuProvider());
      const result = await runtime.run({
        ...runtimeScope,
        mode: context.mode,
        agentId: HAIKU_PROVIDER_ID,
        role: 'primary',
        task: runtimePrompt,
        taskId: context.taskId,
        onStatus: (status) => {
          context.onProgress?.(`haiku-browser-session:${status}`);
        },
      });

      fs.mkdirSync(path.dirname(responsePath), { recursive: true });
      fs.writeFileSync(responsePath, result.output, 'utf-8');

      context.onProgress?.(`haiku-browser-session:done:${responsePath}`);

      return {
        summary: `Haiku browser session completed; response saved to ${responsePath}`,
        data: {
          responsePath,
          childRunId: result.runId ?? null,
          taskKind,
          usage: result.usage ?? null,
        },
      };
    },
  };
}
