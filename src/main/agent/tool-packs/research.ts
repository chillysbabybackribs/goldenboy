import type { ToolPackManifest } from './types';

export const researchToolPack: ToolPackManifest = {
  id: 'research',
  description: 'Web research and evidence gathering.',
  baseline4: [
    'browser.research_search',
    'browser.search_page_cache',
    'browser.read_cached_chunk',
  ],
  baseline6: [
    'browser.research_search',
    'browser.search_page_cache',
    'browser.read_cached_chunk',
    'browser.answer_from_cache',
    'browser.extract_page',
  ],
  tools: [
    'browser.research_search',
    'browser.search_web',
    'browser.navigate',
    'browser.extract_page',
    'browser.inspect_page',
    'browser.search_page_cache',
    'browser.read_cached_chunk',
    'browser.answer_from_cache',
    'browser.summarize_page',
    'browser.get_state',
    'browser.capture_snapshot',
  ],
  relatedPackIds: ['browser-automation'],
};
