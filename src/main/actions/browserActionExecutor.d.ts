import { SurfaceActionKind } from '../../shared/actions/surfaceActionTypes';
import { BrowserOperationResult } from '../browser/browserOperations';
export type ActionResult = BrowserOperationResult;
type BrowserActionExecutionContext = {
    taskId?: string | null;
    origin?: 'command-center' | 'system' | 'model';
    contextId?: string | null;
};
export declare function executeBrowserAction(kind: SurfaceActionKind, payload: Record<string, unknown>, context?: BrowserActionExecutionContext): Promise<ActionResult>;
export {};
