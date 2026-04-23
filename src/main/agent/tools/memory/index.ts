import { AgentToolDefinition } from '../../AgentTypes';
import { taskMemoryStore } from '../../../models/taskMemoryStore';

function objectInput(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? input as Record<string, unknown> : {};
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Expected non-empty string input: ${key}`);
  }
  return value;
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function optionalBoolean(input: Record<string, unknown>, key: string): boolean {
  return input[key] === true;
}

type ChecklistStatus = 'pending' | 'in_progress' | 'completed' | 'blocked' | 'dropped';

function isChecklistStatus(value: string): value is ChecklistStatus {
  return ['pending', 'in_progress', 'completed', 'blocked', 'dropped'].includes(value);
}

function activeChecklistSummary(taskId: string) {
  const snapshot = taskMemoryStore.getPlanSnapshot(taskId);
  return snapshot?.activeChecklist ?? null;
}

export function createMemoryToolDefinitions(): AgentToolDefinition[] {
  return [
    {
      name: 'memory.plan_update',
      description: 'Deterministically update the active task checklist. Use this to start, target, complete, block, drop, or reset checklist items through the host memory layer.',
      inputSchema: {
        type: 'object',
        required: ['action'],
        properties: {
          action: {
            type: 'string',
            enum: ['start_current', 'start_item', 'complete_current', 'set_item_status'],
          },
          itemId: { type: 'string' },
          status: {
            type: 'string',
            enum: ['pending', 'in_progress', 'completed', 'blocked', 'dropped'],
          },
          skipPriorPending: { type: 'boolean' },
          notes: { type: 'string' },
          reason: { type: 'string' },
        },
      },
      async execute(input, context) {
        if (!context.taskId) {
          throw new Error('memory.plan_update requires a task context.');
        }

        const obj = objectInput(input);
        const action = requireString(obj, 'action');
        const reason = optionalString(obj, 'reason');
        const before = activeChecklistSummary(context.taskId);
        let updated: unknown = null;

        switch (action) {
          case 'start_current':
            updated = taskMemoryStore.beginActiveChecklistItem(context.taskId, reason);
            break;
          case 'start_item':
            updated = taskMemoryStore.beginSpecificChecklistItem(
              context.taskId,
              requireString(obj, 'itemId'),
              {
                skipPriorPending: optionalBoolean(obj, 'skipPriorPending'),
                reason,
              },
            );
            break;
          case 'complete_current':
            updated = taskMemoryStore.completeActiveChecklistItem(context.taskId, reason);
            break;
          case 'set_item_status': {
            const status = requireString(obj, 'status');
            if (!isChecklistStatus(status)) throw new Error(`Unsupported checklist status: ${status}`);
            updated = taskMemoryStore.setChecklistItemStatus(
              context.taskId,
              requireString(obj, 'itemId'),
              status,
              {
                notes: optionalString(obj, 'notes'),
                skipPriorPending: optionalBoolean(obj, 'skipPriorPending'),
                reason,
              },
            );
            break;
          }
          default:
            throw new Error(`Unsupported memory.plan_update action: ${action}`);
        }

        if (!updated) {
          throw new Error(`No active checklist item was updated for action "${action}".`);
        }

        const after = activeChecklistSummary(context.taskId);
        return {
          summary: `Updated active checklist via ${action}`,
          data: {
            action,
            updated,
            before,
            after,
            memoryUpdated: true,
          },
        };
      },
    },
  ];
}
