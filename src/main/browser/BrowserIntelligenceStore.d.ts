import { BrowserSiteStrategy, BrowserSurfaceEvalFixture } from '../../shared/types/browserIntelligence';
export declare function loadSiteStrategies(): BrowserSiteStrategy[];
export declare function saveSiteStrategies(strategies: BrowserSiteStrategy[]): void;
export declare function appendSurfaceFixture(fixture: BrowserSurfaceEvalFixture): void;
export declare function getSurfaceFixturesPath(): string;
