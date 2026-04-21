/**
 * Visual file-type tiles for chat attachments (compose preview + sent messages).
 * Icons are original SVGs inspired by common document affordances — not third-party trademarks.
 */

export type AttachmentFileKind =
  | 'pdf'
  | 'markdown'
  | 'html'
  | 'text'
  | 'spreadsheet'
  | 'word'
  | 'presentation'
  | 'code'
  | 'archive'
  | 'image'
  | 'document';

const CODE_EXT = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift',
  'c', 'cc', 'cpp', 'h', 'hpp', 'cs', 'php', 'vue', 'svelte', 'css', 'scss', 'less',
  'sql', 'sh', 'bash', 'zsh', 'yaml', 'yml', 'toml', 'xml', 'graphql', 'r', 'dart',
]);

const SPREADSHEET_EXT = new Set(['xls', 'xlsx', 'xlsm', 'ods', 'csv', 'tsv']);
const WORD_EXT = new Set(['doc', 'docx', 'odt', 'rtf']);
const PRESENTATION_EXT = new Set(['ppt', 'pptx', 'odp', 'key']);
const ARCHIVE_EXT = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz']);
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'heic']);

function extFromName(name: string): string {
  const i = name.lastIndexOf('.');
  if (i <= 0 || i === name.length - 1) return '';
  return name.slice(i + 1).toLowerCase();
}

/** Classify by filename and optional MIME type (from upload or server). */
export function getAttachmentFileKind(name: string, mediaType?: string): AttachmentFileKind {
  const mt = (mediaType || '').toLowerCase();
  const ext = extFromName(name);

  if (mt.includes('pdf') || ext === 'pdf') return 'pdf';
  if (mt.includes('markdown') || ext === 'md' || ext === 'markdown' || ext === 'mdx') return 'markdown';
  if (mt.includes('html') || ext === 'html' || ext === 'htm' || ext === 'xhtml') return 'html';
  if (mt.startsWith('text/') || ext === 'txt' || ext === 'log') return 'text';
  if (
    mt.includes('spreadsheet') ||
    mt.includes('csv') ||
    mt.includes('excel') ||
    mt.includes('ms-excel') ||
    SPREADSHEET_EXT.has(ext)
  ) {
    return 'spreadsheet';
  }
  if (mt.includes('word') || mt.includes('opendocument.text') || WORD_EXT.has(ext)) return 'word';
  if (mt.includes('presentation') || mt.includes('powerpoint') || PRESENTATION_EXT.has(ext)) return 'presentation';
  if (mt.includes('json') || ext === 'json' || ext === 'jsonc') return 'code';
  if (CODE_EXT.has(ext)) return 'code';
  if (mt.startsWith('image/') || IMAGE_EXT.has(ext)) return 'image';
  if (mt.includes('zip') || mt.includes('compressed') || ARCHIVE_EXT.has(ext)) return 'archive';

  return 'document';
}

