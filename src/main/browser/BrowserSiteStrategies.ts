import { BrowserSiteStrategy } from '../../shared/types/browserIntelligence';
import { loadSiteStrategies, saveSiteStrategies } from './BrowserIntelligenceStore';

function createDefaultStrategy(origin: string): BrowserSiteStrategy {
  return {
    origin,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    primaryRoutes: [],
    primaryLabels: [],
    panelKeywords: [],
    notes: [],
  };
}

export class BrowserSiteStrategyStore {
  private strategies = new Map<string, BrowserSiteStrategy>();

  constructor() {
    for (const strategy of loadSiteStrategies()) {
      if (strategy?.origin) {
        this.strategies.set(strategy.origin, strategy);
      }
    }
  }

  get(origin: string): BrowserSiteStrategy | null {
    if (!origin) return null;
    return this.strategies.get(origin) || null;
  }

  upsert(input: Partial<BrowserSiteStrategy> & { origin: string }): BrowserSiteStrategy {
    const current = this.strategies.get(input.origin) || createDefaultStrategy(input.origin);
    const next: BrowserSiteStrategy = {
      ...current,
      ...input,
      primaryRoutes: input.primaryRoutes ?? current.primaryRoutes,
      primaryLabels: input.primaryLabels ?? current.primaryLabels,
      panelKeywords: input.panelKeywords ?? current.panelKeywords,
      notes: input.notes ?? current.notes,
      updatedAt: Date.now(),
    };
    this.strategies.set(input.origin, next);
    saveSiteStrategies(Array.from(this.strategies.values()).sort((a, b) => a.origin.localeCompare(b.origin)));
    return next;
  }
}
