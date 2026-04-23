import { describe, expect, it, vi } from 'vitest';

import type { AgentToolResult } from '../AgentTypes';
import { BrowserWorkflowExecutor } from './BrowserWorkflowExecutor';
import { browserAutomationResearchWorkflow } from './examples/browserAutomationResearchWorkflow';
import { yahooLocalBadgeWorkflow } from './examples/yahooLocalBadgeWorkflow';
import type { WorkflowDefinition, WorkflowToolExecutor } from './types';

function result(summary: string, data: Record<string, unknown>, validationStatus?: AgentToolResult['validation'] extends infer T ? T extends { status: infer S } ? S : never : never): AgentToolResult {
  return {
    summary,
    data,
    validation: validationStatus ? {
      status: validationStatus,
      constraints: [],
      summary: validationStatus,
    } : undefined,
  };
}

describe('BrowserWorkflowExecutor', () => {
  it('executes the Yahoo workflow end to end with interpolated inputs', async () => {
    const executeTool = vi.fn<WorkflowToolExecutor>(async (name, input) => {
      if (name === 'browser.navigate') {
        expect(input).toEqual({ url: 'https://www.yahoo.com/' });
        return result('navigated', { url: 'https://www.yahoo.com/' });
      }
      if (name === 'browser.wait_for') {
        expect(input).toEqual({ selector: 'header', timeoutMs: 10000 });
        return result('header ready', { result: { success: true } });
      }
      if (name === 'browser.evaluate_js' && typeof (input as { expression?: unknown }).expression === 'string') {
        const expression = (input as { expression: string }).expression;
        if (expression === "(() => !!document.getElementById('goldenboy-embedded-checkmark'))()") {
          return result('assert ok', { result: true });
        }
        expect(expression).toContain('✓ VERIFIED');
        expect(expression).toContain('#1f9d55');
        return result('badge injected', { result: { inserted: true } });
      }
      throw new Error(`Unexpected tool call: ${name}`);
    });

    const heartbeats: string[] = [];
    const checkpoints: string[] = [];
    const executor = new BrowserWorkflowExecutor({ executeTool, now: () => 123 });

    const run = await executor.run(yahooLocalBadgeWorkflow, {
      context: {
        runId: 'run_1',
        agentId: 'agent_1',
        mode: 'unrestricted-dev',
      },
      onHeartbeat: (heartbeat) => heartbeats.push(heartbeat.stepId),
      onCheckpoint: (checkpoint) => checkpoints.push(`${checkpoint.stepId}:${checkpoint.status}`),
    });

    expect(run.success).toBe(true);
    expect(run.failedStepId).toBeNull();
    expect(run.completedStepIds).toEqual([
      'open_yahoo',
      'wait_for_header',
      'inject_badge',
      'verify_badge',
    ]);
    expect(heartbeats).toEqual([
      'open_yahoo',
      'wait_for_header',
      'inject_badge',
      'verify_badge',
    ]);
    expect(checkpoints).toEqual([
      'open_yahoo:completed',
      'wait_for_header:completed',
      'inject_badge:completed',
      'verify_badge:completed',
    ]);
    expect(run.stepResults.inject_badge).toMatchObject({
      toolName: 'browser.evaluate_js',
      summary: 'badge injected',
    });
  });

  it('retries retryable tool steps before succeeding', async () => {
    let attempts = 0;
    const workflow: WorkflowDefinition = {
      ...yahooLocalBadgeWorkflow,
      steps: [
        {
          id: 'open_yahoo',
          kind: 'tool',
          tool: 'browser.navigate',
          input: { url: '{{inputs.url}}' },
          onFailure: 'retry',
        },
      ],
    };
    const executeTool = vi.fn<WorkflowToolExecutor>(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('temporary failure');
      return result('navigated', { url: 'https://www.yahoo.com/' });
    });
    const executor = new BrowserWorkflowExecutor({ executeTool, now: () => 50 });

    const run = await executor.run(workflow, {
      context: {
        runId: 'run_2',
        agentId: 'agent_2',
        mode: 'unrestricted-dev',
      },
    });

    expect(run.success).toBe(true);
    expect(attempts).toBe(3);
    expect(run.checkpoints.map(item => item.status)).toEqual(['failed', 'failed', 'completed']);
    expect(run.stepResults.open_yahoo).toMatchObject({
      summary: 'navigated',
    });
  });

  it('escalates when an assertion fails', async () => {
    const escalations: string[] = [];
    const executeTool = vi.fn<WorkflowToolExecutor>(async (name) => {
      if (name === 'browser.navigate') return result('navigated', { url: 'https://www.yahoo.com/' });
      if (name === 'browser.wait_for') return result('header ready', { result: { success: true } });
      return result('assert failed', { result: false });
    });
    const executor = new BrowserWorkflowExecutor({ executeTool, now: () => 77 });

    const run = await executor.run(yahooLocalBadgeWorkflow, {
      context: {
        runId: 'run_3',
        agentId: 'agent_3',
        mode: 'unrestricted-dev',
      },
      onEscalation: (escalation) => escalations.push(`${escalation.failedStepId}:${escalation.error}`),
    });

    expect(run.success).toBe(false);
    expect(run.failedStepId).toBe('verify_badge');
    expect(escalations).toEqual([
      'verify_badge:Assertion failed: verify_badge',
    ]);
    expect(run.stepResults.inject_badge).toBeTruthy();
  });

  it('fails when a workflow uses a tool outside its allowlist', async () => {
    const workflow: WorkflowDefinition = {
      ...yahooLocalBadgeWorkflow,
      allowedTools: ['browser.navigate'],
    };
    const executor = new BrowserWorkflowExecutor({
      executeTool: vi.fn<WorkflowToolExecutor>(async () => result('ok', {})),
    });

    await expect(executor.run(workflow, {
      context: {
        runId: 'run_4',
        agentId: 'agent_4',
        mode: 'unrestricted-dev',
      },
    })).rejects.toThrow('uses disallowed tool browser.wait_for');
  });

  it('renders later step inputs from earlier step results', async () => {
    const executeTool = vi.fn<WorkflowToolExecutor>(async (name, input) => {
      if (name === 'browser.research_search') {
        expect(input).toEqual({
          query: 'browser automation in chromium browser',
          mode: 'workflow',
          resultLimit: 5,
          maxPages: 2,
          stopWhenAnswerFound: true,
          minEvidenceScore: 8,
        });
        return result('search complete', {
          openedPages: [{
            url: 'https://playwright.dev/',
            summary: 'Playwright drives Chromium, Firefox, and WebKit.',
            answerEvidence: ['Playwright can automate Chromium with a high-level API.'],
          }],
        });
      }
      if (name === 'browser.extract_page') {
        return result('extracted', {
          metadata: {
            title: 'Playwright',
          },
          text: 'Playwright text',
        });
      }
      if (name === 'browser.record_finding') {
        expect(input).toEqual({
          title: 'Browser automation research result',
          summary: 'Playwright can automate Chromium with a high-level API.',
          severity: 'info',
          evidence: [
            'Query: browser automation in chromium browser',
            'Source: https://playwright.dev/',
            'Page title: Playwright',
            'Playwright drives Chromium, Firefox, and WebKit.',
          ],
        });
        return result('finding pinned', { findingId: 'finding_1' });
      }
      throw new Error(`Unexpected tool call: ${name}`);
    });

    const executor = new BrowserWorkflowExecutor({ executeTool, now: () => 200 });
    const run = await executor.run(browserAutomationResearchWorkflow, {
      context: {
        runId: 'run_5',
        agentId: 'agent_5',
        mode: 'unrestricted-dev',
        taskId: 'task_5',
      },
    });

    expect(run.success).toBe(true);
    expect(run.completedStepIds).toEqual([
      'search_browser_automation',
      'extract_active_result',
      'record_research_finding',
    ]);
    expect(run.stepResults.record_research_finding).toMatchObject({
      summary: 'finding pinned',
      data: { findingId: 'finding_1' },
    });
  });
});
