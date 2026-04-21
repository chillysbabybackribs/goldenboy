/**
 * Markdown → HTML renderer used by the command chat pane.
 *
 * Intentionally small and DOM-free so it can run under unit tests as well as
 * inside the Electron renderer. The output is inserted via `innerHTML` into a
 * `.chat-markdown` container, so every untrusted segment is run through
 * `escapeHtmlPure` before it reaches the HTML string.
 *
 * Supported block syntax:
 *   - ATX headings (`#`..`######`, clamped to `<h4>`)
 *   - Paragraphs
 *   - Unordered lists (`-`, `*`)
 *   - Ordered lists (`1.`, `2.`, ...)
 *   - Fenced code blocks (```lang ... ```)
 *   - GitHub-flavoured pipe tables with optional alignment row
 *   - Blockquotes (`> ...`)
 *   - Horizontal rules (`---`, `***`, `___` alone on a line)
 *
 * Supported inline syntax:
 *   - `**bold**`
 *   - `` `code` ``
 *   - `[text](url)` links, with two renderings:
 *     - absolute file paths (start with `/`) become a compact chip whose path
 *       is hidden behind a `<details>` disclosure so long paths don't clutter
 *       the chat UI (e.g. `[AgentModelService.invoke()](/home/.../file.ts:12)`)
 *     - http/https links become real anchors that open in the system browser
 *     - every other scheme is rendered as plain text to avoid injecting
 *       `javascript:` or otherwise unsafe hrefs into the chat surface.
 *
 * This renderer deliberately does not change the assistant's wire format — it
 * only changes how the chat pane draws tables and code blocks that the models
 * already emit.
 */

/** DOM-free HTML escape so this module is usable in Node-based tests. */
function escapeHtmlPure(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const FILE_PATH_URL_RE = /^\/[^\s]+$/;
const HTTP_URL_RE = /^https?:\/\/[^\s]+$/;

/** Apply `**bold**` and `` `code` `` to an already-escaped HTML string. */
function applyInlineFormatting(escaped: string): string {
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

/**
 * Render a single markdown link `[text](url)`. The `text` and `url` arguments
 * come from the already-escaped source, so they are safe to splice straight
 * into HTML without re-escaping.
 */
function renderLink(linkText: string, url: string): string {
  if (FILE_PATH_URL_RE.test(url)) {
    // The whole chip is a single `<details>` so it flows inline with prose
    // without Chromium treating a nested `<details>` as a block-level stop.
    // Clicking the underlined label reveals the path pill next to it.
    return (
      `<details class="chat-file-ref">` +
        `<summary class="chat-file-ref-text" title="${url}">${linkText}</summary>` +
        `<code class="chat-file-ref-path">${url}</code>` +
      `</details>`
    );
  }
  if (HTTP_URL_RE.test(url)) {
    return `<a href="${url}" class="chat-external-link" target="_blank" rel="noopener">${linkText}</a>`;
  }
  // Unrecognized scheme — drop the URL entirely and keep just the label so
  // we never splice `javascript:` or similar into an href.
  return linkText;
}

function renderInlineMarkdown(text: string): string {
  const escaped = escapeHtmlPure(text);
  // Handle links first so their label is processed with inline formatting
  // (bold/code) but the URL passes through untouched. Otherwise inline
  // backticks inside a link label would be replaced with `<code>` before we
  // got a chance to split off the label.
  const withLinks = escaped.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_match, linkText: string, url: string) => renderLink(applyInlineFormatting(linkText), url),
  );
  return applyInlineFormatting(withLinks);
}

