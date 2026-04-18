"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrowserSiteStrategyStore = void 0;
const BrowserIntelligenceStore_1 = require("./BrowserIntelligenceStore");
function createDefaultStrategy(origin) {
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
class BrowserSiteStrategyStore {
    strategies = new Map();
    constructor() {
        for (const strategy of (0, BrowserIntelligenceStore_1.loadSiteStrategies)()) {
            if (strategy?.origin) {
                this.strategies.set(strategy.origin, strategy);
            }
        }
    }
    get(origin) {
        if (!origin)
            return null;
        return this.strategies.get(origin) || null;
    }
    upsert(input) {
        const current = this.strategies.get(input.origin) || createDefaultStrategy(input.origin);
        const next = {
            ...current,
            ...input,
            primaryRoutes: input.primaryRoutes ?? current.primaryRoutes,
            primaryLabels: input.primaryLabels ?? current.primaryLabels,
            panelKeywords: input.panelKeywords ?? current.panelKeywords,
            notes: input.notes ?? current.notes,
            updatedAt: Date.now(),
        };
        this.strategies.set(input.origin, next);
        (0, BrowserIntelligenceStore_1.saveSiteStrategies)(Array.from(this.strategies.values()).sort((a, b) => a.origin.localeCompare(b.origin)));
        return next;
    }
}
exports.BrowserSiteStrategyStore = BrowserSiteStrategyStore;
//# sourceMappingURL=BrowserSiteStrategies.js.map