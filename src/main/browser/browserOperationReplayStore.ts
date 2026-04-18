import type {
  BrowserReplayStrictness,
  BrowserReplayValidationMode,
  BrowserTargetDescriptor,
  BrowserTargetValidationResult,
} from '../../shared/types/browserDeterministic';
import type {
  BrowserOperationContextId,
  BrowserOperationExecutionContext,
  BrowserOperationKind,
} from '../../shared/types/browserOperationLedger';
import type { BrowserOperationPayloadMap } from './browserOperations';

const DEFAULT_MAX_REPLAYABLE_OPERATIONS = 250;

export type BrowserOperationExecutionMeta = {
  replayOfOperationId?: string | null;
  targetDescriptor?: BrowserTargetDescriptor | null;
  validationMode?: BrowserReplayValidationMode;
  strictness?: BrowserReplayStrictness;
  preflightValidation?: BrowserTargetValidationResult | null;
};

export type ReplayableBrowserOperationRecord = {
  operationId: string;
  kind: BrowserOperationKind;
  payload: Record<string, unknown>;
  context?: BrowserOperationExecutionContext & BrowserOperationContextId;
  targetDescriptor: BrowserTargetDescriptor | null;
};

type ReplayableBrowserOperationInput<K extends BrowserOperationKind = BrowserOperationKind> = {
  kind: K;
  payload: BrowserOperationPayloadMap[K];
  context?: BrowserOperationExecutionContext & BrowserOperationContextId;
};

export class BrowserOperationReplayStore {
  private records = new Map<string, ReplayableBrowserOperationRecord>();

  constructor(private readonly maxEntries: number = DEFAULT_MAX_REPLAYABLE_OPERATIONS) {}

  save<K extends BrowserOperationKind>(
    operationId: string,
    input: ReplayableBrowserOperationInput<K>,
    targetDescriptor: BrowserTargetDescriptor | null,
  ): void {
    this.records.set(operationId, {
      operationId,
      kind: input.kind,
      payload: { ...(input.payload as Record<string, unknown>) },
      context: input.context ? { ...input.context } : undefined,
      targetDescriptor: targetDescriptor ? {
        ...targetDescriptor,
        evidence: { ...targetDescriptor.evidence },
      } : null,
    });

    if (this.records.size > this.maxEntries) {
      const staleOperationIds = Array.from(this.records.keys()).slice(0, this.records.size - this.maxEntries);
      for (const staleOperationId of staleOperationIds) {
        this.records.delete(staleOperationId);
      }
    }
  }

  get(operationId: string): ReplayableBrowserOperationRecord | null {
    const record = this.records.get(operationId);
    if (!record) return null;
    return {
      ...record,
      payload: { ...record.payload },
      context: record.context ? { ...record.context } : undefined,
      targetDescriptor: record.targetDescriptor ? {
        ...record.targetDescriptor,
        evidence: { ...record.targetDescriptor.evidence },
      } : null,
    };
  }

  clear(): void {
    this.records.clear();
  }
}

export const browserOperationReplayStore = new BrowserOperationReplayStore();

export function clearBrowserOperationReplayStore(): void {
  browserOperationReplayStore.clear();
}
