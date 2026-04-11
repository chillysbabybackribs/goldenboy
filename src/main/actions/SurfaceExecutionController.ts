import type { SurfaceAction, SurfaceTarget } from '../../shared/actions/surfaceActionTypes';
import type { ActionConcurrencyPolicy } from './surfaceActionPolicy';

export type ExecuteCallback = (action: SurfaceAction) => Promise<void>;
export type FailCallback = (action: SurfaceAction, reason: string) => void;

export class SurfaceExecutionController {
  private queue: SurfaceAction[] = [];
  private active: SurfaceAction | null = null;

  constructor(
    readonly surface: SurfaceTarget,
    private readonly execute: ExecuteCallback,
    private readonly onPolicyFail: FailCallback,
  ) {}

  submit(action: SurfaceAction, policy: ActionConcurrencyPolicy): void {
    if (policy.mode === 'bypass') {
      if (policy.requiresActiveAction && this.active === null) {
        throw new Error(`No active ${this.surface} action to receive input`);
      }
      if (policy.clearsQueue) {
        this.cancelQueued(`Cancelled by ${action.kind}`);
      }
      this.executeImmediate(action);
    } else {
      this.enqueue(action, policy);
    }
  }

  getActive(): SurfaceAction | null {
    return this.active;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  /** Remove a specific queued action by ID. Returns true if found and removed. */
  cancelById(id: string, reason: string): boolean {
    const idx = this.queue.findIndex(a => a.id === id);
    if (idx === -1) return false;
    const [removed] = this.queue.splice(idx, 1);
    this.onPolicyFail(removed, reason);
    return true;
  }

  private executeImmediate(action: SurfaceAction): void {
    // Fire-and-forget — bypass does not occupy the active slot or touch the queue.
    // Errors are handled inside the execute callback (router).
    try {
      Promise.resolve(this.execute(action)).catch(() => {});
    } catch {
      // Swallow synchronous throws from callback — bypass must not propagate.
    }
  }

  private cancelQueued(reason: string): void {
    const cancelled = this.queue.splice(0);
    for (const action of cancelled) {
      this.onPolicyFail(action, reason);
    }
  }

  private enqueue(action: SurfaceAction, policy: ActionConcurrencyPolicy): void {
    if (policy.replacesSameKind) {
      const superseded: SurfaceAction[] = [];
      this.queue = this.queue.filter(queued => {
        if (queued.kind === action.kind) {
          superseded.push(queued);
          return false;
        }
        return true;
      });
      for (const old of superseded) {
        this.onPolicyFail(old, `Superseded by newer ${action.kind}`);
      }
    }

    this.queue.push(action);
    if (this.active === null) {
      this.drain();
    }
  }

  private drain(): void {
    if (this.active !== null) return;
    const next = this.queue.shift();
    if (!next) return;

    this.active = next;
    Promise.resolve(this.execute(next))
      .catch(() => {
        // Error handling is done inside the execute callback (router).
        // drain() just needs to advance regardless.
      })
      .finally(() => {
        this.active = null;
        this.drain();
      });
  }
}
