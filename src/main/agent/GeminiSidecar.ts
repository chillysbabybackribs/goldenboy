import { DEFAULT_GEMINI_CONFIG } from '../../shared/types/model';
import {
  GeminiClient,
  configuredGeminiFallbackModels,
  loadGeminiEnvValue,
} from './GeminiClient';

export type SearchRankInput = {
  index: number;
  title: string;
  url: string;
  snippet: string;
};

export type EvidenceJudgeInput = {
  query: string;
  title: string;
  url: string;
  summary: string;
  keyFacts: string[];
  snippets: string[];
};

export type EvidenceJudgeResult = {
  sufficient: boolean;
  score: number;
  reasons: string[];
  compactEvidence: string[];
};

function compactText(text: string, maxChars: number): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars)}...` : cleaned;
}

export class GeminiSidecar {
  private readonly apiKey: string | null;
  private readonly models: string[];
  private readonly client: GeminiClient | null;

  constructor() {
    this.apiKey = loadGeminiEnvValue('GEMINI_API_KEY');
    this.models = configuredGeminiFallbackModels(DEFAULT_GEMINI_CONFIG);
    this.client = this.apiKey ? new GeminiClient(this.apiKey) : null;
  }

  isConfigured(): boolean {
    return Boolean(this.client && this.models.length > 0);
  }

  async rankSearchResults(query: string, results: SearchRankInput[]): Promise<{ results: SearchRankInput[]; modelId: string | null; reason: string | null }> {
    if (!this.client || results.length < 2) {
      return { results, modelId: null, reason: null };
    }

    const payload = results.slice(0, 8).map(result => ({
      index: result.index,
      title: compactText(result.title, 140),
      url: result.url,
      snippet: compactText(result.snippet, 220),
    }));
    const prompt = [
      'Rank web search results for which should be opened first to answer the user query.',
      'Return strict JSON only: {"rankedIndices":[number],"reason":"short reason"}.',
      'Prefer official, primary, current, directly relevant pages. Avoid ads, generic listicles, login pages, and unrelated docs.',
      '',
      `Query: ${query}`,
      `Results: ${JSON.stringify(payload)}`,
    ].join('\n');

    const parsed = await this.client.generateJsonWithFallback<{ rankedIndices?: number[]; reason?: string }>({
      models: this.models,
      prompt,
      maxOutputTokens: 512,
    });
    if (!parsed?.json?.rankedIndices || !Array.isArray(parsed.json.rankedIndices)) {
      return { results, modelId: parsed?.modelId || null, reason: null };
    }

    const byIndex = new Map(results.map(result => [result.index, result]));
    const ranked: SearchRankInput[] = [];
    for (const index of parsed.json.rankedIndices) {
      const match = byIndex.get(index);
      if (match && !ranked.includes(match)) ranked.push(match);
    }
    for (const result of results) {
      if (!ranked.includes(result)) ranked.push(result);
    }
    return {
      results: ranked,
      modelId: parsed.modelId,
      reason: typeof parsed.json.reason === 'string' ? parsed.json.reason : null,
    };
  }

  async judgeEvidence(input: EvidenceJudgeInput): Promise<(EvidenceJudgeResult & { modelId: string }) | null> {
    if (!this.client) return null;

    const prompt = [
      'Decide whether the provided browser-observed evidence is enough to answer the user query.',
      'Return strict JSON only: {"sufficient":boolean,"score":number,"reasons":["short"],"compactEvidence":["short factual evidence"]}.',
      'Score is 0 to 10. sufficient should be true only when the evidence directly answers the query.',
      '',
      `Query: ${input.query}`,
      `Page: ${input.title} ${input.url}`,
      `Summary: ${compactText(input.summary, 700)}`,
      `Key facts: ${JSON.stringify(input.keyFacts.map(fact => compactText(fact, 260)).slice(0, 5))}`,
      `Cached snippets: ${JSON.stringify(input.snippets.map(snippet => compactText(snippet, 320)).slice(0, 4))}`,
    ].join('\n');

    const parsed = await this.client.generateJsonWithFallback<EvidenceJudgeResult>({
      models: this.models,
      prompt,
      maxOutputTokens: 768,
    });
    if (!parsed?.json || typeof parsed.json.sufficient !== 'boolean') return null;

    return {
      sufficient: parsed.json.sufficient,
      score: typeof parsed.json.score === 'number' ? parsed.json.score : 0,
      reasons: Array.isArray(parsed.json.reasons) ? parsed.json.reasons.filter((item): item is string => typeof item === 'string').slice(0, 4) : [],
      compactEvidence: Array.isArray(parsed.json.compactEvidence) ? parsed.json.compactEvidence.filter((item): item is string => typeof item === 'string').slice(0, 5) : [],
      modelId: parsed.modelId,
    };
  }
}

export const geminiSidecar = new GeminiSidecar();
