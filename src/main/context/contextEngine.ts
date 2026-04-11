import { DiskCache } from './diskCache';
import { PageExtractor } from './pageExtractor';
import { TokenBudget } from './tokenBudget';

type ExecuteInPage = (
  expression: string,
  tabId?: string,
) => Promise<{ result: unknown; error: string | null }>;

export class ContextEngine {
  private diskCache: DiskCache;
  private pageExtractor: PageExtractor;
  private activeTaskId: string | null = null;
  private budgets: Map<string, TokenBudget> = new Map();

  constructor(baseDir: string, executeInPage: ExecuteInPage) {
    this.diskCache = new DiskCache(baseDir);
    this.pageExtractor = new PageExtractor(executeInPage);
  }

  startTask(taskId: string): void {
    this.activeTaskId = taskId;
    this.budgets.set(taskId, new TokenBudget(100_000));
  }

  endTask(taskId: string): void {
    this.diskCache.cleanup(taskId);
    this.budgets.delete(taskId);
    if (this.activeTaskId === taskId) {
      this.activeTaskId = null;
    }
  }

  getDiskCache(): DiskCache {
    return this.diskCache;
  }

  getPageExtractor(): PageExtractor {
    return this.pageExtractor;
  }

  getTokenBudget(): TokenBudget {
    if (this.activeTaskId) {
      const budget = this.budgets.get(this.activeTaskId);
      if (budget) return budget;
    }
    return new TokenBudget(100_000);
  }

  recordTokens(inputTokens: number, outputTokens: number): void {
    if (this.activeTaskId) {
      const budget = this.budgets.get(this.activeTaskId);
      if (budget) {
        budget.recordTurn(inputTokens, outputTokens);
      }
    }
  }

  async getWorkspaceSummary(taskId: string): Promise<string> {
    const pages = await this.diskCache.listPages(taskId);

    if (pages.length === 0) {
      return 'No pages cached yet.';
    }

    const lines: string[] = [];
    lines.push(`${pages.length} pages cached:`);
    pages.forEach((page, i) => {
      lines.push(`${i + 1}. [${page.tabId}] ${page.title} — ${page.url}`);
    });

    const budget = this.budgets.get(taskId);
    if (budget && budget.turnCount > 0) {
      lines.push('');
      lines.push(
        `Token usage: ${budget.cumulativeInput} input, ${budget.turnCount} turns, ~${budget.estimatedRemainingTurns} turns remaining`,
      );
    }

    return lines.join('\n');
  }

  async extractPageToDisk(taskId: string, tabId: string): Promise<void> {
    const [content, elements] = await Promise.all([
      this.pageExtractor.extractContent(tabId),
      this.pageExtractor.extractElements(tabId),
    ]);

    await this.diskCache.writePageContent(taskId, tabId, {
      url: content.url,
      title: content.title,
      content: content.content,
    });

    await this.diskCache.writePageElements(taskId, tabId, {
      url: content.url,
      elements: elements.elements,
      forms: elements.forms,
    });
  }
}
