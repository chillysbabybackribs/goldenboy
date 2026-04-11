import {
  BrowserSurfaceEvalFixture,
  BrowserSiteStrategy,
  BrowserActionableElement,
  BrowserFormFieldModel,
  BrowserFormModel,
  BrowserSnapshot,
  BrowserViewportModel,
} from '../../shared/types/browserIntelligence';
import { resolveBrowserSurface, SurfaceEvidence } from '../../shared/browser/surfaceResolver';
import { generateId } from '../../shared/utils/ids';

type ExecuteInPage = (expression: string, tabId?: string) => Promise<{ result: unknown; error: string | null }>;

type SnapshotPayload = {
  url: string;
  title: string;
  mainHeading: string;
  visibleTextExcerpt: string;
  modalPresent: boolean;
  foregroundUiType: BrowserViewportModel['foregroundUiType'];
  foregroundUiLabel: string;
  foregroundUiSelector: string;
  foregroundUiConfidence: number;
  activeSurfaceType: BrowserViewportModel['activeSurfaceType'];
  activeSurfaceLabel: string;
  activeSurfaceSelector: string;
  activeSurfaceConfidence: number;
  isPrimarySurface: boolean;
  actionableElements: BrowserActionableElement[];
  forms: BrowserFormModel[];
};

type PerceptionCapture = {
  payload: SnapshotPayload;
  evidence: SurfaceEvidence;
};

function normalizeActionable(raw: any, tabId: string): BrowserActionableElement {
  return {
    id: raw.id || generateId('act'),
    ref: {
      tabId,
      frameId: null,
      selector: raw.selector || '',
    },
    role: raw.role || '',
    tagName: raw.tagName || 'unknown',
    text: raw.text || '',
    ariaLabel: raw.ariaLabel || '',
    href: raw.href || null,
    boundingBox: raw.boundingBox || null,
    actionability: Array.isArray(raw.actionability) ? raw.actionability : ['unknown'],
    visible: raw.visible !== false,
    enabled: raw.enabled !== false,
    confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.5,
  };
}

function normalizeField(raw: any, tabId: string): BrowserFormFieldModel {
  return {
    id: raw.id || generateId('field'),
    ref: {
      tabId,
      frameId: null,
      selector: raw.selector || '',
    },
    kind: raw.kind || 'unknown',
    label: raw.label || '',
    name: raw.name || '',
    placeholder: raw.placeholder || '',
    required: !!raw.required,
    visible: raw.visible !== false,
    valuePreview: raw.valuePreview || '',
  };
}

function normalizeForm(raw: any, tabId: string): BrowserFormModel {
  return {
    id: raw.id || generateId('form'),
    formRef: raw.selector ? { tabId, frameId: null, selector: raw.selector } : null,
    purpose: raw.purpose || 'unknown',
    method: raw.method || 'GET',
    action: raw.action || '',
    fields: Array.isArray(raw.fields) ? raw.fields.map((f: any) => normalizeField(f, tabId)) : [],
    submitLabels: Array.isArray(raw.submitLabels) ? raw.submitLabels : [],
  };
}

export class BrowserPerception {
  constructor(private readonly executeInPage: ExecuteInPage) {}

  async captureTabSnapshot(tabId: string, strategy?: BrowserSiteStrategy | null): Promise<BrowserSnapshot> {
    const { payload } = await this.capturePerception(tabId, strategy || null);
    const viewport: BrowserViewportModel = {
      url: payload.url,
      title: payload.title,
      mainHeading: payload.mainHeading,
      visibleTextExcerpt: payload.visibleTextExcerpt,
      modalPresent: payload.modalPresent,
      foregroundUiType: payload.foregroundUiType,
      foregroundUiLabel: payload.foregroundUiLabel,
      foregroundUiSelector: payload.foregroundUiSelector,
      foregroundUiConfidence: payload.foregroundUiConfidence,
      activeSurfaceType: payload.activeSurfaceType,
      activeSurfaceLabel: payload.activeSurfaceLabel,
      activeSurfaceSelector: payload.activeSurfaceSelector,
      activeSurfaceConfidence: payload.activeSurfaceConfidence,
      isPrimarySurface: payload.isPrimarySurface,
      actionableCount: payload.actionableElements.length,
    };

    return {
      id: generateId('snap'),
      tabId,
      capturedAt: Date.now(),
      url: payload.url,
      title: payload.title,
      mainHeading: payload.mainHeading,
      visibleTextExcerpt: payload.visibleTextExcerpt,
      actionableElements: payload.actionableElements,
      forms: payload.forms,
      viewport,
    };
  }

