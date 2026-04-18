"use strict";
// ═══════════════════════════════════════════════════════════════════════════
// BrowserPageAnalysis — Search result extraction, evidence, comparison,
// research brief synthesis
// ═══════════════════════════════════════════════════════════════════════════
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrowserPageAnalysis = void 0;
const SEARCH_RESULT_CONTAINER_SELECTORS = [
    '[data-sokoban-container]',
    '[data-hveid]',
    '.g',
    '.MjjYud',
    '.tF2Cxc',
    '.yuRUbf',
    '.Ww4FFb',
    '.b_algo',
    '.b_ans',
    '[data-testid="result"]',
    '.result',
    '.result__body',
    '.results_links',
    'article',
];
const SUPPRESSED_SEARCH_RESULT_REGION_SELECTORS = [
    'header',
    'nav',
    'footer',
    'aside',
    '[role="navigation"]',
    '[role="dialog"]',
    '[aria-modal="true"]',
];
const SEARCH_ENGINE_UTILITY_HOSTS = new Set([
    'support.google.com',
    'policies.google.com',
    'accounts.google.com',
    'myaccount.google.com',
    'consent.google.com',
    'support.microsoft.com',
    'account.microsoft.com',
]);
const SEARCH_ENGINE_UTILITY_PATH_RE = /^\/(?:$|search(?:\/|$)|preferences(?:\/|$)|advanced_search(?:\/|$)|setprefs(?:\/|$)|sorry(?:\/|$)|imgres(?:\/|$)|support(?:\/|$)|webhp(?:\/|$)|history(?:\/|$)|policies(?:\/|$)|privacy(?:\/|$)|terms(?:\/|$)|about(?:\/|$)|account(?:\/|$)|consent(?:\/|$)|settings(?:\/|$)|help(?:\/|$))/i;
const SUPPRESSED_SEARCH_RESULT_SELECTOR_RE = /(^|>|\s)(header|nav|footer|aside)(?=$|[.#:\s>])/i;
class BrowserPageAnalysis {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    // ─── Extract Search Results ─────────────────────────────────────────────
    async extractSearchResults(tabId, limit = 10) {
        const entry = this.deps.resolveEntry(tabId);
        if (!entry)
            return [];
        const resultContainerSelectors = JSON.stringify(SEARCH_RESULT_CONTAINER_SELECTORS);
        const suppressedRegionSelectors = JSON.stringify(SUPPRESSED_SEARCH_RESULT_REGION_SELECTORS);
        const { result, error } = await this.deps.executeInPage(`
      (() => {
        const RESULT_CONTAINER_SELECTORS = ${resultContainerSelectors};
        const SUPPRESSED_REGION_SELECTORS = ${suppressedRegionSelectors};
        const isVisible = (el) => {
          if (!(el instanceof HTMLElement)) return false;
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
            parts.unshift(selector);
            node = node.parentElement;
          }
          return parts.join(' > ');
        };
        const normalizeUrl = (href) => {
          try { return new URL(href, location.href).href; } catch { return ''; }
        };
        const resultContainerSelector = RESULT_CONTAINER_SELECTORS.join(', ');
        const suppressedRegionSelector = SUPPRESSED_REGION_SELECTORS.join(', ');
        const isSuppressedRegion = (el) => {
          if (!(el instanceof Element) || !suppressedRegionSelector) return false;
          return Boolean(el.closest(suppressedRegionSelector));
        };
        const skipUrl = (url) => {
          if (!url) return true;
          try {
            const parsed = new URL(url);
            if (!/^https?:$/.test(parsed.protocol)) return true;
            if (parsed.origin === location.origin && /^\\/($|search|preferences|advanced_search)/.test(parsed.pathname)) return true;
            if (/google\\.[^/]+$/.test(parsed.hostname) && parsed.pathname === '/search') return true;
            return false;
          } catch {
            return true;
          }
        };
        const anchors = Array.from(document.querySelectorAll('a[href]'))
          .filter(el => el instanceof HTMLAnchorElement && isVisible(el) && !isSuppressedRegion(el));
        const seen = new Set();
        const scored = anchors.map((anchor) => {
          const url = normalizeUrl(anchor.getAttribute('href') || '');
          const title = (anchor.querySelector('h3')?.textContent || anchor.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 180);
          const container = anchor.closest(resultContainerSelector);
          const snippet = ((container instanceof HTMLElement ? container.innerText : anchor.textContent) || '')
            .replace(/\\s+/g, ' ')
            .trim()
            .slice(0, 280);
          const heading = anchor.querySelector('h3, h2') || container?.querySelector?.('h3, h2');
          const likelySearchResult = Boolean(
            heading
            || container
            || (anchor.closest('main') && title.length >= 24 && snippet.length >= 80)
          );
          let score = 0;
          if (heading) score += 4;
          if (container) score += 2;
          if (title.length > 12) score += 2;
          if (snippet.length > title.length + 20) score += 1;
          if (likelySearchResult) score += 3;
          if (url && !skipUrl(url)) score += 2;
          const source = likelySearchResult ? 'search' : 'generic';
          return { url, title, snippet, selector: cssPath(anchor), score, source, likelySearchResult };
        })
        .filter(item => item.url && !skipUrl(item.url) && item.title && item.likelySearchResult)
        .filter(item => {
          if (seen.has(item.url)) return false;
          seen.add(item.url);
          return true;
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, ${Math.max(1, Math.floor(limit)) * 4})
        .map((item, index) => ({ index, url: item.url, title: item.title, snippet: item.snippet, selector: item.selector, source: item.source }));
        return scored;
      })()
    `, entry.id);
        if (error || !Array.isArray(result))
            return [];
        return filterSearchResultCandidates(result, {
            limit,
            searchOrigin: safeOrigin(entry.info.navigation?.url),
        });
    }
    // ─── Open Search Results Tabs ───────────────────────────────────────────
    async openSearchResultsTabs(input) {
        const sourceEntry = this.deps.resolveEntry(input.tabId);
        if (!sourceEntry)
            return { success: false, openedTabIds: [], urls: [], sourceResults: [], error: 'No active tab' };
        const results = await this.extractSearchResults(sourceEntry.id, Math.max(input.limit ?? 10, 1));
        if (results.length === 0) {
            return { success: false, openedTabIds: [], urls: [], sourceResults: [], error: 'No search results detected' };
        }
        const targets = Array.isArray(input.indices) && input.indices.length > 0
            ? input.indices.map(index => results.find(result => result.index === index)).filter(Boolean)
            : results.slice(0, Math.max(1, input.limit ?? 10));
        if (targets.length === 0) {
            return { success: false, openedTabIds: [], urls: [], sourceResults: results, error: 'Requested result indices were unavailable' };
        }
        const originalTabId = this.deps.activeTabId();
        const openedTabs = targets.map(target => this.deps.createTab(target.url));
        if (input.activateFirst && openedTabs[0]) {
            this.deps.activateTab(openedTabs[0].id);
        }
        else if (originalTabId) {
            this.deps.activateTab(originalTabId);
        }
        return {
            success: true,
            openedTabIds: openedTabs.map(tab => tab.id),
            urls: targets.map(target => target.url),
            sourceResults: results,
            error: null,
        };
    }
    // ─── Summarize Tab Working Set ──────────────────────────────────────────
    async summarizeTabWorkingSet(tabIds) {
        const ids = Array.isArray(tabIds) && tabIds.length > 0
            ? tabIds
            : this.deps.getTabs().map(tab => tab.id);
        const summaries = [];
        for (const id of ids) {
            const entry = this.deps.resolveEntry(id);
            if (!entry)
                continue;
            const snapshot = await this.deps.captureTabSnapshot(id);
            summaries.push({
                tabId: id,
                url: snapshot.url,
                title: snapshot.title,
                mainHeading: snapshot.mainHeading,
                activeSurfaceType: snapshot.viewport.activeSurfaceType,
                activeSurfaceLabel: snapshot.viewport.activeSurfaceLabel,
                activeSurfaceConfidence: snapshot.viewport.activeSurfaceConfidence,
                isPrimarySurface: snapshot.viewport.isPrimarySurface,
                excerpt: snapshot.visibleTextExcerpt.slice(0, 240),
            });
        }
        return summaries;
    }
    // ─── Extract Page Evidence ──────────────────────────────────────────────
    async extractPageEvidence(tabId) {
        const entry = this.deps.resolveEntry(tabId);
        if (!entry)
            return null;
        const snapshot = await this.deps.captureTabSnapshot(entry.id);
        const { result, error } = await this.deps.executeInPage(`
      (() => {
        const clean = (text) => (text || '').replace(/\\s+/g, ' ').trim();
        const visible = (el) => {
          if (!(el instanceof HTMLElement)) return false;
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        const bodyText = clean(document.body?.innerText || '');
        const sentenceCandidates = bodyText
          .split(/(?<=[.!?])\\s+/)
          .map(clean)
          .filter(Boolean);
        const paragraphs = Array.from(document.querySelectorAll('main p, article p, p'))
          .filter(visible)
          .map(el => clean(el.textContent || ''))
          .filter(Boolean);
        const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
          .filter(visible)
          .map(el => clean(el.textContent || ''))
          .filter(Boolean);
        const quotes = Array.from(document.querySelectorAll('blockquote, q'))
          .filter(visible)
          .map(el => clean(el.textContent || ''))
          .filter(Boolean);
        const links = Array.from(document.querySelectorAll('a[href]'))
          .filter(visible)
          .map(el => {
            try { return new URL(el.getAttribute('href') || '', location.href).href; } catch { return ''; }
          })
          .filter(Boolean);
        const dateRegex = /\\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[ ]+\\d{1,2},?[ ]+\\d{4}\\b|\\b\\d{4}-\\d{2}-\\d{2}\\b|\\b\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}\\b/g;
        const dated = Array.from(new Set((bodyText.match(dateRegex) || []).map(clean))).slice(0, 8);
        const factual = sentenceCandidates
          .filter(text => text.length >= 40 && text.length <= 260)
          .filter(text => /\\d|%|said|announced|reported|according|study|research|released|launched|founded|raised|acquired|lawsuit|court|policy|update/i.test(text))
          .slice(0, 8);
        return {
          headings: headings.slice(0, 8),
          paragraphs: paragraphs.slice(0, 6),
          quotes: quotes.slice(0, 5),
          dates: dated,
          sourceLinks: Array.from(new Set(links)).slice(0, 8),
          factual,
        };
      })()
    `, entry.id);
        const extracted = (!error && result && typeof result === 'object') ? result : null;
        const summary = extracted?.paragraphs?.[0]
            || extracted?.factual?.[0]
            || snapshot.visibleTextExcerpt.slice(0, 220);
        return {
            tabId: entry.id,
            url: snapshot.url,
            title: snapshot.title,
            mainHeading: snapshot.mainHeading,
            summary,
            keyFacts: extracted?.factual?.slice(0, 5) || [],
            quotes: extracted?.quotes?.slice(0, 3) || [],
            dates: extracted?.dates?.slice(0, 6) || [],
            sourceLinks: extracted?.sourceLinks?.slice(0, 5) || [],
            activeSurfaceType: snapshot.viewport.activeSurfaceType,
            activeSurfaceLabel: snapshot.viewport.activeSurfaceLabel,
        };
    }
    // ─── Compare Tabs ───────────────────────────────────────────────────────
    async compareTabs(tabIds) {
        const ids = Array.isArray(tabIds) && tabIds.length > 0 ? tabIds : this.deps.getTabs().map(tab => tab.id);
        const evidence = (await Promise.all(ids.map(id => this.extractPageEvidence(id)))).filter(Boolean);
        const termCounts = new Map();
        const stopWords = new Set(['the', 'and', 'that', 'with', 'from', 'this', 'have', 'were', 'their', 'about', 'which', 'would', 'there', 'into', 'could', 'after', 'before', 'because', 'while', 'where', 'when', 'what', 'your']);
        for (const item of evidence) {
            const tokens = new Set(`${item.title} ${item.mainHeading} ${item.summary}`
                .toLowerCase()
                .split(/[^a-z0-9]+/)
                .filter(token => token.length >= 4 && !stopWords.has(token)));
            for (const token of tokens) {
                termCounts.set(token, (termCounts.get(token) || 0) + 1);
            }
        }
        const commonTerms = Array.from(termCounts.entries())
            .filter(([, count]) => count >= 2)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([term]) => term);
        const allDates = Array.from(new Set(evidence.flatMap(item => item.dates))).slice(0, 12);
        const headings = evidence.map(item => ({ tabId: item.tabId, heading: item.mainHeading || item.title }));
        return {
            tabCount: evidence.length,
            commonTerms,
            datesMentioned: allDates,
            headings,
            tabs: evidence,
        };
    }
    // ─── Synthesize Research Brief ──────────────────────────────────────────
    async synthesizeResearchBrief(input) {
        const comparison = await this.compareTabs(input?.tabIds);
        const tabs = comparison.tabs || [];
        const keyFindings = tabs.flatMap(tab => tab.keyFacts.slice(0, 2).map(fact => ({
            tabId: tab.tabId,
            title: tab.title,
            url: tab.url,
            fact,
        }))).slice(0, 10);
        const sourceCount = tabs.length;
        const question = input?.question?.trim() || '';
        const narrative = [
            question ? `Question: ${question}` : '',
            sourceCount > 0 ? `Reviewed ${sourceCount} tab${sourceCount === 1 ? '' : 's'} across the current working set.` : 'No source tabs were available.',
            keyFindings.length > 0 ? `Top finding: ${keyFindings[0].fact}` : '',
            Array.isArray(comparison.commonTerms) && comparison.commonTerms.length > 0
                ? `Shared themes: ${comparison.commonTerms.slice(0, 5).join(', ')}.`
                : '',
        ].filter(Boolean).join(' ');
        return {
            question: question || null,
            narrative,
            sourceCount,
            commonTerms: comparison.commonTerms,
            datesMentioned: comparison.datesMentioned,
            keyFindings,
            sources: tabs.map(tab => ({
                tabId: tab.tabId,
                title: tab.title,
                url: tab.url,
                summary: tab.summary,
            })),
        };
    }
    // ─── Rank Actionable Elements ───────────────────────────────────────────
    rankActionableElements(snapshot, options) {
        const preferDismiss = !!options?.preferDismiss;
        const dismissRe = /\b(close|dismiss|cancel|done|got it|not now|skip|back|hide|x)\b/i;
        const overlayToggleRe = /\b(notification|notifications|activity|inbox|messages|menu)\b/i;
        const items = snapshot.actionableElements
            .filter(el => el.visible && el.enabled && !!el.ref.selector)
            .map((el) => {
            const text = `${el.text} ${el.ariaLabel}`.trim();
            let score = Math.round(el.confidence * 100);
            const reasons = [];
            if (el.actionability.includes('clickable')) {
                score += 35;
                reasons.push('clickable');
            }
            if (snapshot.viewport.modalPresent) {
                score += 20;
                reasons.push('foreground-ui-open');
            }
            if (preferDismiss && dismissRe.test(text)) {
                score += 140;
                reasons.push('dismiss-match');
            }
            if (preferDismiss && overlayToggleRe.test(text)) {
                score += 80;
                reasons.push('overlay-toggle');
            }
            if (el.tagName === 'button') {
                score += 15;
                reasons.push('button');
            }
            if (el.actionability.includes('navigational') && snapshot.viewport.modalPresent) {
                score -= 50;
                reasons.push('background-navigation');
            }
            if (!text) {
                score -= 20;
                reasons.push('no-label');
            }
            return {
                ...el,
                rankScore: score,
                rankReason: reasons.join(', ') || 'default',
            };
        })
            .sort((a, b) => b.rankScore - a.rankScore);
        return items;
    }
}
exports.BrowserPageAnalysis = BrowserPageAnalysis;
function filterSearchResultCandidates(candidates, input) {
    const seen = new Set();
    return candidates
        .map(candidate => ({
        ...candidate,
        url: normalizeSearchResultUrl(candidate.url),
        title: normalizeSearchResultText(candidate.title, 180),
        snippet: normalizeSearchResultText(candidate.snippet, 280),
    }))
        .filter(candidate => candidate.url && candidate.title)
        .filter(candidate => !shouldSkipSearchResultCandidate(candidate, input.searchOrigin))
        .filter(candidate => {
        if (seen.has(candidate.url))
            return false;
        seen.add(candidate.url);
        return true;
    })
        .slice(0, Math.max(1, Math.floor(input.limit)))
        .map((candidate, index) => ({ ...candidate, index }));
}
function normalizeSearchResultUrl(rawUrl) {
    const parsed = safeParseUrl(rawUrl);
    if (!parsed)
        return '';
    if (/google\.[^/]+$/i.test(parsed.hostname) && parsed.pathname === '/url') {
        const redirect = parsed.searchParams.get('q') || parsed.searchParams.get('url');
        const normalizedRedirect = normalizeHttpUrl(redirect || '');
        if (normalizedRedirect)
            return normalizedRedirect;
    }
    if (/duckduckgo\.com$/i.test(parsed.hostname) && /^\/l(?:\/|\.js$)/i.test(parsed.pathname)) {
        const redirect = parsed.searchParams.get('uddg');
        const normalizedRedirect = normalizeHttpUrl(redirect || '');
        if (normalizedRedirect)
            return normalizedRedirect;
    }
    return parsed.href;
}
function shouldSkipSearchResultCandidate(candidate, searchOrigin) {
    const parsed = safeParseUrl(candidate.url);
    if (!parsed || !/^https?:$/i.test(parsed.protocol))
        return true;
    if (candidate.selector && SUPPRESSED_SEARCH_RESULT_SELECTOR_RE.test(candidate.selector))
        return true;
    if (searchOrigin && parsed.origin === searchOrigin && SEARCH_ENGINE_UTILITY_PATH_RE.test(parsed.pathname))
        return true;
    if (candidate.source !== 'search') {
        if (SEARCH_ENGINE_UTILITY_HOSTS.has(parsed.hostname.toLowerCase()))
            return true;
        if (/google\.[^/]+$/i.test(parsed.hostname) && SEARCH_ENGINE_UTILITY_PATH_RE.test(parsed.pathname))
            return true;
    }
    return false;
}
function normalizeSearchResultText(value, maxLength) {
    return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}
function safeOrigin(rawUrl) {
    const parsed = safeParseUrl(rawUrl || '');
    return parsed?.origin;
}
function safeParseUrl(rawUrl) {
    try {
        return new URL(rawUrl);
    }
    catch {
        return null;
    }
}
function normalizeHttpUrl(rawUrl) {
    const parsed = safeParseUrl(rawUrl);
    if (!parsed || !/^https?:$/i.test(parsed.protocol))
        return null;
    return parsed.href;
}
//# sourceMappingURL=BrowserPageAnalysis.js.map