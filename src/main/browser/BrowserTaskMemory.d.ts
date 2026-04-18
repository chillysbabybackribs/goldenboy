import { BrowserFinding, BrowserTaskMemory } from '../../shared/types/browserIntelligence';
export declare class BrowserTaskMemoryStore {
    private memoryByTask;
    recordFinding(finding: BrowserFinding): BrowserTaskMemory;
    getTaskMemory(taskId: string): BrowserTaskMemory;
    clearTask(taskId: string): void;
    prune(now?: number): void;
}
