export type SerpSource = 'google' | 'duckduckgo' | 'bing';

export type SerpCandidate = {
  url: string;
  title: string;
  snippet: string;
  serpRank: number;
  serpSource: SerpSource;
};
