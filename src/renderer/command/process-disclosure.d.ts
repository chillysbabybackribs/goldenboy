export type ProcessDisclosureEntry = {
    kind: 'thought' | 'tool';
    text: string;
};
type ProcessDisclosureOptions = {
    open?: boolean;
    detailsClassName?: string;
    summaryClassName?: string;
    innerClassName?: string;
};
export declare function getProcessSummaryLabel(toolCount: number): string;
export declare function createProcessDisclosureShell(toolCount: number, options?: ProcessDisclosureOptions): {
    details: HTMLDetailsElement;
    inner: HTMLDivElement;
};
export declare function createProcessDisclosure(entries: ProcessDisclosureEntry[], options?: ProcessDisclosureOptions): HTMLDetailsElement | null;
export {};