  async getActionableElements(tabId: string, strategy?: BrowserSiteStrategy | null): Promise<BrowserActionableElement[]> {
    const { payload } = await this.capturePerception(tabId, strategy || null);
    return payload.actionableElements;
  }

  async getFormModel(tabId: string, strategy?: BrowserSiteStrategy | null): Promise<BrowserFormModel[]> {
    const { payload } = await this.capturePerception(tabId, strategy || null);
    return payload.forms;
  }

  async exportSurfaceEvalFixture(
    tabId: string,
    name: string,
    strategy?: BrowserSiteStrategy | null,
  ): Promise<BrowserSurfaceEvalFixture> {
    const { payload, evidence } = await this.capturePerception(tabId, strategy || null);
    return {
      name,
      evidence: {
        ...evidence,
        strategy: evidence.strategy,
      },
      resolved: {
        foregroundUiType: payload.foregroundUiType,
        foregroundUiLabel: payload.foregroundUiLabel,
        foregroundUiConfidence: payload.foregroundUiConfidence,
        activeSurfaceType: payload.activeSurfaceType,
        activeSurfaceLabel: payload.activeSurfaceLabel,
        activeSurfaceConfidence: payload.activeSurfaceConfidence,
        isPrimarySurface: payload.isPrimarySurface,
      },
    };
  }

