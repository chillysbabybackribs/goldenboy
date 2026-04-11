import {
  BrowserFinding,
  BrowserTaskMemory,
  createEmptyBrowserTaskMemory,
} from '../../shared/types/browserIntelligence';

const MAX_TASK_MEMORY_RECORDS = 200;
const TASK_MEMORY_TTL_MS = 6 * 60 * 60 * 1000;

export class BrowserTaskMemoryStore {
  private memoryByTask = new Map<string, BrowserTaskMemory>();

  recordFinding(finding: BrowserFinding): BrowserTaskMemory {
    const current = this.memoryByTask.get(finding.taskId) || createEmptyBrowserTaskMemory(finding.taskId);
    const next: BrowserTaskMemory = {
      ...current,
      lastUpdatedAt: finding.createdAt,
      findings: [...current.findings, finding],
      tabsTouched: current.tabsTouched.includes(finding.tabId)
        ? current.tabsTouched
        : [...current.tabsTouched, finding.tabId],
      snapshotIds: finding.snapshotId && !current.snapshotIds.includes(finding.snapshotId)
        ? [...current.snapshotIds, finding.snapshotId]
        : current.snapshotIds,
    };
    this.memoryByTask.set(finding.taskId, next);
    this.prune();
    return next;
  }

  getTaskMemory(taskId: string): BrowserTaskMemory {
    return this.memoryByTask.get(taskId) || createEmptyBrowserTaskMemory(taskId);
  }

  clearTask(taskId: string): void {
    this.memoryByTask.delete(taskId);
  }

  prune(now = Date.now()): void {
    for (const [taskId, memory] of this.memoryByTask.entries()) {
      if ((memory.lastUpdatedAt ?? 0) <= now - TASK_MEMORY_TTL_MS) {
        this.memoryByTask.delete(taskId);
      }
    }

    if (this.memoryByTask.size <= MAX_TASK_MEMORY_RECORDS) return;

    const oldest = Array.from(this.memoryByTask.entries())
      .sort(([, a], [, b]) => (a.lastUpdatedAt ?? 0) - (b.lastUpdatedAt ?? 0));
    for (const [taskId] of oldest) {
      if (this.memoryByTask.size <= MAX_TASK_MEMORY_RECORDS) break;
      this.memoryByTask.delete(taskId);
    }
  }
}
