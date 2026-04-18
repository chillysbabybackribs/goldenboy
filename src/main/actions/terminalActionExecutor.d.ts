import { SurfaceActionKind } from '../../shared/actions/surfaceActionTypes';
import type { ActionResult } from './browserActionExecutor';
export declare function executeTerminalAction(kind: SurfaceActionKind, payload: Record<string, unknown>): Promise<ActionResult>;
