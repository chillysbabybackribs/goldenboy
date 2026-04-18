import { SurfaceActionKind } from '../../shared/actions/surfaceActionTypes';
export type ConcurrencyMode = 'serialize' | 'bypass';
export type ActionConcurrencyPolicy = {
    mode: ConcurrencyMode;
    replacesSameKind?: boolean;
    clearsQueue?: boolean;
    requiresActiveAction?: boolean;
};
export declare const ACTION_CONCURRENCY_POLICY: Record<SurfaceActionKind, ActionConcurrencyPolicy>;
