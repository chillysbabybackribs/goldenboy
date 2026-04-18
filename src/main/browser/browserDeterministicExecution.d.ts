import type { BrowserReplayStrictness, BrowserReplayValidationMode, BrowserTargetDescriptor, BrowserTargetValidationResult } from '../../shared/types/browserDeterministic';
import type { BrowserOperationKind } from '../../shared/types/browserOperationLedger';
import type { BrowserContextService } from './browserContext';
type SupportedDeterministicKind = 'browser.navigate' | 'browser.click' | 'browser.type';
type OperationPayloadMap = {
    'browser.navigate': {
        url: string;
    };
    'browser.click': {
        selector: string;
        tabId?: string;
    };
    'browser.type': {
        selector: string;
        text: string;
        tabId?: string;
    };
};
type SupportedDeterministicInput<K extends SupportedDeterministicKind = SupportedDeterministicKind> = {
    kind: K;
    payload: OperationPayloadMap[K];
    contextId: string;
    tabId: string | null;
};
type TargetDescriptorBuildResult = {
    descriptor: BrowserTargetDescriptor | null;
    preflightValidation: BrowserTargetValidationResult | null;
    resolvedSelector: string | null;
};
export declare function buildTargetDescriptor(browser: BrowserContextService, input: SupportedDeterministicInput): Promise<TargetDescriptorBuildResult>;
export declare function validateOperationOutcome(browser: BrowserContextService, input: SupportedDeterministicInput, descriptor: BrowserTargetDescriptor, result: {
    summary: string;
    data: Record<string, unknown>;
}, preflightValidation?: BrowserTargetValidationResult | null): Promise<BrowserTargetValidationResult>;
export declare function validateReplayPreflight(browser: BrowserContextService, descriptor: BrowserTargetDescriptor | null): Promise<{
    validation: BrowserTargetValidationResult | null;
    resolvedSelector: string | null;
}>;
export declare function shouldAbortReplay(validation: BrowserTargetValidationResult | null, strictness: BrowserReplayStrictness): boolean;
export declare function resolveReplayValidationMode(mode?: BrowserReplayValidationMode | null): BrowserReplayValidationMode;
export declare function resolveReplayStrictness(strictness?: BrowserReplayStrictness | null): BrowserReplayStrictness;
export declare function isReplaySupportedOperation(kind: BrowserOperationKind): kind is SupportedDeterministicKind;
export {};
