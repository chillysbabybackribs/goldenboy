import { AgentToolDefinition } from '../../AgentTypes';
import { browserService } from '../../../browser/BrowserService';
import { PageExtractor } from '../../../context/pageExtractor';
import { pageKnowledgeStore } from '../../../browserKnowledge/PageKnowledgeStore';
import { appStateStore } from '../../../state/appStateStore';
import { ActionType } from '../../../state/actions';
import { generateId } from '../../../../shared/utils/ids';
import { WebIntentInstruction, WebIntentVM } from '../../../browser/WebIntentVM';
import { agentCache } from '../../AgentCache';
import { normalizeWebsiteTarget } from '../../../browser/navigationTarget';
import { listRegisteredBrowserWorkflows, runRegisteredBrowserWorkflow } from '../../workflows';
import {
  BrowserOperationKind,
  BrowserOperationPayloadMap,
  BrowserOperationResult,
  executeBrowserOperation,
} from '../../../browser/browserOperations';
import type { BrowserFindingSeverity } from '../../../../shared/types/browserIntelligence';
import {
  DeterministicTabService,
  openTabDeterministic,
} from './openTabDeterministic';
import { isTabDeterministic } from './isTabDeterministic';
import { DeterministicKernel } from '../../../browser/determinism/DeterministicKernel';
import { createElectronKernelCapabilities } from '../../../browser/determinism/adapters/electronKernelCapabilities';
import { userAgentPin } from '../../../browser/determinism/pins/userAgentPin';
import { visualPin } from '../../../browser/determinism/pins/visualPin';
import { networkBlocklistPin } from '../../../browser/determinism/pins/networkBlocklistPin';
import { viewportPin } from '../../../browser/determinism/pins/viewportPin';
import { localeTimezonePin } from '../../../browser/determinism/pins/localeTimezonePin';
import { seedAndClockPin } from '../../../browser/determinism/pins/seedAndClockPin';
import type { DeterminismConfig } from '../../../browser/determinism/kernelTypes';
import { sanitizeResearchQuery } from '../../research/querySanitizer';
import { probeSerps } from '../../research/serpProbe';
import { scoreCandidates, pickTopX, type ScoredCandidate } from '../../research/candidateScoring';
import { scoreEvidence, cleanSnippet } from '../../research/scoreEvidence';

const GOOGLE_HOME_URL = 'https://www.google.com/';

let determinismKernel: DeterministicKernel | null = null;

function getKernel(): DeterministicKernel {
  if (!determinismKernel) {
    determinismKernel = new DeterministicKernel({
      capabilities: createElectronKernelCapabilities({ browserService }),
      pins: [
        userAgentPin,
        visualPin,
        viewportPin,
        localeTimezonePin,
        seedAndClockPin,
        networkBlocklistPin,
      ],
    });
  }
  return determinismKernel;
}

function normalizeDeterministicInput(raw: unknown): true | Record<string, unknown> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (raw === true) return true;
  if (raw === false) return undefined;
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  throw new TypeError('browser.open_tab: deterministic must be boolean or an object');
}

function objectInput(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? input as Record<string, unknown> : {};
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Expected non-empty string input: ${key}`);
  }
  return value;
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function optionalNumber(input: Record<string, unknown>, key: string, fallback: number): number {
  const value = input[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function optionalBoolean(input: Record<string, unknown>, key: string): boolean {
  return input[key] === true;
}

function optionalStringArray(input: Record<string, unknown>, key: string): string[] {
  const value = input[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : [];
}

function logBrowserCache(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
  appStateStore.dispatch({
    type: ActionType.ADD_LOG,
    log: {
      id: generateId('log'),
      timestamp: Date.now(),
      level,
      source: 'browser',
      message,
    },
  });
}

function invalidateBrowserCaches(): void {
  agentCache.invalidateByToolPrefix('browser.');
}

function requireBrowserCreated(): void {
  if (!browserService.isCreated()) {
    throw new Error('Browser surface is not initialized yet. Open the execution window before using browser tools.');
  }
}

/**
 * Compact tab inventory echoed on action-tool responses so the model keeps an
 * up-to-date cross-tab working memory without re-calling `browser.tabs` after
 * every navigation or interaction. Intentionally trimmed to id/url/title/loading
 * to avoid dominating the response payload.
 */
function compactTabInventory(): Array<{ id: string; url: string; title: string; isLoading: boolean }> {
  return browserService.getTabs().map((tab) => ({
    id: tab.id,
    url: tab.navigation.url,
    title: tab.navigation.title,
    isLoading: tab.navigation.isLoading,
  }));
}

function withTabEcho(result: BrowserOperationResult): BrowserOperationResult {
  const activeTabId = browserService.getState().activeTabId;
  return {
    summary: result.summary,
    data: {
      ...result.data,
      activeTabId,
      isDeterministic: isTabDeterministic(activeTabId, determinismKernel),
      tabs: compactTabInventory(),
    },
  };
}

async function runBrowserOperation<K extends BrowserOperationKind>(
  kind: K,
  payload: BrowserOperationPayloadMap[K],
  input?: { invalidateCache?: boolean },
): Promise<BrowserOperationResult> {
  const result = await executeBrowserOperation({ kind, payload });
  if (input?.invalidateCache) invalidateBrowserCaches();
  return result;
}

function includesText(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export function buildWaitForTextExpression(): string {
  return `(() => {
    const parts = [];
    if (document.body?.innerText) parts.push(document.body.innerText);
    for (const element of document.querySelectorAll('input, textarea, select')) {
      if (element instanceof HTMLSelectElement) {
        const selectedText = Array.from(element.selectedOptions || [])
          .map(option => option.textContent || '')
          .join('\\n')
          .trim();
        if (selectedText) parts.push(selectedText);
        if (element.value) parts.push(element.value);
        continue;
      }
      if ('value' in element && typeof element.value === 'string' && element.value.trim()) {
        parts.push(element.value);
      }
    }
    return parts.join('\\n');
  })()`;
}

function compactText(text: string | undefined, maxChars: number): string {
  const cleaned = (text || '').replace(/\s+/g, ' ').trim();
  return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars)}...` : cleaned;
}

