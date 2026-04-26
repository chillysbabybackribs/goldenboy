# Browser Worker Workflow Example

Status: reference / experimental only. This document does **not** describe the current live Goldenboy runtime path.

The normal runtime no longer auto-compiles user prompts into deterministic workflows before `AgentRuntime`. Keep this document as design/reference material for a possible future host-side automation system, not as a description of current behavior.

This document shows the full handoff for a low-token browser task:

1. The user asks for a task.
2. Codex compiles the task into a workflow.
3. A deterministic worker executes the workflow with a fixed tool surface.
4. Codex is only called again if the worker escalates.

The example uses the same Yahoo local-badge task we already performed manually, because it is simple enough to read end to end while still showing the real architecture split.

## Core Split

`Codex`
- interprets the user request
- chooses or writes a workflow
- fills workflow inputs
- defines escalation conditions
- only re-enters on ambiguity, failure, or policy gates

`Worker`
- receives a workflow plus inputs
- owns the browser tool calls
- executes deterministic steps
- emits heartbeats, logs, checkpoints, and final status

The worker does not need the full conversational tool loop. It only needs a stable runtime API and a compiled workflow artifact.

## Example Workflow Artifact

See [yahoo-local-badge.workflow.json](/home/dp/Documents/goldenboy/docs/agent/examples/yahoo-local-badge.workflow.json).

This workflow intentionally uses existing Goldenboy browser tool names:

- `browser.navigate`
- `browser.wait_for`
- `browser.evaluate_js`

## Runtime Shape

```ts
type WorkflowDefinition = {
  id: string;
  version: string;
  description: string;
  allowedTools: string[];
  inputs: Record<string, unknown>;
  heartbeat: {
    intervalMs: number;
    include: Array<'step' | 'url' | 'retryCount' | 'lastError'>;
  };
  checkpoint: {
    saveAfterEveryStep: boolean;
  };
  escalation: {
    maxRetriesPerStep: number;
    conditions: string[];
  };
  steps: WorkflowStep[];
};

type WorkflowStep =
  | {
      id: string;
      kind: 'tool';
      tool: string;
      input: Record<string, unknown>;
      onFailure?: 'retry' | 'escalate' | 'stop';
    }
  | {
      id: string;
      kind: 'assert';
      expression: string;
      onFailure?: 'retry' | 'escalate' | 'stop';
    };
```

## How A Run Works

For a request like `add a green checkmark to yahoo in my environment`, the runtime flow is:

1. Codex selects `yahoo-local-badge.workflow.json`.
2. Codex fills user inputs:
   - `url = https://www.yahoo.com/`
   - `badgeText = VERIFIED`
   - `badgeColor = #1f9d55`
3. Worker starts a run and claims the allowed tools from the workflow.
4. Worker executes each step in order.
5. After each step, worker persists a checkpoint:
   - current step id
   - retries
   - active tab id
   - last observed URL
   - last error if any
6. Worker emits heartbeats while running.
7. If a step fails beyond retry policy, worker creates an escalation envelope for Codex.

## Minimal Worker Loop

```ts
async function runWorkflow(
  workflow: WorkflowDefinition,
  runtime: {
    executeTool: (toolName: string, input: Record<string, unknown>) => Promise<unknown>;
    saveCheckpoint: (state: Record<string, unknown>) => Promise<void>;
    emitHeartbeat: (state: Record<string, unknown>) => void;
    escalate: (payload: Record<string, unknown>) => Promise<void>;
  },
) {
  for (const step of workflow.steps) {
    runtime.emitHeartbeat({ step: step.id, status: 'running' });

    try {
      if (step.kind === 'tool') {
        await runtime.executeTool(step.tool, step.input);
      } else {
        const result = await runtime.executeTool('browser.evaluate_js', {
          expression: step.expression,
        });
        const ok = Boolean((result as { data?: { result?: unknown } }).data?.result);
        if (!ok) throw new Error(`Assertion failed: ${step.id}`);
      }

      await runtime.saveCheckpoint({ step: step.id, status: 'completed' });
    } catch (error) {
      await runtime.saveCheckpoint({
        step: step.id,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });

      await runtime.escalate({
        workflowId: workflow.id,
        failedStep: step.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
```

## What Codex Actually Writes

Codex should usually write one of these:

- a workflow definition
- a patch to an existing workflow
- a page-specific JS fragment inside one workflow step

Codex should not be forced to consume every browser event and decide every click. That is the expensive path.

## Escalation Envelope

When the worker cannot continue deterministically, it should send Codex a compact envelope instead of replaying the whole run:

```ts
type EscalationEnvelope = {
  workflowId: string;
  runId: string;
  failedStep: string;
  lastUrl: string;
  lastError: string;
  retryCount: number;
  recentToolCalls: Array<{
    tool: string;
    summary: string;
    validationStatus?: 'VALID' | 'INVALID' | 'INCOMPLETE';
  }>;
  domExcerpt?: string;
};
```

That keeps replanning prompts small and lets Codex act as the exception handler rather than the event loop.

## Why This Helps With Token Usage

Without workflows:

- Codex sees page state
- Codex decides next tool
- Codex gets result
- repeat for every step

With workflows:

- Codex writes the plan once
- worker executes locally
- Codex only returns on escalation

That is the architecture you want if the product goal is persistent browser workers with heartbeats and low model cost.
