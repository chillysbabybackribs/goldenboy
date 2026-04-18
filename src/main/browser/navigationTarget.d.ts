type SearchEngine = 'google' | 'duckduckgo' | 'bing';
export type NavigationTargetKind = 'direct-url' | 'search' | 'local-file';
export type NormalizedNavigationTarget = {
    url: string;
    kind: NavigationTargetKind;
};
export declare function normalizeNavigationTarget(rawInput: string, input: {
    searchEngine: SearchEngine;
    cwd?: string;
}): NormalizedNavigationTarget;
export {};