  private async capturePerception(tabId: string, strategy: BrowserSiteStrategy | null): Promise<PerceptionCapture> {
    const { result, error } = await this.executeInPage(`
      (() => {
        const isVisible = (el) => {
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };

        const cssPath = (el) => {
          if (!(el instanceof Element)) return '';
          const parts = [];
          let node = el;
          while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
            let selector = node.tagName.toLowerCase();
            if (node.id) {
              selector += '#' + CSS.escape(node.id);
              parts.unshift(selector);
              break;
            }
            const className = typeof node.className === 'string'
              ? node.className.trim().split(/\\s+/).filter(Boolean).slice(0, 2).map(c => '.' + CSS.escape(c)).join('')
              : '';
            selector += className;
            const parent = node.parentElement;
            if (parent) {
              const siblings = Array.from(parent.children).filter(child => child.tagName === node.tagName);
              if (siblings.length > 1) {
                selector += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
              }
            }
            parts.unshift(selector);
            node = parent;
          }
          return parts.join(' > ');
        };

        const textFor = (el) => {
          if (!(el instanceof Element)) return '';
          const raw = [
            el.getAttribute('aria-label') || '',
            el.getAttribute('data-e2e') || '',
            el.getAttribute('data-testid') || '',
            el.getAttribute('id') || '',
            typeof el.className === 'string' ? el.className : '',
            (el instanceof HTMLElement ? el.innerText : el.textContent) || '',
          ].join(' ');
          return raw.replace(/\\s+/g, ' ').trim().slice(0, 160);
        };

        const interactivePanelRe = /\\b(notification|notifications|activity|inbox|message|messages|menu|popover|popup|drawer|panel)\\b/i;
        const actionableTriggerSelector = 'button, [role="button"], a[href], [tabindex]';
        const panelCandidateSelector = [
          '[role="dialog"]',
          'dialog',
          '[aria-modal="true"]',
          '[data-e2e*="drawer"]',
          '[data-e2e*="dialog"]',
          '[data-e2e*="popover"]',
          '[data-e2e*="popup"]',
          '[id*="inbox"]',
          '[id*="notification"]',
          '[id*="activity"]',
          '[class*="inbox"]',
          '[class*="notification"]',
          '[class*="activity"]',
        ].join(',');

        const panelCandidates = Array.from(document.querySelectorAll(panelCandidateSelector))
            .filter(el => el instanceof HTMLElement && isVisible(el))
            .map((el) => {
              const rect = el.getBoundingClientRect();
              return {
                selector: cssPath(el),
                area: rect.width * rect.height,
                text: textFor(el),
                position: ['fixed', 'absolute', 'sticky'].includes(window.getComputedStyle(el).position)
                  ? window.getComputedStyle(el).position
                  : 'flow',
                fromExpandedTrigger: false,
                rect: { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom },
              };
            });

          const expandedTriggers = Array.from(document.querySelectorAll(actionableTriggerSelector))
            .filter(el => el instanceof HTMLElement && isVisible(el) && el.getAttribute('aria-expanded') === 'true');

          const expandedTriggerLabels = expandedTriggers.map(trigger => textFor(trigger)).filter(Boolean).slice(0, 12);

          const linkedPanels = expandedTriggers
            .map((trigger) => {
              const controlsId = trigger.getAttribute('aria-controls') || trigger.getAttribute('aria-owns') || '';
              const controlled = controlsId ? document.getElementById(controlsId) : null;
              const triggerRect = trigger.getBoundingClientRect();
              const matchedPanel = controlled instanceof HTMLElement && isVisible(controlled)
                ? {
                    selector: cssPath(controlled),
                    area: controlled.getBoundingClientRect().width * controlled.getBoundingClientRect().height,
                    text: textFor(controlled),
                    position: ['fixed', 'absolute', 'sticky'].includes(window.getComputedStyle(controlled).position)
                      ? window.getComputedStyle(controlled).position
                      : 'flow',
                    fromExpandedTrigger: true,
                  }
                : panelCandidates
                    .filter((panel) => {
                      const sameVerticalBand = Math.abs(panel.rect.top - triggerRect.bottom) < 360
                        || Math.abs(panel.rect.top - triggerRect.top) < 240;
                      const sameHorizontalBand = Math.abs(panel.rect.right - triggerRect.right) < 320
                        || Math.abs(panel.rect.left - triggerRect.left) < 320;
                      const labelOverlap = interactivePanelRe.test(panel.text) || interactivePanelRe.test(textFor(trigger));
                      return panel.area > 8000 && sameVerticalBand && sameHorizontalBand && labelOverlap;
                    })
                    .sort((a, b) => b.area - a.area)[0];
              if (!matchedPanel) return null;
              return {
                selector: matchedPanel.selector,
                label: matchedPanel.text || textFor(trigger) || controlsId,
                area: matchedPanel.area,
                position: matchedPanel.position,
                fromExpandedTrigger: true,
              };
            })
            .filter(Boolean);
        const actionableSelector = [
          'a[href]',
          'button',
          'input',
          'textarea',
          'select',
          '[role="button"]',
          '[role="link"]',
          '[tabindex]'
        ].join(',');

        const actionableElements = Array.from(document.querySelectorAll(actionableSelector))
          .slice(0, 100)
          .map((el, index) => {
            const rect = el.getBoundingClientRect();
            const tagName = el.tagName.toLowerCase();
            const type = tagName === 'input' ? (el.getAttribute('type') || 'text').toLowerCase() : '';
            const actionability = [];
            if (tagName === 'a' || el.getAttribute('role') === 'link') actionability.push('navigational', 'clickable');
            if (tagName === 'button' || el.getAttribute('role') === 'button') actionability.push('clickable');
            if (['input', 'textarea', 'select'].includes(tagName)) actionability.push('typeable');
            if (actionability.length === 0) actionability.push('unknown');
            return {
              id: 'act_' + index,
              selector: cssPath(el),
              role: el.getAttribute('role') || '',
              tagName,
              text: (el.innerText || el.textContent || '').trim().slice(0, 160),
              ariaLabel: el.getAttribute('aria-label') || '',
              href: el.getAttribute('href'),
              boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              actionability,
              visible: isVisible(el),
              enabled: !((el).disabled),
              confidence: isVisible(el) ? 0.85 : 0.35,
              inputType: type,
            };
          });

        const forms = Array.from(document.forms).slice(0, 20).map((form, formIndex) => {
          const fields = Array.from(form.elements)
            .filter(el => el instanceof HTMLElement)
            .slice(0, 30)
            .map((el, fieldIndex) => {
              const tagName = el.tagName.toLowerCase();
              const type = tagName === 'input' ? (((el).getAttribute('type') || 'text').toLowerCase()) : tagName;
              const label = (el.getAttribute('aria-label')
                || (el.labels && el.labels[0] && el.labels[0].innerText)
                || el.getAttribute('placeholder')
                || el.getAttribute('name')
                || '').trim();
              const value = 'value' in el ? String(el.value || '') : '';
              return {
                id: 'field_' + formIndex + '_' + fieldIndex,
                selector: cssPath(el),
                kind: type,
                label,
                name: el.getAttribute('name') || '',
                placeholder: el.getAttribute('placeholder') || '',
                required: el.hasAttribute('required'),
                visible: isVisible(el),
                valuePreview: value.slice(0, 60),
              };
            });

          const submitLabels = Array.from(form.querySelectorAll('button, input[type="submit"]'))
            .map(el => (el instanceof HTMLInputElement ? el.value : el.textContent || '').trim())
            .filter(Boolean)
            .slice(0, 5);

          const purpose = submitLabels[0]
            || fields.find(f => /email|password|username|search/i.test(f.label))?.label
            || 'unknown';

          return {
            id: 'form_' + formIndex,
            selector: cssPath(form),
            purpose,
            method: (form.getAttribute('method') || 'GET').toUpperCase(),
            action: form.getAttribute('action') || '',
            fields,
            submitLabels,
          };
        });

        const mainHeading = (document.querySelector('h1')?.textContent || document.title || '').trim().slice(0, 200);
        const visibleTextExcerpt = (document.body ? document.body.innerText : '').trim().slice(0, 1200);
        const hasFeedMarkers = /\\bfor you\\b|\\bfollowing\\b|\\bexplore\\b|\\blive\\b/.test(visibleTextExcerpt.toLowerCase());
        const hasMessagesMarkers = /\\bmessages\\b/.test(visibleTextExcerpt.toLowerCase());
        const hasNotificationsMarkers = /\\bnotifications\\b/.test(visibleTextExcerpt.toLowerCase());
        const hasActivityMarkers = /\\bactivity\\b/.test(visibleTextExcerpt.toLowerCase());
        const hasVisibleForm = !!document.querySelector('form input:not([type="hidden"]), form textarea, form select');

        return {
          url: location.href,
          pathname: location.pathname,
          title: document.title,
          mainHeading,
          visibleTextExcerpt,
          expandedTriggerLabels,
          panelCandidates: [...linkedPanels, ...panelCandidates.map(panel => ({
            selector: panel.selector,
            label: panel.text,
            area: panel.area,
            position: panel.position,
            fromExpandedTrigger: panel.fromExpandedTrigger,
          }))].slice(0, 20),
          hasFeedMarkers,
          hasMessagesMarkers,
          hasNotificationsMarkers,
          hasActivityMarkers,
          hasVisibleForm,
          actionableElements,
          forms,
        };
      })()
    `, tabId);

    if (error || !result || typeof result !== 'object') {
      return {
        payload: {
          url: '',
          title: '',
          mainHeading: '',
          visibleTextExcerpt: error || 'Unable to capture tab snapshot',
          modalPresent: false,
          foregroundUiType: 'none',
          foregroundUiLabel: '',
          foregroundUiSelector: '',
          foregroundUiConfidence: 0,
          activeSurfaceType: 'unknown',
          activeSurfaceLabel: '',
          activeSurfaceSelector: '',
          activeSurfaceConfidence: 0,
          isPrimarySurface: false,
          actionableElements: [],
          forms: [],
        },
        evidence: {
          url: '',
          pathname: '',
          title: '',
          mainHeading: '',
          visibleTextExcerpt: error || 'Unable to capture tab snapshot',
          expandedTriggerLabels: [],
          panelCandidates: [],
          hasFeedMarkers: false,
          hasMessagesMarkers: false,
          hasNotificationsMarkers: false,
          hasActivityMarkers: false,
          hasVisibleForm: false,
          strategy: strategy ? {
            primaryRoutes: strategy.primaryRoutes,
            primaryLabels: strategy.primaryLabels,
            panelKeywords: strategy.panelKeywords,
          } : undefined,
        },
      };
    }

    const raw = result as any;
    const evidence: SurfaceEvidence = {
      url: raw.url || '',
      pathname: raw.pathname || '',
      title: raw.title || '',
      mainHeading: raw.mainHeading || '',
      visibleTextExcerpt: raw.visibleTextExcerpt || '',
      expandedTriggerLabels: Array.isArray(raw.expandedTriggerLabels) ? raw.expandedTriggerLabels : [],
      panelCandidates: Array.isArray(raw.panelCandidates) ? raw.panelCandidates.map((panel: any) => ({
        selector: panel.selector || '',
        label: panel.label || '',
        area: typeof panel.area === 'number' ? panel.area : 0,
        position: panel.position === 'fixed' || panel.position === 'absolute' || panel.position === 'sticky' ? panel.position : 'flow',
        fromExpandedTrigger: !!panel.fromExpandedTrigger,
      })) : [],
      hasFeedMarkers: !!raw.hasFeedMarkers,
      hasMessagesMarkers: !!raw.hasMessagesMarkers,
      hasNotificationsMarkers: !!raw.hasNotificationsMarkers,
      hasActivityMarkers: !!raw.hasActivityMarkers,
      hasVisibleForm: !!raw.hasVisibleForm,
      strategy: strategy ? {
        primaryRoutes: strategy.primaryRoutes,
        primaryLabels: strategy.primaryLabels,
        panelKeywords: strategy.panelKeywords,
      } : undefined,
    };
    const resolved = resolveBrowserSurface(evidence);
    const payload: SnapshotPayload = {
      url: raw.url || '',
      title: raw.title || '',
      mainHeading: raw.mainHeading || '',
      visibleTextExcerpt: raw.visibleTextExcerpt || '',
      modalPresent: resolved.foregroundUi.type !== 'none',
      foregroundUiType: resolved.foregroundUi.type,
      foregroundUiLabel: resolved.foregroundUi.label,
      foregroundUiSelector: resolved.foregroundUi.selector,
      foregroundUiConfidence: resolved.foregroundUi.confidence,
      activeSurfaceType: resolved.activeSurface.type,
      activeSurfaceLabel: resolved.activeSurface.label,
      activeSurfaceSelector: resolved.activeSurface.selector,
      activeSurfaceConfidence: resolved.activeSurface.confidence,
      isPrimarySurface: resolved.activeSurface.isPrimarySurface,
      actionableElements: Array.isArray(raw.actionableElements)
        ? raw.actionableElements.map((item: any) => normalizeActionable(item, tabId))
        : [],
      forms: Array.isArray(raw.forms)
        ? raw.forms.map((item: any) => normalizeForm(item, tabId))
        : [],
    };
    return { payload, evidence };
  }
}
