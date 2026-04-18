import type { BrowserActionability } from './browserIntelligence';
import type { BrowserOperationKind } from './browserOperationLedger';

export type BrowserTargetDescriptorKind = 'navigation' | 'actionable-element' | 'form-field';

export type BrowserTargetDescriptor = {
  id: string;
  kind: BrowserTargetDescriptorKind;
  contextId: string;
  tabId: string | null;
  snapshotId: string | null;
  operationKind: BrowserOperationKind;
  createdAt: number;
  evidence: {
    selector: string | null;
    text: string | null;
    ariaLabel: string | null;
    role: string | null;
    tagName: string | null;
    href: string | null;
    fieldKind: string | null;
    label: string | null;
    name: string | null;
    placeholder: string | null;
    boundingBox: { x: number; y: number; width: number; height: number } | null;
    actionability: BrowserActionability[];
    confidence: number | null;
    expectedUrl: string | null;
  };
};

export type BrowserValidationStatus = 'matched' | 'ambiguous' | 'missing' | 'failed';

export type BrowserTargetValidationResult = {
  status: BrowserValidationStatus;
  phase: 'preflight' | 'postflight';
  summary: string;
  evidenceUsed: string[];
  expected: Record<string, string | number | boolean | null>;
  observed: Record<string, string | number | boolean | null>;
  validatedAt: number;
};

export type BrowserReplayValidationMode = 'none' | 'basic';

export type BrowserReplayStrictness = 'strict' | 'best-effort';

export type BrowserReplayRequest = {
  sourceOperationId: string;
  contextId?: string | null;
  validationMode?: BrowserReplayValidationMode;
  strictness?: BrowserReplayStrictness;
};
