import { PageExtractor } from '../../context/pageExtractor';
import { browserService } from '../../browser/BrowserService';
import { pageKnowledgeStore } from '../../browserKnowledge/PageKnowledgeStore';
import { geminiSidecar } from '../GeminiSidecar';
import {
  cachePageForTab,
  compactText,
  resolveWithSoftTimeout,
  runBrowserOperation,
  scoreEvidence,
  logBrowserCache,
  waitForBrowserSettled,
} from './browserTools.utils';

const SIDECAR_RANK_TIMEOUT_MS = 1200;
const SIDECAR_JUDGE_TIMEOUT_MS = 1200;

type ResearchSearchProgress = {
  onProgress?: (message: string) => void;
};

type ResearchSearchParams = {
  query: string;
  resultLimit: number;
  maxPages: number;
  stopWhenAnswerFound: boolean;
  minEvidenceScore: number;
  pageExtractor: PageExtractor;
  context?: ResearchSearchProgress;
};

export async function executeBrowserResearchSearch(input: ResearchSearchParams): Promise<{ summary: string; data: Record<string, unknown> }> {
  const { query, resultLimit, maxPages, stopWhenAnswerFound, minEvidenceScore, pageExtractor, context } = input;
  const progress = (message: string): void => {
    context?.onProgress?.(`tool-progress:Browser: research "${query}" -> ${message}`);
  };

  progress('opening search results');
  await runBrowserOperation('browser.search-web', { query }, { invalidateCache: true });

  const searchState = browserService.getState();
  const searchTabId = searchState.activeTabId;
  if (!searchTabId) throw new Error('No active browser tab after web search');

  progress('extracting search results');
  const searchResults = await browserService.extractSearchResults(searchTabId, resultLimit);
  const defaultRankedResults = {
    results: searchResults,
    modelId: null,
    reason: null,
  };
  const rankedResult = await resolveWithSoftTimeout(
    geminiSidecar.rankSearchResults(query, searchResults.map(result => ({
      index: result.index,
      title: result.title,
      url: result.url,
      snippet: result.snippet,
    })),
    ),
    SIDECAR_RANK_TIMEOUT_MS,
    defaultRankedResults,
  );
  const ranked = rankedResult.value;
  const rankedSearchResults = ranked.results.map(result => {
    const original = searchResults.find(item => item.index === result.index);
    return original || result;
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
      cachePageForTab(pageExtractor, tabId),
      browserService.extractPageEvidence(tabId),
    ]);
    const relevantChunks = pageKnowledgeStore.answerFromCache(query, {
      tabId,
      limit: 4,
    });
    const matchSnippets = relevantChunks.matches.map(match => match.snippet);
    const score = scoreEvidence({
      query,
      title: evidence?.title || page.title || target.title,
      url: evidence?.url || page.url || target.url,
      summary: evidence?.summary,
      keyFacts: evidence?.keyFacts,
      matchSnippets,
    });
    const judgeResult = await resolveWithSoftTimeout(
      geminiSidecar.judgeEvidence({
        query,
        title: evidence?.title || page.title || target.title,
        url: evidence?.url || page.url || target.url,
        summary: evidence?.summary || '',
        keyFacts: evidence?.keyFacts || [],
        snippets: matchSnippets,
      }),
      SIDECAR_JUDGE_TIMEOUT_MS,
      null,
    );
    const geminiJudge = judgeResult.value;
    const geminiScore = geminiJudge ? Math.round(geminiJudge.score * 1.2) : null;
    const sufficient = geminiJudge?.sufficient === true || score.score >= minEvidenceScore || score.sufficient;
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
      resultSnippet: compactText(target.snippet, 180),
      pageId: page.id,
      chunkCount: page.chunkIds.length,
      summary: compactText(evidence?.summary, 360),
      keyFacts: (evidence?.keyFacts || []).slice(0, 4).map(fact => compactText(fact, 240)),
      dates: (evidence?.dates || []).slice(0, 4),
      sourceLinks: (evidence?.sourceLinks || []).slice(0, 4),
      suggestedChunkIds: relevantChunks.suggestedChunkIds,
      evidenceScore: geminiScore ?? score.score,
      deterministicEvidenceScore: score.score,
      answerLikely: sufficient,
      scoreReasons: geminiJudge?.reasons.length ? geminiJudge.reasons : score.reasons,
      judgeModel: geminiJudge?.modelId || null,
      judgeTimedOut: judgeResult.timedOut,
      answerEvidence: geminiJudge?.compactEvidence.length ? geminiJudge.compactEvidence : relevantChunks.matches.slice(0, 2).map(match => compactText(match.snippet, 320)),
      topMatches: relevantChunks.matches.slice(0, 3).map(match => ({
        chunkId: match.chunkId,
        heading: compactText(match.heading, 100),
        snippet: compactText(match.snippet, 260),
        score: match.score,
      })),
    });
    if (stopWhenAnswerFound && sufficient) {
      stoppedEarly = true;
      stopReason = geminiJudge?.sufficient
        ? `Stopped after result ${target.index}; Gemini judged cached evidence sufficient.`
        : `Stopped after result ${target.index}; cached evidence score ${score.score} met threshold ${minEvidenceScore}.`;
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
  logBrowserCache(`Research search "${query}" parsed ${searchResults.length} results, opened ${openedPages.length} page(s), stoppedEarly=${stoppedEarly}`);

  return {
    summary: `Searched "${query}", found ${searchResults.length} results, opened ${openedPages.length} page(s)${stoppedEarly ? ' and stopped early' : ''}`,
    data: {
      query,
      stoppedEarly,
      stopReason: stopReason || null,
      sidecar: {
        configured: geminiSidecar.isConfigured(),
        rankModel: ranked.modelId,
        rankReason: rankedResult.timedOut
          ? 'timed out; used browser result order'
          : ranked.reason,
        rankTimedOut: rankedResult.timedOut,
      },
      maxPages,
      stopWhenAnswerFound,
      minEvidenceScore,
      searchSurface: {
        tabId: searchTabId,
        title: searchState.navigation.title,
        url: searchState.navigation.url,
      },
      searchResults: rankedSearchResults.map(result => ({
        index: result.index,
        title: compactText(result.title, 140),
        url: result.url,
        snippet: compactText(result.snippet, 180),
      })),
      openedPages,
      skippedResults,
      nextStep: openedPages.length > 0
        ? 'Answer only from openedPages evidence or open another result if more evidence is needed.'
        : 'Open a result before answering.',
    },
  };
}