const FENCE_RE = /^(```+|~~~+)\s*([A-Za-z0-9_+\-.#]*)\s*$/;
const HR_RE = /^(?:-{3,}|\*{3,}|_{3,})$/;
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

type Alignment = 'left' | 'right' | 'center' | null;

/** Split a GFM table row on `|` while ignoring escaped pipes `\|`. */
function splitTableRow(row: string): string[] {
  let trimmed = row.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|') && !trimmed.endsWith('\\|')) trimmed = trimmed.slice(0, -1);

  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < trimmed.length; i += 1) {
    const char = trimmed[i];
    if (char === '\\' && trimmed[i + 1] === '|') {
      current += '|';
      i += 1;
      continue;
    }
    if (char === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseAlignments(separator: string): Alignment[] {
  return splitTableRow(separator).map((cell) => {
    const value = cell.trim();
    const left = value.startsWith(':');
    const right = value.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return null;
  });
}

function renderTable(headerRow: string, separatorRow: string, bodyRows: string[]): string {
  const headerCells = splitTableRow(headerRow);
  const alignments = parseAlignments(separatorRow);
  const columnCount = Math.max(headerCells.length, alignments.length);

  const alignAttr = (index: number): string => {
    const alignment = alignments[index] ?? null;
    return alignment ? ` style="text-align:${alignment}"` : '';
  };

  const headerHtml = headerCells
    .map((cell, index) => `<th${alignAttr(index)}>${renderInlineMarkdown(cell)}</th>`)
    .join('');

  const bodyHtml = bodyRows
    .map((row) => {
      const cells = splitTableRow(row);
      const filled = Array.from({ length: columnCount }, (_, index) => cells[index] ?? '');
      const rowHtml = filled
        .map((cell, index) => `<td${alignAttr(index)}>${renderInlineMarkdown(cell)}</td>`)
        .join('');
      return `<tr>${rowHtml}</tr>`;
    })
    .join('');

  const body = bodyHtml ? `<tbody>${bodyHtml}</tbody>` : '';
  return `<div class="chat-markdown-table-wrap"><table class="chat-markdown-table"><thead><tr>${headerHtml}</tr></thead>${body}</table></div>`;
}

/** Is `line` a plausible table header/body row (contains at least one `|`)? */
function isTableRowCandidate(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return false;
  // A bare `|` or `||` is not a table.
  return /\|/.test(trimmed) && trimmed.replace(/\|/g, '').trim().length > 0;
}

export function renderMarkdown(text: string): string {
  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .trim();

  const lines = normalized.split('\n');
  const parts: string[] = [];

  let paragraph: string[] = [];
  let listItems: string[] = [];
  let listOrdered = false;
  let blockquote: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    parts.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (listItems.length === 0) return;
    const tag = listOrdered ? 'ol' : 'ul';
    parts.push(
      `<${tag}>${listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</${tag}>`,
    );
    listItems = [];
    listOrdered = false;
  };

  const flushBlockquote = () => {
    if (blockquote.length === 0) return;
    const inner = blockquote.map((line) => renderInlineMarkdown(line)).join('<br>');
    parts.push(`<blockquote>${inner}</blockquote>`);
    blockquote = [];
  };

  const flushAllInlineBlocks = () => {
    flushParagraph();
    flushList();
    flushBlockquote();
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    // Fenced code block — preserve contents verbatim, keep original indentation.
    const fenceMatch = trimmed.match(FENCE_RE);
    if (fenceMatch) {
      flushAllInlineBlocks();
      const fence = fenceMatch[1];
      const lang = fenceMatch[2] ?? '';
      const codeLines: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j += 1) {
        const closer = lines[j].trim();
        if (closer.startsWith(fence) && /^(```+|~~~+)\s*$/.test(closer)) break;
        codeLines.push(lines[j]);
      }
      i = j; // skip the closing fence (or end-of-input)
      const langClass = lang ? ` class="language-${escapeHtmlPure(lang)}"` : '';
      const langAttr = lang ? ` data-lang="${escapeHtmlPure(lang)}"` : '';
      const body = escapeHtmlPure(codeLines.join('\n'));
      parts.push(`<pre${langAttr}><code${langClass}>${body}</code></pre>`);
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushBlockquote();
      continue;
    }

    if (HR_RE.test(trimmed)) {
      flushAllInlineBlocks();
      parts.push('<hr>');
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushAllInlineBlocks();
      const level = Math.min(4, heading[1].length);
      parts.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    if (trimmed.startsWith('>')) {
      flushParagraph();
      flushList();
      blockquote.push(trimmed.replace(/^>\s?/, ''));
      continue;
    }

    // Table detection — requires a separator row immediately after a header row.
    if (isTableRowCandidate(line) && i + 1 < lines.length && TABLE_SEPARATOR_RE.test(lines[i + 1])) {
      flushAllInlineBlocks();
      const headerRow = line;
      const separatorRow = lines[i + 1];
      const body: string[] = [];
      let j = i + 2;
      for (; j < lines.length; j += 1) {
        if (!isTableRowCandidate(lines[j])) break;
        body.push(lines[j]);
      }
      parts.push(renderTable(headerRow, separatorRow, body));
      i = j - 1;
      continue;
    }

    const isUnordered = trimmed.startsWith('- ') || trimmed.startsWith('* ');
    const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/);

    if (isUnordered) {
      if (listItems.length > 0 && listOrdered) flushList();
      flushParagraph();
      flushBlockquote();
      listOrdered = false;
      listItems.push(trimmed.slice(2));
      continue;
    }

    if (orderedMatch) {
      if (listItems.length > 0 && !listOrdered) flushList();
      flushParagraph();
      flushBlockquote();
      listOrdered = true;
      listItems.push(orderedMatch[1]);
      continue;
    }

    flushList();
    flushBlockquote();
    paragraph.push(trimmed);
  }

  flushAllInlineBlocks();
  return parts.join('');
}
