import { SurfaceActionInput, SurfaceActionRecord, SurfaceActionKind } from '../../shared/actions/surfaceActionTypes';
declare class SurfaceActionRouter {
    private browserController;
    private terminalController;
    constructor();
    submit<K extends SurfaceActionKind>(input: SurfaceActionInput<K>): Promise<SurfaceActionRecord>;
    cancelQueuedAction(id: string): SurfaceActionRecord;
    getQueueDiagnostics(): {
        browser: {
            active: string | null;
            queueLength: number;
        };
        terminal: {
            active: string | null;
            queueLength: number;
        };
    };
    getRecentActions(limit?: number): SurfaceActionRecord[];
    getActionsByTarget(target: 'browser' | 'terminal', limit?: number): SurfaceActionRecord[];
    getActionsByTask(taskId: string): SurfaceActionRecord[];
    private executeAction;
    private failActionByPolicy;
    private validatePayload;
    private updateStatus;
    private updateRecord;
    private getCurrentRecord;
    private toRecord;
}
export declare const surfaceActionRouter: SurfaceActionRouter;
export {};
