import { CachedPageChunk } from './PageCacheTypes';
import { estimateTokens } from './PageCleaner';

const MAX_CHUNK_CHARS = 1800;
const MIN_CHUNK_CHARS = 120;

/**
 * Section headings that almost always mark non-body content. We drop the
 * matching section entirely unless it's the only section in the page. Match
 * is case-insensitive + trim-tolerant.
 */
const DROP_HEADING_RE =
  /^(menu|navigation|primary navigation|main navigation|footer|sidebar|related( articles?| posts?| stories?)?|you (may|might) also (like|enjoy)|you might like|recommended( for you)?|trending( now)?|most popular|most read|read next|more stories|editor'?s picks?|comments?|comment section|share( this)?|social|newsletter|subscribe|cookie (notice|banner|policy)|your (privacy|cookie) (choices|preferences)|breadcrumbs?|table of contents|on this page|in this article)$/i;

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

  const keptSections = sections.length === 1
    ? sections
    : sections.filter(section => !shouldDropSection(section));

  for (const section of keptSections) {
    for (const text of splitLongText(section.text, MAX_CHUNK_CHARS)) {
      const trimmed = text.trim();
      if (trimmed.length < MIN_CHUNK_CHARS && keptSections.length > 1) continue;
      // Density filter: drop chunks that look like nav/link-lists. Applied
      // only when we have another chunk to fall back to, to avoid wiping the
      // whole page on aggressive templates.
      if (isLowDensity(trimmed) && chunks.length > 0) continue;
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

function shouldDropSection(section: { heading: string; text: string }): boolean {
  const heading = section.heading.trim();
  if (!heading) return false;
  return DROP_HEADING_RE.test(heading);
}

/**
 * Returns true for text that looks like a link list or navigation dump:
 * mostly short lines, few lines that contain a real sentence (≥5 words). We
 * require a minimum line count before judging so short real-content sections
 * don't trip the filter.
 */
export function isLowDensity(text: string): boolean {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.length < 4) return false;
  let wordy = 0;
  for (const line of lines) {
    if (line.split(/\s+/).length >= 5) wordy++;
  }
  return wordy / lines.length < 0.3;
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
