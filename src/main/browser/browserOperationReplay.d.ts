import type { BrowserReplayRequest } from '../../shared/types/browserDeterministic';
import type { BrowserTargetValidationResult } from '../../shared/types/browserDeterministic';
export declare function replayBrowserOperation(request: BrowserReplayRequest): Promise<{
    replayedOperationId: string | null;
    sourceOperationId: string;
    validation: BrowserTargetValidationResult | null;
    result: {
        summary: string;
        data: Record<string, unknown>;
    } | null;
}>;