async function waitForBrowserSettled(timeoutMs = 7000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = browserService.getState();
    if (!state.navigation.isLoading) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

function requireWebsiteTarget(input: string): string {
  const normalized = normalizeWebsiteTarget(input);
  if (!normalized) {
    throw new Error('Expected a website address or domain, for example "example.com" or "example".');
  }
  return normalized;
}

async function cachePageForTab(
  pageExtractor: PageExtractor,
  tabId: string,
  taskId?: string,
): Promise<{
  id: string;
  tabId: string;
  url: string;
  title: string;
  chunkIds: string[];
}> {
  const content = await pageExtractor.extractContent(tabId);
  const page = pageKnowledgeStore.cachePage({
    tabId,
    url: content.url,
    title: content.title,
    content: content.content,
    tier: content.tier,
    taskId: taskId ?? browserService.getActiveTaskId() ?? undefined,
  });
  return {
    id: page.id,
    tabId: page.tabId,
    url: page.url,
    title: page.title,
    chunkIds: page.chunkIds,
  };
}

async function waitForCondition(input: {
  selector?: string;
  text?: string;
  state: 'present' | 'absent';
  tabId?: string;
  timeoutMs: number;
}): Promise<{ success: boolean; elapsedMs: number; matched: boolean }> {
  const start = Date.now();
  while (Date.now() - start < input.timeoutMs) {
    let matched = false;
    if (input.selector) {
      const query = JSON.stringify(input.selector);
      const result = await browserService.executeInPage(
        `Boolean(document.querySelector(${query}))`,
        input.tabId,
      );
      matched = result.result === true;
    }
    if (input.text) {
      const result = await browserService.executeInPage(
        buildWaitForTextExpression(),
        input.tabId,
      );
      matched = matched || (typeof result.result === 'string' && includesText(result.result, input.text));
    }

    const success = input.state === 'present' ? matched : !matched;
    if (success) {
      return { success: true, elapsedMs: Date.now() - start, matched };
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return { success: false, elapsedMs: Date.now() - start, matched: false };
}

export function createBrowserToolDefinitions(): AgentToolDefinition[] {
  const pageExtractor = new PageExtractor((expression, tabId) => browserService.executeInPage(expression, tabId));
  const webIntentVm = new WebIntentVM({
    async navigate(url, tabId) {
      if (tabId) {
        await runBrowserOperation('browser.activate-tab', { tabId });
      }
      await runBrowserOperation('browser.navigate', { url });
    },
    async waitForSettled(timeoutMs = 7000) {
      await waitForBrowserSettled(timeoutMs);
    },
    async getCurrentUrl(tabId) {
      if (tabId) {
        const tab = browserService.getTabs().find(item => item.id === tabId);
        if (tab?.navigation.url) return tab.navigation.url;
      }
      return browserService.getState().navigation.url;
    },
    async readPageState(tabId) {
      const snapshot = await browserService.captureTabSnapshot(tabId);
      return {
        url: snapshot.url,
        title: snapshot.title,
        text: snapshot.visibleTextExcerpt,
        mainHeading: snapshot.mainHeading,
      };
    },
    async getDialogs(tabId) {
      const result = await runBrowserOperation('browser.get-dialogs', { tabId });
      return (result.data.dialogs as ReturnType<typeof browserService.getPendingDialogs>) || [];
    },
    async acceptDialog(input) {
      const result = await runBrowserOperation('browser.accept-dialog', input, { invalidateCache: true });
      return result.data.result as Awaited<ReturnType<typeof browserService.acceptDialog>>;
    },
    async dismissDialog(input) {
      const result = await runBrowserOperation('browser.dismiss-dialog', input, { invalidateCache: true });
      return result.data.result as Awaited<ReturnType<typeof browserService.dismissDialog>>;
    },
    async getActionableElements(tabId) {
      const result = await runBrowserOperation('browser.get-actionable-elements', { tabId });
      return (result.data.elements as Awaited<ReturnType<typeof browserService.getActionableElements>>) || [];
    },
    async getFormModel(tabId) {
      return browserService.getFormModel(tabId);
    },
    async click(selector, tabId) {
      const result = await runBrowserOperation('browser.click', { selector, tabId }, { invalidateCache: true });
      return result.data.result as Awaited<ReturnType<typeof browserService.clickElement>>;
    },
    async type(selector, text, tabId) {
      const result = await runBrowserOperation('browser.type', { selector, text, tabId }, { invalidateCache: true });
      return result.data.result as Awaited<ReturnType<typeof browserService.typeInElement>>;
    },
    async upload(selector, filePath, tabId) {
      const result = await runBrowserOperation('browser.upload-file', { selector, filePath, tabId }, { invalidateCache: true });
      return result.data.result as Awaited<ReturnType<typeof browserService.uploadFileToElement>>;
    },
    async drag(sourceSelector, targetSelector, tabId) {
      const result = await runBrowserOperation(
        'browser.drag',
        { sourceSelector, targetSelector, tabId },
        { invalidateCache: true },
      );
      return result.data.result as Awaited<ReturnType<typeof browserService.dragElement>>;
    },
    async hover(selector, tabId) {
      const result = await runBrowserOperation('browser.hover', { selector, tabId }, { invalidateCache: true });
      return result.data.result as Awaited<ReturnType<typeof browserService.hoverElement>>;
    },
    async executeInPage(expression, tabId) {
      return browserService.executeInPage(expression, tabId);
    },
  });

  // Runs the headless-SERP-probe research path. Called from
  // browser.research_search when probeSerps returned at least one
  // quality-scored candidate. Auto-navigates the active tab to the
  // top candidate, opens the rest as new tabs, caches each page,
  // scores the evidence, and optionally stops early.
  async function runHeadlessResearchPath(args: {
    query: string;
    effectiveQuery: string;
    sanitize: { sanitized: string; strippedOperators: string[] };
    probe: Awaited<ReturnType<typeof probeSerps>>;
    scored: ScoredCandidate[];
    top: ScoredCandidate[];
    maxPages: number;
    stopWhenAnswerFound: boolean;
    minEvidenceScore: number;
    context: { taskId?: string; onProgress?: (message: string) => void };
    progress: (message: string) => void;
  }): Promise<{ summary: string; data: Record<string, unknown> }> {
    const {
      query,
      effectiveQuery,
      sanitize,
      probe,
      scored,
      top,
      maxPages,
      stopWhenAnswerFound,
      minEvidenceScore,
      context,
      progress,
    } = args;

    const openedPages: Array<Record<string, unknown>> = [];
    const skippedResults: Array<Record<string, unknown>> = [];
    let stoppedEarly = false;
    let stopReason = '';

    let usedActiveTab = false;
    const activeTabId = browserService.getState().activeTabId;

    for (let i = 0; i < top.length; i++) {
      const cand = top[i];
      progress(`opening candidate ${i + 1}/${top.length} (score ${cand.qualityScore}): ${compactText(cand.title, 80)}`);

      let tabId: string;
      if (!usedActiveTab && activeTabId) {
        // Point the visible tab at the top candidate directly — the
        // user never sees a SERP page. `normalize: false` because
        // the probe already produced an absolute http(s) URL.
        await runBrowserOperation(
          'browser.navigate',
          { url: cand.url, normalize: false } as unknown as BrowserOperationPayloadMap['browser.navigate'],
          { invalidateCache: true },
        );
        tabId = activeTabId;
        usedActiveTab = true;
      } else {
        const createTabResult = await runBrowserOperation('browser.create-tab', { url: cand.url });
        const id = typeof createTabResult.data.tabId === 'string' ? createTabResult.data.tabId : '';
        if (!id) throw new Error(`Browser create-tab did not return a tab id for ${cand.url}`);
        tabId = id;
      }
      await waitForBrowserSettled(10_000);

      const [page, evidence] = await Promise.all([
        cachePageForTab(pageExtractor, tabId, context.taskId),
        browserService.extractPageEvidence(tabId),
      ]);
      const relevantChunks = pageKnowledgeStore.answerFromCache(effectiveQuery, {
        tabId,
        limit: 4,
        taskId: context.taskId,
        activeTabId: browserService.getState().activeTabId,
      });
      const matchSnippets = relevantChunks.matches.map(m => m.snippet);
      const score = scoreEvidence({
        query: effectiveQuery,
        title: evidence?.title || page.title || cand.title,
        url: evidence?.url || page.url || cand.url,
        summary: evidence?.summary,
        keyFacts: evidence?.keyFacts,
        matchSnippets,
      });
      const sufficient = score.score >= minEvidenceScore || score.sufficient;
      progress(
        sufficient
          ? `candidate ${i + 1} appears sufficient`
          : `candidate ${i + 1} reviewed; continuing`,
      );

      openedPages.push({
        tabId,
        resultIndex: i + 1,
        title: evidence?.title || page.title || cand.title,
        url: evidence?.url || page.url || cand.url,
        resultSnippet: cleanSnippet(cand.snippet),
        pageId: page.id,
        chunkCount: page.chunkIds.length,
        summary: compactText(evidence?.summary, 360),
        keyFacts: (evidence?.keyFacts || []).slice(0, 4).map(fact => compactText(fact, 240)),
        dates: (evidence?.dates || []).slice(0, 4),
        sourceLinks: (evidence?.sourceLinks || []).slice(0, 4),
        suggestedChunkIds: relevantChunks.suggestedChunkIds,
        evidenceScore: score.score,
        deterministicEvidenceScore: score.score,
        candidateQualityScore: cand.qualityScore,
        candidateQualityReasons: cand.qualityReasons,
        candidateSources: cand.sources,
        candidateBestRank: cand.bestRank,
        answerLikely: sufficient,
        scoreReasons: score.reasons,
        answerEvidence: relevantChunks.matches.slice(0, 2).map(m => compactText(m.snippet, 320)),
        topMatches: relevantChunks.matches.slice(0, 3).map(m => ({
          chunkId: m.chunkId,
          heading: compactText(m.heading, 100),
          snippet: compactText(m.snippet, 260),
          score: m.score,
        })),
      });

      if (sufficient && context.taskId) {
        try {
          const findingTitle = compactText(
            evidence?.title || page.title || cand.title,
            140,
          );
          const findingSummary = compactText(
            evidence?.summary
              || `Query "${effectiveQuery}" — evidence from ${cand.url}`,
            500,
          );
          const findingEvidence = matchSnippets
            .slice(0, 4)
            .map(text => compactText(text, 320));
          await browserService.recordTabFinding({
            taskId: context.taskId,
            tabId,
            title: findingTitle,
            summary: findingSummary,
            severity: 'info',
            evidence: findingEvidence,
            snapshotId: null,
          });
        } catch {
          // best-effort; never block the research loop on memory
          // persistence failure.
        }
      }

      if (stopWhenAnswerFound && sufficient) {
        stoppedEarly = true;
        stopReason = `Stopped after candidate ${i + 1}; cached evidence score ${score.score} met threshold ${minEvidenceScore}.`;
        for (let j = i + 1; j < top.length; j++) {
          skippedResults.push({
            index: j + 1,
            title: compactText(top[j].title, 140),
            url: top[j].url,
          });
        }
        break;
      }
    }

    invalidateBrowserCaches();
    const enginesHit = (Object.keys(probe.engines) as Array<keyof typeof probe.engines>)
      .filter(k => probe.engines[k].hit).length;
    const discarded = scored.slice(top.length, top.length + 10).map(c => ({
      url: c.url,
      qualityScore: c.qualityScore,
      sources: c.sources,
      bestRank: c.bestRank,
    }));
    logBrowserCache(
      `Research probe "${effectiveQuery}" engines=${enginesHit}/3 candidates=${probe.candidates.length} scored=${scored.length} opened=${openedPages.length} stoppedEarly=${stoppedEarly}`,
    );

    return {
      summary: `Researched "${effectiveQuery}" via headless SERP probe (${probe.candidates.length} candidate${probe.candidates.length === 1 ? '' : 's'} across ${enginesHit}/3 engines), opened ${openedPages.length} page(s)${stoppedEarly ? ' and stopped early' : ''}`,
      data: {
        query,
        sanitizedQuery: sanitize.sanitized,
        strippedOperators: sanitize.strippedOperators,
        stoppedEarly,
        stopReason: stopReason || null,
        maxPages,
        stopWhenAnswerFound,
        minEvidenceScore,
        serpProbe: {
          engines: probe.engines,
          candidateCount: probe.candidates.length,
          scoredCount: scored.length,
          topScored: top.map(c => ({
            url: c.url,
            title: compactText(c.title, 140),
            snippet: cleanSnippet(c.snippet),
            qualityScore: c.qualityScore,
            qualityReasons: c.qualityReasons,
            sources: c.sources,
            bestRank: c.bestRank,
          })),
          discarded,
        },
        openedPages,
        skippedResults,
        nextStep: openedPages.length > 0
          ? 'Answer only from openedPages evidence or read suggested chunk ids with browser.read_cached_chunk.'
          : 'All probe candidates failed to produce evidence; refine the query or set preserveOperators if intentional.',
      },
    };
  }

  // NOTE: `browser.tabs` used to live here. It was removed once every mutating
  // browser tool started echoing `{ activeTabId, tabs }` in its response (see
  // `withTabEcho`) and the per-turn `## Browser Overview` block in
  // `browserContextInjection` started carrying tab state into the prompt — so
  // the model has fresh tab state on every turn without a dedicated call.
  return [
    {
      name: 'browser.navigate',
      description: 'Navigate the active tab to a URL. Set normalize=true to treat bare domains (e.g. "example") as "example.com". Use browser.open_tab (deterministic; supports reuseExisting) for a new tab, browser.research_search for search workflows.',
      inputSchema: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string' },
          normalize: { type: 'boolean' },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const rawUrl = requireString(obj, 'url');
        const shouldNormalize = obj.normalize === true;
        const targetUrl = shouldNormalize ? requireWebsiteTarget(rawUrl) : rawUrl;
        const result = await runBrowserOperation('browser.navigate', { url: targetUrl }, { invalidateCache: true });
        const enriched = shouldNormalize
          ? {
            summary: result.summary,
            data: { ...result.data, inputUrl: rawUrl, normalizedUrl: targetUrl },
          }
          : result;
        return withTabEcho(enriched);
      },
    },
    {
      name: 'browser.research_search',
      description: 'Web-research workflow (default): run a headless multi-engine SERP probe (Google + DDG-lite + Bing in parallel), quality-score all candidates, open the top ones directly in the browser, cache their pages, and return evidence. No Google SERP is ever shown. Pass plain-English queries — operators like site:/inurl:/filetype: are stripped automatically unless preserveOperators=true. mode="open" skips the probe and just opens a search page.',
      inputSchema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string' },
          mode: { type: 'string', enum: ['workflow', 'open'] },
          maxPages: { type: 'number' },
          openTopResults: { type: 'number' },
          resultLimit: { type: 'number' },
          stopWhenAnswerFound: { type: 'boolean' },
          minEvidenceScore: { type: 'number' },
          preserveOperators: { type: 'boolean' },
        },
      },
      async execute(input, context) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const query = requireString(obj, 'query');
        const mode = typeof obj.mode === 'string' ? obj.mode : 'workflow';
        if (mode === 'open') {
          const result = await runBrowserOperation('browser.search-web', { query }, { invalidateCache: true });
          logBrowserCache(`Opened web search for "${query}"`);
          return result;
        }
        const resultLimit = Math.min(optionalNumber(obj, 'resultLimit', 8), 12);
        const maxPages = Math.min(
          optionalNumber(obj, 'maxPages', optionalNumber(obj, 'openTopResults', 3)),
          5,
        );
        const stopWhenAnswerFound = obj.stopWhenAnswerFound === false ? false : true;
        // Lowered from 9 to 6: the old threshold relied on the pricing
        // bonus firing and was never reached for non-pricing queries.
        const minEvidenceScore = optionalNumber(obj, 'minEvidenceScore', 6);
        const preserveOperators = obj.preserveOperators === true;
        const progress = (message: string): void => {
          context.onProgress?.(`tool-progress:Browser: research "${query}" -> ${message}`);
        };

        const sanitize = sanitizeResearchQuery(query, { preserveOperators });
        const effectiveQuery = sanitize.sanitized || query;
        if (sanitize.strippedOperators.length > 0) {
          progress(`stripped operators: ${sanitize.strippedOperators.join(', ')}`);
        }

        progress('probing search engines (google + ddg + bing, headless)');
        const probe = await probeSerps(effectiveQuery);
        const scored: ScoredCandidate[] = scoreCandidates(effectiveQuery, probe.candidates);
        const top = pickTopX(scored, maxPages);

        if (top.length > 0) {
          return runHeadlessResearchPath({
            query,
            effectiveQuery,
            sanitize,
            probe,
            scored,
            top,
            maxPages,
            stopWhenAnswerFound,
            minEvidenceScore,
            context,
            progress,
          });
        }

        progress('probe returned no candidates; falling back to visible SERP');
        await runBrowserOperation('browser.search-web', { query: effectiveQuery }, { invalidateCache: true });

        const searchState = browserService.getState();
        const searchTabId = searchState.activeTabId;
        if (!searchTabId) throw new Error('No active browser tab after web search');

        progress('caching the search page');
        const [searchPage, searchResults] = await Promise.all([
          cachePageForTab(pageExtractor, searchTabId, context.taskId),
          browserService.extractSearchResults(searchTabId, resultLimit),
        ]);
        const rankedSearchResults = [...searchResults];
        const cacheMatches = pageKnowledgeStore.answerFromCache(effectiveQuery, {
          tabId: searchTabId,
          limit: 4,
          taskId: context.taskId,
          activeTabId: browserService.getState().activeTabId,
        });

        const openedPages: Array<Record<string, unknown>> = [];
        const skippedResults: Array<Record<string, unknown>> = [];
        let stoppedEarly = false;
        let stopReason = '';
        const targets = rankedSearchResults.slice(0, maxPages);
        for (const target of targets) {
          progress(`opening result ${target.index}: ${compactText(target.title, 80)}`);
          const createTabResult = await runBrowserOperation('browser.create-tab', { url: target.url });
          const tabId = typeof createTabResult.data.tabId === 'string' ? createTabResult.data.tabId : '';
          if (!tabId) throw new Error(`Browser create-tab did not return a tab id for ${target.url}`);
          await waitForBrowserSettled(10_000);
          const [page, evidence] = await Promise.all([
            cachePageForTab(pageExtractor, tabId, context.taskId),
            browserService.extractPageEvidence(tabId),
          ]);
          const relevantChunks = pageKnowledgeStore.answerFromCache(effectiveQuery, {
            tabId,
            limit: 4,
            taskId: context.taskId,
            activeTabId: browserService.getState().activeTabId,
          });
          const matchSnippets = relevantChunks.matches.map(match => match.snippet);
          const score = scoreEvidence({
            query: effectiveQuery,
            title: evidence?.title || page.title || target.title,
            url: evidence?.url || page.url || target.url,
            summary: evidence?.summary,
            keyFacts: evidence?.keyFacts,
            matchSnippets,
          });
          const sufficient = score.score >= minEvidenceScore || score.sufficient;
          progress(
            sufficient
              ? `result ${target.index} appears sufficient`
              : `result ${target.index} reviewed; continuing`,
          );
          openedPages.push({
            tabId,
            resultIndex: target.index,
            title: evidence?.title || page.title || target.title,
            url: evidence?.url || page.url || target.url,
            resultSnippet: cleanSnippet(target.snippet),
            pageId: page.id,
            chunkCount: page.chunkIds.length,
            summary: compactText(evidence?.summary, 360),
            keyFacts: (evidence?.keyFacts || []).slice(0, 4).map(fact => compactText(fact, 240)),
            dates: (evidence?.dates || []).slice(0, 4),
            sourceLinks: (evidence?.sourceLinks || []).slice(0, 4),
            suggestedChunkIds: relevantChunks.suggestedChunkIds,
            evidenceScore: score.score,
            deterministicEvidenceScore: score.score,
            answerLikely: sufficient,
            scoreReasons: score.reasons,
            answerEvidence: relevantChunks.matches.slice(0, 2).map(match => compactText(match.snippet, 320)),
            topMatches: relevantChunks.matches.slice(0, 3).map(match => ({
              chunkId: match.chunkId,
              heading: compactText(match.heading, 100),
              snippet: compactText(match.snippet, 260),
              score: match.score,
            })),
          });
          // Auto-promote sufficient evidence to task memory so the finding
          // survives across turns. The model sees this in the next turn's
          // ## Task Memory block without re-reading the page or re-running
          // the cache search. Best-effort: never block the search loop on a
          // memory-store failure.
          if (sufficient && context.taskId) {
            try {
              const findingTitle = compactText(
                evidence?.title || page.title || target.title,
                140,
              );
              const findingSummary = compactText(
                evidence?.summary
                  || `Query "${effectiveQuery}" — evidence from ${target.url}`,
                500,
              );
              const findingEvidence = matchSnippets
                .slice(0, 4)
                .map(text => compactText(text, 320));
              await browserService.recordTabFinding({
                taskId: context.taskId,
                tabId,
                title: findingTitle,
                summary: findingSummary,
                severity: 'info',
                evidence: findingEvidence,
                snapshotId: null,
              });
            } catch {
              // best-effort
            }
          }
          if (stopWhenAnswerFound && sufficient) {
            stoppedEarly = true;
            stopReason = `Stopped after result ${target.index}; cached evidence score ${score.score} met threshold ${minEvidenceScore}.`;
            skippedResults.push(...rankedSearchResults.slice(openedPages.length, maxPages).map(result => ({
              index: result.index,
              title: compactText(result.title, 140),
              url: result.url,
            })));
            break;
          }
        }

        progress(stoppedEarly ? 'stopping after sufficient evidence' : 'research pass complete');
        await runBrowserOperation('browser.activate-tab', { tabId: searchTabId }, { invalidateCache: true });
        invalidateBrowserCaches();
        logBrowserCache(`Research fallback "${effectiveQuery}" parsed ${searchResults.length} results, opened ${openedPages.length} page(s), stoppedEarly=${stoppedEarly}`);

        return {
          summary: `Researched "${effectiveQuery}" via visible-SERP fallback (probe returned no usable candidates), opened ${openedPages.length} page(s)${stoppedEarly ? ' and stopped early' : ''}`,
          data: {
            query,
            sanitizedQuery: sanitize.sanitized,
            strippedOperators: sanitize.strippedOperators,
            serpProbe: {
              engines: probe.engines,
              candidateCount: probe.candidates.length,
              fellBack: true,
            },
            stoppedEarly,
            stopReason: stopReason || null,
            maxPages,
            stopWhenAnswerFound,
            minEvidenceScore,
            searchPage: {
              tabId: searchPage.tabId,
              pageId: searchPage.id,
              title: searchPage.title,
              url: searchPage.url,
              chunkCount: searchPage.chunkIds.length,
            },
            searchResults: rankedSearchResults.map(result => ({
              index: result.index,
              title: compactText(result.title, 140),
              url: result.url,
              snippet: cleanSnippet(result.snippet),
            })),
            searchPageSuggestedChunkIds: cacheMatches.suggestedChunkIds,
            openedPages,
            skippedResults,
            nextStep: openedPages.length > 0
              ? 'Answer only from openedPages evidence or read suggested chunk ids with browser.read_cached_chunk.'
              : 'Open a result or inspect the search page before answering.',
          },
        };
      },
    },
    {
      name: 'browser.back',
      description: 'Go back in the active browser tab.',
      inputSchema: { type: 'object' },
      async execute() {
        requireBrowserCreated();
        const result = await runBrowserOperation('browser.back', {}, { invalidateCache: true });
        await waitForBrowserSettled();
        return withTabEcho(result);
      },
    },
    {
      name: 'browser.forward',
      description: 'Go forward in the active browser tab.',
      inputSchema: { type: 'object' },
      async execute() {
        requireBrowserCreated();
        const result = await runBrowserOperation('browser.forward', {}, { invalidateCache: true });
        await waitForBrowserSettled();
        return withTabEcho(result);
      },
    },
    {
      name: 'browser.reload',
      description: 'Reload the active browser tab.',
      inputSchema: { type: 'object' },
      async execute() {
        requireBrowserCreated();
        const result = await runBrowserOperation('browser.reload', {}, { invalidateCache: true });
        await waitForBrowserSettled();
        return withTabEcho(result);
      },
    },
    {
      name: 'browser.create_tab',
      description: 'Create a new browser tab, optionally with a starting URL. Prefer browser.open_tab for normal "open a tab" requests — it verifies postconditions and supports reuseExisting to avoid duplicates. Use browser.create_tab only when you explicitly need a brand-new tab regardless of what is already open.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string' },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const url = optionalString(objectInput(input), 'url');
        const result = await runBrowserOperation('browser.create-tab', { url }, { invalidateCache: true });
        await waitForBrowserSettled();
        const activeTabId = browserService.getState().activeTabId;
        return {
          summary: result.summary,
          data: {
            ...result.data,
            activeTabId,
            isDeterministic: isTabDeterministic(activeTabId, determinismKernel),
            tabs: browserService.getTabs(),
          },
        };
      },
    },
    {
      name: 'browser.open_tab',
      description: 'Deterministic tab opener: creates a new tab (optionally at a URL) and verifies the tab exists and is active before returning. With reuseExisting=true, activates an existing tab matching the URL instead of creating a duplicate. With deterministic=true (or a DeterminismConfig object), the new tab is entered into deterministic mode (pinned clock, seed, viewport, locale, UA, animations off) before returning.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          reuseExisting: { type: 'boolean' },
          deterministic: {
            oneOf: [
              { type: 'boolean' },
              {
                type: 'object',
                properties: {
                  seed: { type: 'number' },
                  clock: { oneOf: [{ type: 'number' }, { type: 'string', enum: ['frozen'] }] },
                  viewport: {
                    type: 'object',
                    properties: {
                      width: { type: 'number' },
                      height: { type: 'number' },
                      deviceScaleFactor: { type: 'number' },
                    },
                  },
                  locale: { type: 'string' },
                  timezone: { type: 'string' },
                  userAgent: { type: 'string' },
                  disableAnimations: { type: 'boolean' },
                  reduceMotion: { type: 'boolean' },
                  blockNetworkPatterns: { type: 'array', items: { type: 'string' } },
                },
              },
            ],
          },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const url = optionalString(obj, 'url');
        const reuseExisting = obj.reuseExisting === true;
        const deterministic = normalizeDeterministicInput(obj.deterministic);

        const service: DeterministicTabService = {
          createTab: (targetUrl?: string) => {
            const tab = browserService.createTab(targetUrl);
            return { id: tab.id };
          },
          activateTab: (tabId: string) => { browserService.activateTab(tabId); },
          getTabs: () => browserService.getTabs().map(tab => ({
            id: tab.id,
            url: tab.navigation.url,
          })),
          getActiveTabId: () => browserService.getState().activeTabId,
        };

        const kernel = deterministic !== undefined ? getKernel() : undefined;
        const result = await openTabDeterministic(
          {
            url,
            reuseExisting,
            deterministic: deterministic as (DeterminismConfig | true | undefined),
          },
          service,
          kernel
            ? {
              kernel: {
                enter: (t, c) => kernel.enter(t, c),
                isDeterministic: (t) => kernel.isDeterministic(t),
              },
            }
            : {},
        );
        invalidateBrowserCaches();
        await waitForBrowserSettled();

        const activeTabId = browserService.getState().activeTabId;
        return {
          summary: result.reused
            ? `Reused existing tab ${result.tabId}${url ? ` for ${url}` : ''}${result.deterministic ? ' (deterministic)' : ''}`
            : `Opened tab ${result.tabId}${url ? ` at ${url}` : ''}${result.deterministic ? ' (deterministic)' : ''}`,
          data: {
            ...result,
            activeTabId,
            isDeterministic: isTabDeterministic(activeTabId, determinismKernel),
            tabs: compactTabInventory(),
          },
        };
      },
    },
    {
      name: 'browser.close_tab',
      description: 'Close one or more tabs by id, or pass `all: true` to close every open tab and leave only the required default homepage survivor. The browser keeps one default homepage tab open, so closing the last remaining tab resets it to the homepage instead of removing it entirely.',
      inputSchema: {
        type: 'object',
        properties: {
          tabId: { type: 'string' },
          tabIds: { type: 'array', items: { type: 'string' } },
          all: { type: 'boolean' },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const closeAll = optionalBoolean(obj, 'all');
        const tabIds = optionalStringArray(obj, 'tabIds');
        const singleTabId = optionalString(obj, 'tabId');
        const ids = closeAll
          ? browserService.getTabs().map(tab => tab.id)
          : Array.from(new Set([...(singleTabId ? [singleTabId] : []), ...tabIds]));
        if (ids.length === 0) throw new Error('Expected tabId, tabIds, or all=true for browser.close_tab.');

        for (const tabId of ids) {
          await runBrowserOperation('browser.close-tab', { tabId }, { invalidateCache: true });
          // Drop any kernel registry entry for the closed tab; pins can't be
          // reverted via CDP once the target is gone, so `purgeTab` (not
          // `exit`) is the correct cleanup here.
          determinismKernel?.purgeTab(tabId);
        }
        const activeTabId = browserService.getState().activeTabId;
        return {
          summary: closeAll
            ? `Closed all ${ids.length} browser tab${ids.length === 1 ? '' : 's'}`
            : `Closed ${ids.length} browser tab${ids.length === 1 ? '' : 's'}`,
          data: {
            tabIds: ids,
            all: closeAll,
            activeTabId,
            isDeterministic: isTabDeterministic(activeTabId, determinismKernel),
            tabs: browserService.getTabs(),
          },
        };
      },
    },
    {
      name: 'browser.activate_tab',
      description: 'Activate a browser tab.',
      inputSchema: {
        type: 'object',
        required: ['tabId'],
        properties: {
          tabId: { type: 'string' },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const tabId = requireString(objectInput(input), 'tabId');
        const result = await runBrowserOperation('browser.activate-tab', { tabId }, { invalidateCache: true });
        const activeTabId = browserService.getState().activeTabId;
        return {
          summary: result.summary,
          data: {
            ...result.data,
            activeTabId,
            isDeterministic: isTabDeterministic(activeTabId, determinismKernel),
            tabs: browserService.getTabs(),
          },
        };
      },
    },
    {
      name: 'browser.click',
      description: 'Click a page element. Provide selector for an exact target, or text to click the first actionable element whose visible text/label/role contains the string.',
      inputSchema: {
        type: 'object',
        properties: {
          selector: { type: 'string' },
          text: { type: 'string' },
          tabId: { type: 'string' },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const selector = optionalString(obj, 'selector');
        const text = optionalString(obj, 'text');
        const tabId = optionalString(obj, 'tabId');
        if (!selector && !text) {
          throw new Error('browser.click requires either selector or text');
        }
        if (selector) {
          const clickResult = await runBrowserOperation('browser.click', { selector, tabId }, { invalidateCache: true });
          return withTabEcho(clickResult);
        }
        const elements = await browserService.getActionableElements(tabId);
        const match = elements.find((element) => {
          const haystack = [
            element.text,
            element.ariaLabel,
            element.role,
            element.ref?.selector,
            element.href,
          ].filter(Boolean).join(' ');
          return includesText(haystack, text!);
        });
        if (!match?.ref?.selector) {
          throw new Error(`No clickable element found for text: ${text}`);
        }
        const result = await runBrowserOperation(
          'browser.click',
          { selector: match.ref.selector, tabId },
          { invalidateCache: true },
        );
        return withTabEcho({
          summary: `Clicked text "${text}"`,
          data: { result: result.data.result, element: match },
        });
      },
    },
    {
      name: 'browser.type',
      description: 'Type text into a page element by selector.',
      inputSchema: { type: 'object', required: ['selector', 'text'], properties: { selector: { type: 'string' }, text: { type: 'string' }, tabId: { type: 'string' } } },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const selector = requireString(obj, 'selector');
        const text = requireString(obj, 'text');
        const result = await runBrowserOperation(
          'browser.type',
          { selector, text, tabId: optionalString(obj, 'tabId') },
          { invalidateCache: true },
        );
        return withTabEcho(result);
      },
    },
    {
      name: 'browser.get_element_state',
      description: 'Return deterministic state for an exact page selector, including presence, visibility, text, value, checked/disabled state, and select metadata when applicable.',
      inputSchema: { type: 'object', required: ['selector'], properties: { selector: { type: 'string' }, tabId: { type: 'string' } } },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const selector = requireString(obj, 'selector');
        return runBrowserOperation(
          'browser.get-element-state',
          { selector, tabId: optionalString(obj, 'tabId') },
        );
      },
    },
    {
      name: 'browser.select_option',
      description: 'Select an option in a native select element by selector and value, label, or index. Dispatches input+change events and returns the final selection.',
      inputSchema: {
        type: 'object',
        required: ['selector'],
        properties: {
          selector: { type: 'string' },
          value: { type: 'string' },
          label: { type: 'string' },
          index: { type: 'number' },
          tabId: { type: 'string' },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const selector = requireString(obj, 'selector');
        const value = optionalString(obj, 'value');
        const label = optionalString(obj, 'label');
        const hasIndex = typeof obj.index === 'number' && Number.isFinite(obj.index);
        if (!value && !label && !hasIndex) {
          throw new Error('browser.select_option requires one of value, label, or index');
        }
        const result = await runBrowserOperation(
          'browser.select-option',
          {
            selector,
            value,
            label,
            index: hasIndex ? obj.index as number : undefined,
            tabId: optionalString(obj, 'tabId'),
          },
          { invalidateCache: true },
        );
        return withTabEcho(result);
      },
    },
    {
      name: 'browser.upload_file',
      description: 'Attach a local file to an input[type="file"] element by selector.',
      inputSchema: { type: 'object', required: ['selector', 'filePath'], properties: { selector: { type: 'string' }, filePath: { type: 'string' }, tabId: { type: 'string' } } },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const selector = requireString(obj, 'selector');
        const filePath = requireString(obj, 'filePath');
        const result = await runBrowserOperation(
          'browser.upload-file',
          { selector, filePath, tabId: optionalString(obj, 'tabId') },
          { invalidateCache: true },
        );
        return withTabEcho(result);
      },
    },
    {
      name: 'browser.download',
      description: 'Start a tracked browser download. Provide selector for a page link, or url for a direct download.',
      inputSchema: {
        type: 'object',
        properties: {
          selector: { type: 'string' },
          url: { type: 'string' },
          tabId: { type: 'string' },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const selector = optionalString(obj, 'selector');
        const url = optionalString(obj, 'url');
        const tabId = optionalString(obj, 'tabId');
        if (!selector && !url) {
          throw new Error('browser.download requires either selector or url');
        }
        if (selector) {
          return runBrowserOperation('browser.download-link', { selector, tabId }, { invalidateCache: true });
        }
        return runBrowserOperation('browser.download-url', { url: url!, tabId }, { invalidateCache: true });
      },
    },
    {
      name: 'browser.get_downloads',
      description: 'Return current and completed browser downloads.',
      inputSchema: {
        type: 'object',
        properties: {
          state: { type: 'string' },
          filename: { type: 'string' },
          tabId: { type: 'string' },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        return runBrowserOperation('browser.get-downloads', {
          state: optionalString(obj, 'state'),
          filename: optionalString(obj, 'filename'),
          tabId: optionalString(obj, 'tabId'),
        });
      },
    },
    {
      name: 'browser.wait_for_download',
      description: 'Wait for a browser download to complete or settle.',
      inputSchema: {
        type: 'object',
        properties: {
          downloadId: { type: 'string' },
          filename: { type: 'string' },
          tabId: { type: 'string' },
          timeoutMs: { type: 'number' },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        return runBrowserOperation('browser.wait-for-download', {
          downloadId: optionalString(obj, 'downloadId'),
          filename: optionalString(obj, 'filename'),
          tabId: optionalString(obj, 'tabId'),
          timeoutMs: optionalNumber(obj, 'timeoutMs', 15_000),
        });
      },
    },
    {
      name: 'browser.drag',
      description: 'Drag one page element onto another by selector using native input plus DOM drag/drop events.',
      inputSchema: {
        type: 'object',
        required: ['sourceSelector', 'targetSelector'],
        properties: {
          sourceSelector: { type: 'string' },
          targetSelector: { type: 'string' },
          tabId: { type: 'string' },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const sourceSelector = requireString(obj, 'sourceSelector');
        const targetSelector = requireString(obj, 'targetSelector');
        const result = await runBrowserOperation(
          'browser.drag',
          { sourceSelector, targetSelector, tabId: optionalString(obj, 'tabId') },
          { invalidateCache: true },
        );
        return withTabEcho(result);
      },
    },
    {
      name: 'browser.hover',
      description: 'Move the native pointer over an element by selector.',
      inputSchema: {
        type: 'object',
        required: ['selector'],
        properties: {
          selector: { type: 'string' },
          tabId: { type: 'string' },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const selector = requireString(obj, 'selector');
        const result = await runBrowserOperation(
          'browser.hover',
          { selector, tabId: optionalString(obj, 'tabId') },
          { invalidateCache: true },
        );
        return withTabEcho(result);
      },
    },
    {
      name: 'browser.extract_page',
      description: 'Fallback only: extract active page text and metadata when cached page search/chunk reads are missing or insufficient. Prefer browser.search_page_cache and browser.read_cached_chunk first.',
      inputSchema: { type: 'object', properties: { maxLength: { type: 'number' }, tabId: { type: 'string' } } },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const maxLength = typeof obj.maxLength === 'number' ? obj.maxLength : 8000;
        const text = await browserService.getPageText(Math.min(maxLength, 6000));
        const metadata = await browserService.getPageMetadata(optionalString(obj, 'tabId'));
        logBrowserCache(`Broad page extraction fallback used (${text.length} chars)`, 'warn');
        return { summary: `Extracted ${text.length} characters from page`, data: { text, metadata } };
      },
    },
    {
      name: 'browser.cache_current_page',
      description: 'Cache the active page into cleaned, searchable chunks. Use before page-cache search if the current page may not have been cached yet.',
      inputSchema: {
        type: 'object',
        properties: {
          tabId: { type: 'string' },
        },
      },
      async execute(input, context) {
        requireBrowserCreated();
        const tabId = optionalString(objectInput(input), 'tabId') || browserService.getState().activeTabId;
        if (!tabId) throw new Error('No active tab to cache');
        const page = await cachePageForTab(pageExtractor, tabId, context.taskId);
        logBrowserCache(`Cached current page into ${page.chunkIds.length} chunks: ${page.title || page.url}`);
        return {
          summary: `Cached page ${page.title || page.url} into ${page.chunkIds.length} chunks`,
          data: { page },
        };
      },
    },
    {
      name: 'browser.search_page_cache',
      description: 'Search cached browser page chunks and return snippets plus chunk ids. mode="answer" additionally classifies answerability and returns suggested chunk ids.',
      inputSchema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string' },
          mode: { type: 'string', enum: ['snippets', 'answer'] },
          tabId: { type: 'string' },
          pageId: { type: 'string' },
          limit: { type: 'number' },
        },
      },
      async execute(input, context) {
        const obj = objectInput(input);
        const query = requireString(obj, 'query');
        const tabId = optionalString(obj, 'tabId');
        const pageId = optionalString(obj, 'pageId');
        const limit = Math.min(optionalNumber(obj, 'limit', 8), 20);
        const mode = typeof obj.mode === 'string' ? obj.mode : 'snippets';
        const scopeOptions = {
          tabId,
          pageId,
          limit,
          taskId: context.taskId,
          activeTabId: browserService.isCreated() ? browserService.getState().activeTabId : undefined,
        };
        if (mode === 'answer') {
          const answer = pageKnowledgeStore.answerFromCache(query, scopeOptions);
          logBrowserCache(
            `Cache answer ${answer.answerable ? 'hit' : 'miss'} for "${query}" (${answer.matches.length} matches, est ${answer.tokenEstimate} tokens)`,
            answer.answerable ? 'info' : 'warn',
          );
          return {
            summary: answer.answerable
              ? `Cache found ${answer.matches.length} relevant chunks`
              : 'Cache had no relevant chunks',
            data: answer,
          };
        }
        const results = pageKnowledgeStore.search(query, scopeOptions);
        logBrowserCache(`Cache search ${results.length > 0 ? 'hit' : 'miss'} for "${query}" (${results.length} matches)`, results.length > 0 ? 'info' : 'warn');
        return {
          summary: `Found ${results.length} cached page chunks for "${query}"`,
          data: { results },
        };
      },
    },
    {
      name: 'browser.read_cached_chunk',
      description: 'Read a specific cached page chunk by chunk id. Use after browser.search_page_cache returns a relevant chunk id.',
      inputSchema: {
        type: 'object',
        required: ['chunkId'],
        properties: {
          chunkId: { type: 'string' },
          maxChars: { type: 'number' },
        },
      },
      async execute(input) {
        const obj = objectInput(input);
        const chunkId = requireString(obj, 'chunkId');
        const chunk = pageKnowledgeStore.readChunk(chunkId, Math.min(optionalNumber(obj, 'maxChars', 2400), 6000));
        if (!chunk) throw new Error(`Cached page chunk not found: ${chunkId}`);
        logBrowserCache(`Read cached chunk ${chunkId} (est ${chunk.tokenEstimate} tokens)`);
        return {
          summary: `Read cached chunk ${chunkId}`,
          data: { chunk },
        };
      },
    },
    {
      name: 'browser.cache_inventory',
      description: 'Report browser page-cache state. scope="stats" returns totals and hit/miss counts; scope="pages" lists cached pages; scope="sections" lists headings+chunk ids for a given pageIdOrTabId.',
      inputSchema: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['stats', 'pages', 'sections'] },
          pageIdOrTabId: { type: 'string' },
        },
      },
      async execute(input) {
        const obj = objectInput(input);
        const scope = typeof obj.scope === 'string' ? obj.scope : 'stats';
        if (scope === 'pages') {
          const pages = pageKnowledgeStore.listPages().map(page => ({
            id: page.id,
            tabId: page.tabId,
            url: page.url,
            title: page.title,
            tier: page.tier,
            chunkCount: page.chunkIds.length,
            headings: page.headings.slice(0, 20),
            updatedAt: page.updatedAt,
          }));
          return { summary: `Listed ${pages.length} cached pages`, data: { pages } };
        }
        if (scope === 'sections') {
          const pageIdOrTabId = requireString(obj, 'pageIdOrTabId');
          const sections = pageKnowledgeStore.listSections(pageIdOrTabId);
          return { summary: `Listed ${sections.length} cached sections`, data: { sections } };
        }
        const stats = pageKnowledgeStore.getStats();
        return {
          summary: `Browser cache has ${stats.pageCount} pages and ${stats.chunkCount} chunks`,
          data: { stats },
        };
      },
    },
    {
      name: 'browser.record_finding',
      description: 'Pin a key finding from the current research into task memory. Use this to preserve a fact, answer, or decision across turns — the entry shows up in the next turn\'s ## Task Memory block, so you do not have to re-read or re-query the page to recall it.',
      inputSchema: {
        type: 'object',
        required: ['title', 'summary'],
        properties: {
          title: { type: 'string', description: 'Short headline for the finding (<=120 chars).' },
          summary: { type: 'string', description: 'The finding itself — the fact, answer, or takeaway to remember (<=600 chars).' },
          severity: { type: 'string', enum: ['info', 'warning', 'critical'], description: 'Default "info". Use "warning" for caveats, "critical" for blockers.' },
          evidence: { type: 'array', items: { type: 'string' }, description: 'Optional supporting snippets or quotes backing the finding.' },
          tabId: { type: 'string', description: 'Optional; defaults to the active tab.' },
        },
      },
      async execute(input, context) {
        if (!context.taskId) {
          throw new Error('browser.record_finding requires a task context.');
        }
        requireBrowserCreated();
        const obj = objectInput(input);
        const title = compactText(requireString(obj, 'title'), 160);
        const summary = compactText(requireString(obj, 'summary'), 800);
        const severityInput = optionalString(obj, 'severity');
        const severity: BrowserFindingSeverity = severityInput === 'warning' || severityInput === 'critical'
          ? severityInput
          : 'info';
        const evidence = optionalStringArray(obj, 'evidence')
          .slice(0, 6)
          .map(item => compactText(item, 400));
        const tabId = optionalString(obj, 'tabId');
        const finding = await browserService.recordTabFinding({
          taskId: context.taskId,
          tabId,
          title,
          summary,
          severity,
          evidence,
          snapshotId: null,
        });
        logBrowserCache(`Pinned finding "${title}" to task memory (${severity})`);
        return {
          summary: `Pinned finding: ${title}`,
          data: {
            findingId: finding.id,
            tabId: finding.tabId,
            title: finding.title,
            severity: finding.severity,
            evidenceCount: finding.evidence.length,
            activeTabId: browserService.getState().activeTabId,
            tabs: compactTabInventory(),
          },
        };
      },
    },
    {
      name: 'browser.inspect_page',
      description: 'Inspect the active page with navigation, metadata, visible text excerpt, forms, viewport, and top actionable elements.',
      inputSchema: {
        type: 'object',
        properties: {
          tabId: { type: 'string' },
          textLimit: { type: 'number' },
          elementLimit: { type: 'number' },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const result = await runBrowserOperation('browser.inspect-page', {
          tabId: optionalString(obj, 'tabId'),
          textLimit: Math.min(optionalNumber(obj, 'textLimit', 3000), 6000),
          elementLimit: Math.min(optionalNumber(obj, 'elementLimit', 30), 80),
        });
        return withTabEcho(result);
      },
    },
    {
      name: 'browser.find_element',
      description: 'Find actionable elements by visible text, label, role, selector, or href. Returns candidate selectors for click/type tools.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          selector: { type: 'string' },
          tabId: { type: 'string' },
          limit: { type: 'number' },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const query = optionalString(obj, 'query');
        const selector = optionalString(obj, 'selector');
        const tabId = optionalString(obj, 'tabId');
        const limit = Math.min(optionalNumber(obj, 'limit', 20), 80);

        if (selector) {
          const elements = await browserService.querySelectorAll(selector, tabId, limit);
          return {
            summary: `Found ${elements.length} elements for selector ${selector}`,
            data: { elements },
          };
        }

        if (!query) throw new Error('Expected query or selector');
        const elements = await browserService.getActionableElements(tabId);
        const matches = elements.filter((element) => {
          const haystack = [
            element.text,
            element.ariaLabel,
            element.role,
            element.ref?.selector,
            element.href,
          ].filter(Boolean).join(' ');
          return includesText(haystack, query);
        }).slice(0, limit);
        return {
          summary: `Found ${matches.length} actionable elements matching "${query}"`,
          data: { elements: matches },
        };
      },
    },
    {
      name: 'browser.wait_for',
      description: 'Wait until page load settles, a selector/text is present, or a selector/text is absent.',
      inputSchema: {
        type: 'object',
        properties: {
          selector: { type: 'string' },
          text: { type: 'string' },
          state: { type: 'string', enum: ['present', 'absent', 'load'] },
          tabId: { type: 'string' },
          timeoutMs: { type: 'number' },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const timeoutMs = Math.min(optionalNumber(obj, 'timeoutMs', 7000), 30_000);
        const state = obj.state === 'absent' || obj.state === 'load' ? obj.state : 'present';
        if (state === 'load') {
          await waitForBrowserSettled(timeoutMs);
          return withTabEcho({
            summary: 'Browser load settled',
            data: { navigation: browserService.getState().navigation },
          });
        }
        const result = await waitForCondition({
          selector: optionalString(obj, 'selector'),
          text: optionalString(obj, 'text'),
          state,
          tabId: optionalString(obj, 'tabId'),
          timeoutMs,
        });
        return withTabEcho({
          summary: result.success ? `Wait condition ${state} satisfied` : `Wait condition ${state} timed out`,
          data: result,
        });
      },
    },
    {
      name: 'browser.summarize_page',
      description: 'Return a compact structured summary of the active tab or working tab set.',
      inputSchema: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          tabIds: { type: 'array', items: { type: 'string' } },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const tabIds = Array.isArray(obj.tabIds) ? obj.tabIds.filter((id): id is string => typeof id === 'string') : undefined;
        const question = optionalString(obj, 'question');
        const [evidence, workingSet] = await Promise.all([
          browserService.extractPageEvidence(tabIds?.[0]),
          browserService.summarizeTabWorkingSet(tabIds),
        ]);
        const brief = await browserService.synthesizeResearchBrief({ tabIds, question });
        return {
          summary: evidence?.title ? `Summarized ${evidence.title}` : 'Summarized browser page',
          data: { evidence, workingSet, brief },
        };
      },
    },
    {
      name: 'browser.evaluate_js',
      description: 'Evaluate JavaScript in the active browser page. Use for inspection only unless the user asks to manipulate page state.',
      inputSchema: {
        type: 'object',
        required: ['expression'],
        properties: {
          expression: { type: 'string' },
          tabId: { type: 'string' },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const expression = requireString(obj, 'expression');
        if (expression.length > 4000) throw new Error('JavaScript expression is too long');
        const result = await browserService.executeInPage(expression, optionalString(obj, 'tabId'));
        return {
          summary: result.error ? `JavaScript evaluation failed: ${result.error}` : 'Evaluated JavaScript',
          data: result,
        };
      },
    },
    {
      name: 'browser.get_console_events',
      description: 'Return recent browser console events for diagnostics.',
      inputSchema: {
        type: 'object',
        properties: {
          tabId: { type: 'string' },
          since: { type: 'number' },
          level: { type: 'string' },
          limit: { type: 'number' },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const level = optionalString(obj, 'level');
        const limit = Math.min(Math.max(Math.floor(optionalNumber(obj, 'limit', 50)), 1), 250);
        const events = browserService
          .getConsoleEvents(optionalString(obj, 'tabId'), optionalNumber(obj, 'since', 0) || undefined)
          .filter(event => !level || event.level === level)
          .slice(-limit);
        const errorCount = events.filter(event => event.level === 'error').length;
        const warnCount = events.filter(event => event.level === 'warn').length;
        return {
          summary: `Read ${events.length} console event${events.length === 1 ? '' : 's'} (${errorCount} errors, ${warnCount} warnings)`,
          data: { events },
        };
      },
    },
    {
      name: 'browser.get_network_events',
      description: 'Return recent browser network events for diagnostics.',
      inputSchema: {
        type: 'object',
        properties: {
          tabId: { type: 'string' },
          since: { type: 'number' },
          status: { type: 'string' },
          failedOnly: { type: 'boolean' },
          limit: { type: 'number' },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const status = optionalString(obj, 'status');
        const failedOnly = obj.failedOnly === true;
        const limit = Math.min(Math.max(Math.floor(optionalNumber(obj, 'limit', 80)), 1), 500);
        const events = browserService
          .getNetworkEvents(optionalString(obj, 'tabId'), optionalNumber(obj, 'since', 0) || undefined)
          .filter(event => !status || event.status === status)
          .filter(event => !failedOnly || event.status === 'failed' || (typeof event.statusCode === 'number' && event.statusCode >= 400))
          .slice(-limit);
        const failedCount = events.filter(event => event.status === 'failed' || (typeof event.statusCode === 'number' && event.statusCode >= 400)).length;
        return {
          summary: `Read ${events.length} network event${events.length === 1 ? '' : 's'} (${failedCount} failed/error responses)`,
          data: { events },
        };
      },
    },
    {
      name: 'browser.run_workflow',
      description: 'Run a registered deterministic browser workflow with a fixed tool allowlist, checkpoints, and escalation hooks.',
      inputSchema: {
        type: 'object',
        required: ['workflowId'],
        properties: {
          workflowId: { type: 'string' },
          inputs: {
            type: 'object',
            additionalProperties: {
              anyOf: [
                { type: 'string' },
                { type: 'number' },
                { type: 'boolean' },
                { type: 'null' },
              ],
            },
          },
        },
      },
      async execute(input, context) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const workflowId = requireString(obj, 'workflowId');
        const result = await runRegisteredBrowserWorkflow({
          workflowId,
          workflowInputs: obj.inputs,
          context,
        });
        return {
          summary: result.summary,
          data: {
            ...result.data,
            availableWorkflows: listRegisteredBrowserWorkflows(),
            activeTabId: browserService.getState().activeTabId,
            tabs: compactTabInventory(),
          },
        };
      },
    },
    {
      name: 'browser.run_intent_program',
      description: 'Run a Web Intent VM bytecode program (NAVIGATE, ASSERT, INTENT.*) with selector-agnostic resolution and postcondition checks.',
      inputSchema: {
        type: 'object',
        required: ['instructions'],
        properties: {
          instructions: { type: 'array', items: { type: 'object' } },
          tabId: { type: 'string' },
          failFast: { type: 'boolean' },
        },
      },
      async execute(input) {
        requireBrowserCreated();
        const obj = objectInput(input);
        const instructions = Array.isArray(obj.instructions)
          ? obj.instructions.filter((item): item is WebIntentInstruction => {
            return typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>).op === 'string';
          })
          : [];
        if (instructions.length === 0) {
          throw new Error('browser.run_intent_program requires a non-empty instructions array');
        }
        const result = await webIntentVm.run({
          instructions,
          tabId: optionalString(obj, 'tabId'),
          failFast: obj.failFast === false ? false : true,
        });
        invalidateBrowserCaches();
        const failedStep = result.failedAt !== null ? result.steps[result.failedAt] : null;
        const failureReason = failedStep?.error || failedStep?.evidence || 'unknown error';
        return {
          summary: result.success
            ? `Intent program completed (${result.steps.length} steps)`
            : `Intent program failed at step ${result.failedAt} (${failedStep?.op || 'unknown'}): ${failureReason}`,
          data: result,
        };
      },
    },
  ];
}
