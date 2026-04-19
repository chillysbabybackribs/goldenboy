function escapeInlineHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderInlineMarkdown(text: string): string {
  return escapeInlineHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function splitDenseParagraph(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  if (normalized.length < 240) return [normalized];

  const sentences = normalized
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'`([])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length < 3) return [normalized];

  const segments: string[] = [];
  let current: string[] = [];

  const flush = () => {
    const joined = current.join(' ').trim();
    if (joined) segments.push(joined);
    current = [];
  };

  for (const sentence of sentences) {
    const nextLength = current.length === 0
      ? sentence.length
      : current.join(' ').length + 1 + sentence.length;

    if (current.length >= 2 && nextLength > 260) {
      flush();
    }

    current.push(sentence);

    if (current.length >= 3 && current.join(' ').length >= 170) {
      flush();
    }
  }

  flush();
  return segments.length > 0 ? segments : [normalized];
}

function renderParagraphBlock(lines: string[]): string {
  const text = lines.join(' ').trim();
  return splitDenseParagraph(text)
    .map((segment) => `<p>${renderInlineMarkdown(segment)}</p>`)
    .join('');
}

export function renderMarkdown(text: string): string {
  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .trim();

  if (!normalized) return '';

  const lines = normalized.split('\n');
  const parts: string[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let listOrdered = false;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    parts.push(renderParagraphBlock(paragraph));
    paragraph = [];
  };

  const flushList = () => {
    if (listItems.length === 0) return;
    const tag = listOrdered ? 'ol' : 'ul';
    parts.push(`<${tag}>${listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</${tag}>`);
    listItems = [];
    listOrdered = false;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      flushParagraph();
      flushList();
      parts.push('<hr>');
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(3, heading[1].length);
      parts.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    if (/^[A-Z][A-Za-z0-9 /&()+-]{1,48}:$/.test(trimmed)) {
      flushParagraph();
      flushList();
      parts.push(`<h3>${renderInlineMarkdown(trimmed.slice(0, -1))}</h3>`);
      continue;
    }

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (listItems.length > 0 && listOrdered) flushList();
      flushParagraph();
      listOrdered = false;
      listItems.push(trimmed.slice(2));
      continue;
    }

    const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch) {
      if (listItems.length > 0 && !listOrdered) flushList();
      flushParagraph();
      listOrdered = true;
      listItems.push(orderedMatch[1]);
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  return parts.join('');
}
