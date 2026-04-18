import type { SurfaceAction, SurfaceTarget } from '../../shared/actions/surfaceActionTypes';
import type { ActionConcurrencyPolicy } from './surfaceActionPolicy';
export type ExecuteCallback = (action: SurfaceAction) => Promise<void>;
export type FailCallback = (action: SurfaceAction, reason: string) => void;
export declare class SurfaceExecutionController {
    readonly surface: SurfaceTarget;
    private readonly execute;
    private readonly onPolicyFail;
    private queue;
    private active;
    constructor(surface: SurfaceTarget, execute: ExecuteCallback, onPolicyFail: FailCallback);
    submit(action: SurfaceAction, policy: ActionConcurrencyPolicy): void;
    getActive(): SurfaceAction | null;
    getQueueLength(): number;
    /** Remove a specific queued action by ID. Returns true if found and removed. */
    cancelById(id: string, reason: string): boolean;
    private executeImmediate;
    private cancelQueued;
    private enqueue;
    private drain;
}
