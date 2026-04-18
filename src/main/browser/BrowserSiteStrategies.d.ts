import { BrowserSiteStrategy } from '../../shared/types/browserIntelligence';
export declare class BrowserSiteStrategyStore {
    private strategies;
    constructor();
    get(origin: string): BrowserSiteStrategy | null;
    upsert(input: Partial<BrowserSiteStrategy> & {
        origin: string;
    }): BrowserSiteStrategy;
}
