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

function uniqueReasons(reasons: string[]): string[] {
  return Array.from(new Set(reasons.filter(Boolean)));
}

function chooseFeedLabel(evidence: SurfaceEvidence): string {
  const title = evidence.title || '';
  const heading = evidence.mainHeading || '';
  const excerpt = evidence.visibleTextExcerpt || '';
  const preferredLabels = evidence.strategy?.primaryLabels || [];
  const candidates = [
    ...preferredLabels,
    'For You',
    'Home',
    'Shorts',
    'Subscriptions',
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const re = new RegExp(`\\b${candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(heading) || re.test(title) || re.test(excerpt)) {
      return candidate;
    }
  }

  return heading || title || 'feed';
}

export function resolveBrowserSurface(evidence: SurfaceEvidence): ResolvedBrowserSurface {
  const pathname = (evidence.pathname || '').toLowerCase();
  const title = (evidence.title || '').toLowerCase();
  const heading = (evidence.mainHeading || '').toLowerCase();
  const excerpt = (evidence.visibleTextExcerpt || '').toLowerCase();
  const primaryRoutes = evidence.strategy?.primaryRoutes?.map(route => route.toLowerCase()) || [];
  const primaryLabels = evidence.strategy?.primaryLabels?.map(label => label.toLowerCase()) || [];
  const panelKeywords = evidence.strategy?.panelKeywords?.map(keyword => keyword.toLowerCase()) || [];

  let foreground: ResolvedForegroundUi = {
    type: 'none',
    label: '',
    selector: '',
    confidence: 0,
    reasons: [],
  };

  const sortedPanels = [...evidence.panelCandidates].sort((a, b) => {
    const triggerBias = Number(b.fromExpandedTrigger) - Number(a.fromExpandedTrigger);
    return triggerBias || b.area - a.area;
  });

  const bestPanel = sortedPanels[0];
  if (bestPanel) {
    const panelLabel = bestPanel.label.toLowerCase();
    const isPanelLike = evidence.hasNotificationsMarkers
      || evidence.hasActivityMarkers
      || evidence.hasMessagesMarkers
      || panelKeywords.some(keyword => panelLabel.includes(keyword));
    const type = bestPanel.position === 'fixed' || bestPanel.position === 'absolute'
      ? 'panel'
      : bestPanel.fromExpandedTrigger ? 'dropdown' : 'panel';
    const confidence = Math.min(
      0.98,
      0.45
        + (bestPanel.fromExpandedTrigger ? 0.25 : 0)
        + (isPanelLike ? 0.18 : 0)
        + (bestPanel.area > 12000 ? 0.1 : 0),
    );
    if (confidence >= 0.7) {
      foreground = {
        type,
        label: bestPanel.label,
        selector: bestPanel.selector,
        confidence,
        reasons: uniqueReasons([
          bestPanel.fromExpandedTrigger ? 'expanded-trigger-match' : '',
          isPanelLike ? 'panel-keywords' : '',
          bestPanel.area > 12000 ? 'large-visible-panel' : '',
        ]),
      };
    }
  }

  let activeSurface: ResolvedActiveSurface = {
    type: 'unknown',
    label: '',
    selector: '',
    confidence: 0.2,
    isPrimarySurface: false,
    reasons: [],
  };

  if (foreground.type !== 'none') {
    activeSurface = {
      type: foreground.type === 'drawer' ? 'drawer' : foreground.type === 'dialog' || foreground.type === 'popover' ? 'modal' : 'panel',
      label: foreground.label,
      selector: foreground.selector,
      confidence: Math.max(0.75, foreground.confidence),
      isPrimarySurface: false,
      reasons: uniqueReasons(['foreground-ui-active', ...foreground.reasons]),
    };
  } else {
    let primaryScore = 0;
    const primaryReasons: string[] = [];
    if (/\/foryou|^\/$|^\/en\/?$/.test(pathname)) {
      primaryScore += 0.45;
      primaryReasons.push('primary-route');
    }
    if (primaryRoutes.some(route => route && pathname.startsWith(route))) {
      primaryScore += 0.35;
      primaryReasons.push('strategy-primary-route');
    }
    if (evidence.hasFeedMarkers) {
      primaryScore += 0.3;
      primaryReasons.push('feed-markers');
    }
    if (/\bfor you\b/.test(excerpt) || /\bfor you\b/.test(heading) || /\bfor you\b/.test(title)) {
      primaryScore += 0.2;
      primaryReasons.push('for-you-visible');
    }
    if (primaryLabels.some(label => excerpt.includes(label) || heading.includes(label) || title.includes(label))) {
      primaryScore += 0.15;
      primaryReasons.push('strategy-primary-label');
    }

    let sectionScore = 0;
    const sectionReasons: string[] = [];
    if (/\/messages|\/inbox|\/notifications|business-suite\/messages/.test(pathname)) {
      sectionScore += 0.55;
      sectionReasons.push('section-route');
    }
    if (evidence.hasMessagesMarkers || evidence.hasNotificationsMarkers || evidence.hasActivityMarkers) {
      sectionScore += 0.25;
      sectionReasons.push('section-markers');
    }

    if (primaryScore >= sectionScore && primaryScore >= 0.45) {
      activeSurface = {
        type: 'feed',
        label: chooseFeedLabel(evidence),
        selector: '',
        confidence: Math.min(0.98, primaryScore),
        isPrimarySurface: true,
        reasons: uniqueReasons(primaryReasons),
      };
    } else if (sectionScore >= 0.45) {
      activeSurface = {
        type: 'section',
        label: /messages/.test(pathname) ? 'messages' : evidence.hasActivityMarkers ? 'activity' : evidence.hasNotificationsMarkers ? 'notifications' : 'section',
        selector: '',
        confidence: Math.min(0.95, sectionScore),
        isPrimarySurface: false,
        reasons: uniqueReasons(sectionReasons),
      };
    } else if (evidence.hasVisibleForm) {
      activeSurface = {
        type: 'form',
        label: 'form',
        selector: '',
        confidence: 0.55,
        isPrimarySurface: false,
        reasons: ['visible-form'],
      };
    }
  }

  return { foregroundUi: foreground, activeSurface };
}
