import { CachedPageChunk } from './PageCacheTypes';
import { estimateTokens } from './PageCleaner';

const MAX_CHUNK_CHARS = 1800;
const MIN_CHUNK_CHARS = 120;

export function chunkPage(input: {
  pageId: string;
  tabId: string;
  url: string;
  title: string;
  content: string;
  createdAt: number;
}): CachedPageChunk[] {
  const sections = splitSections(input.content);
  const chunks: CachedPageChunk[] = [];
  let ordinal = 0;

  for (const section of sections) {
    for (const text of splitLongText(section.text, MAX_CHUNK_CHARS)) {
      const trimmed = text.trim();
      if (trimmed.length < MIN_CHUNK_CHARS && sections.length > 1) continue;
      chunks.push({
        id: `${input.pageId}_chunk_${ordinal}`,
        pageId: input.pageId,
        tabId: input.tabId,
        url: input.url,
        title: input.title,
        heading: section.heading,
        text: trimmed,
        ordinal,
        tokenEstimate: estimateTokens(trimmed),
        createdAt: input.createdAt,
      });
      ordinal++;
    }
  }

  if (chunks.length === 0 && input.content.trim()) {
    const text = input.content.trim().slice(0, MAX_CHUNK_CHARS);
    chunks.push({
      id: `${input.pageId}_chunk_0`,
      pageId: input.pageId,
      tabId: input.tabId,
      url: input.url,
      title: input.title,
      heading: input.title,
      text,
      ordinal: 0,
      tokenEstimate: estimateTokens(text),
      createdAt: input.createdAt,
    });
  }

  return chunks;
}

function splitSections(content: string): Array<{ heading: string; text: string }> {
  const lines = content.split('\n');
  const sections: Array<{ heading: string; text: string[] }> = [];
  let current: { heading: string; text: string[] } = { heading: '', text: [] };

  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      if (current.text.join('\n').trim()) sections.push(current);
      current = { heading: heading[1].trim(), text: [line] };
    } else {
      current.text.push(line);
    }
  }

  if (current.text.join('\n').trim()) sections.push(current);
  return sections.map(section => ({ heading: section.heading, text: section.text.join('\n') }));
}

function splitLongText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const paragraphs = text.split(/\n\s*\n/);
  const chunks: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    if ((current + '\n\n' + paragraph).trim().length > maxChars && current.trim()) {
      chunks.push(current.trim());
      current = '';
    }
    if (paragraph.length > maxChars) {
      for (let i = 0; i < paragraph.length; i += maxChars) {
        chunks.push(paragraph.slice(i, i + maxChars));
      }
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
