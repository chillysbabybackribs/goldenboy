export type SurfaceEvidencePanel = {
    selector: string;
    label: string;
    area: number;
    position: 'fixed' | 'absolute' | 'sticky' | 'flow';
    fromExpandedTrigger: boolean;
};
export type SurfaceEvidence = {
    url: string;
    pathname: string;
    title: string;
    mainHeading: string;
    visibleTextExcerpt: string;
    expandedTriggerLabels: string[];
    panelCandidates: SurfaceEvidencePanel[];
    hasFeedMarkers: boolean;
    hasMessagesMarkers: boolean;
    hasNotificationsMarkers: boolean;
    hasActivityMarkers: boolean;
    hasVisibleForm: boolean;
    strategy?: {
        primaryRoutes?: string[];
        primaryLabels?: string[];
        panelKeywords?: string[];
    };
};
export type ResolvedForegroundUi = {
    type: 'none' | 'dropdown' | 'drawer' | 'dialog' | 'popover' | 'overlay' | 'panel';
    label: string;
    selector: string;
    confidence: number;
    reasons: string[];
};
export type ResolvedActiveSurface = {
    type: 'feed' | 'panel' | 'section' | 'modal' | 'drawer' | 'form' | 'unknown';
    label: string;
    selector: string;
    confidence: number;
    isPrimarySurface: boolean;
    reasons: string[];
};
export type ResolvedBrowserSurface = {
    foregroundUi: ResolvedForegroundUi;
    activeSurface: ResolvedActiveSurface;
};
export declare function resolveBrowserSurface(evidence: SurfaceEvidence): ResolvedBrowserSurface;