/** Large decorative SVG (viewBox 0 0 64 64) for attachment tiles. */
export function attachmentIconSvg(kind: AttachmentFileKind): string {
  switch (kind) {
    case 'pdf':
      // Red tile with folded corner + white curves (distinct from any vendor logo)
      return `<svg class="cc-file-icon-svg" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <rect x="4" y="2" width="48" height="58" rx="5" fill="#e5252a"/>
  <path d="M44 2h8v14H44z" fill="#ff7a7e"/>
  <path d="M44 2l8 8h-8z" fill="#ffd6d8"/>
  <path d="M18 38c8-6 18-6 28 0" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
  <path d="M22 44c10-5 20-5 30 0" fill="none" stroke="#fff" stroke-opacity="0.85" stroke-width="2.5" stroke-linecap="round"/>
</svg>`;
    case 'markdown':
      return `<svg class="cc-file-icon-svg" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <rect x="6" y="4" width="44" height="54" rx="4" fill="#e8e8ea"/>
  <rect x="14" y="16" width="28" height="22" rx="3" fill="#2d2d33"/>
  <text x="28" y="32" font-family="system-ui,sans-serif" font-size="16" font-weight="700" fill="#fff">M</text>
  <path d="M28 36l4 4 4-4" fill="none" stroke="#7eb8ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
    case 'html':
      return `<svg class="cc-file-icon-svg" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <rect x="6" y="4" width="44" height="54" rx="4" fill="#e8e8ea"/>
  <text x="32" y="38" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-size="18" font-weight="600" fill="#3b82f6">&lt;/&gt;</text>
</svg>`;
    case 'text':
      return `<svg class="cc-file-icon-svg" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <rect x="6" y="4" width="44" height="54" rx="4" fill="#e8e8ea"/>
  <path d="M14 18h28M14 26h28M14 34h20" stroke="#9ca3af" stroke-width="3" stroke-linecap="round"/>
  <path d="M14 42h24" stroke="#c4c4c4" stroke-width="2.5" stroke-linecap="round"/>
</svg>`;
    case 'spreadsheet':
      return `<svg class="cc-file-icon-svg" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <rect x="4" y="4" width="48" height="54" rx="5" fill="#217346"/>
  <path d="M14 18h36v28H14z" fill="#fff" fill-opacity="0.12"/>
  <path d="M14 18v28M26 18v28M38 18v28M50 18v28M14 26h36M14 34h36M14 42h36" stroke="#fff" stroke-opacity="0.35" stroke-width="1.5"/>
  <rect x="14" y="18" width="12" height="8" fill="#fff" fill-opacity="0.25"/>
</svg>`;
    case 'word':
      return `<svg class="cc-file-icon-svg" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <rect x="4" y="4" width="48" height="54" rx="5" fill="#2b579a"/>
  <text x="32" y="40" text-anchor="middle" font-family="Georgia,serif" font-size="22" font-weight="700" fill="#fff">W</text>
</svg>`;
    case 'presentation':
      return `<svg class="cc-file-icon-svg" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <rect x="4" y="4" width="48" height="54" rx="5" fill="#d24726"/>
  <rect x="12" y="16" width="32" height="22" rx="2" fill="#fff" fill-opacity="0.9"/>
  <circle cx="28" cy="27" r="4" fill="#d24726"/>
  <path d="M36 31l6 4v-8z" fill="#d24726"/>
</svg>`;
    case 'code':
      return `<svg class="cc-file-icon-svg" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <rect x="6" y="4" width="44" height="54" rx="4" fill="#1e293b"/>
  <path d="M22 22l-8 10 8 10M42 22l8 10-8 10" fill="none" stroke="#a5b4fc" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
    case 'archive':
      return `<svg class="cc-file-icon-svg" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <rect x="4" y="4" width="48" height="54" rx="5" fill="#ca8a04"/>
  <rect x="22" y="10" width="12" height="10" rx="2" fill="#fde68a"/>
  <path d="M20 22h24v28H20z" fill="#fff" fill-opacity="0.2"/>
  <path d="M26 28h12M26 36h12M26 44h8" stroke="#fff" stroke-opacity="0.5" stroke-width="2" stroke-linecap="round"/>
</svg>`;
    case 'image':
      return `<svg class="cc-file-icon-svg" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <rect x="4" y="4" width="48" height="54" rx="5" fill="#0f766e"/>
  <circle cx="22" cy="22" r="4" fill="#fde68a"/>
  <path d="M14 46l10-12 8 8 10-14 8 10v16H14z" fill="#99f6e4" fill-opacity="0.35"/>
</svg>`;
    case 'document':
    default:
      return `<svg class="cc-file-icon-svg" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <rect x="6" y="4" width="44" height="54" rx="4" fill="#d4d4d8"/>
  <path d="M38 4h12v14H38z" fill="#a1a1aa"/>
  <path d="M38 4l12 12H38z" fill="#e4e4e7"/>
  <path d="M16 34h28M16 42h22M16 50h26" stroke="#71717a" stroke-width="2.5" stroke-linecap="round"/>
</svg>`;
  }
}
