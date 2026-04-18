import type { HandoffPacket, InvocationResult, TaskMemoryRecord } from '../../shared/types/model';
import type { BrowserFinding } from '../../shared/types/browserIntelligence';
export declare class TaskMemoryStore {
    private memoryByTask;
    constructor();
    get(taskId: string): TaskMemoryRecord;
    clearTask(taskId: string): void;
    hasEntries(taskId: string): boolean;
    getCategoryCounts(taskId: string): {
        claim: number;
        evidence: number;
        critique: number;
        verification: number;
    };
    getReasoningTexts(taskId: string, categories?: Array<'claim' | 'evidence' | 'critique' | 'verification'>): string[];
    findEvidenceConsistencyIssues(taskId: string, output: string): string[];
    recordUserPrompt(taskId: string, text: string, metadata?: Record<string, unknown>): TaskMemoryRecord;
    recordInvocationResult(result: InvocationResult): TaskMemoryRecord;
    recordBrowserFinding(finding: BrowserFinding): TaskMemoryRecord;
    recordClaim(taskId: string, text: string, metadata?: Record<string, unknown>): TaskMemoryRecord;
    recordEvidence(taskId: string, text: string, metadata?: Record<string, unknown>): TaskMemoryRecord;
    recordCritique(taskId: string, text: string, metadata?: Record<string, unknown>): TaskMemoryRecord;
    recordVerification(taskId: string, text: string, metadata?: Record<string, unknown>): TaskMemoryRecord;
    recordHandoff(packet: HandoffPacket): TaskMemoryRecord;
    buildContext(taskId: string, input?: {
        excludeEntryIds?: string[];
        maxChars?: number;
    }): string | null;
    private append;
    private formatEntryText;
    private formatContextEntryText;
}
export declare const taskMemoryStore: TaskMemoryStore;
