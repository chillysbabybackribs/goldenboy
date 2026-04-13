// ═══════════════════════════════════════════════════════════════════════════
// OSC 633 Parser — Extracts shell integration markers from PTY output
// Also strips ANSI escape sequences for model-readable output
// ═══════════════════════════════════════════════════════════════════════════

export type OscEvent =
  | { type: 'command-started' }
  | { type: 'prompt-started' }
  | { type: 'exit-code'; code: number }
  | { type: 'cwd'; path: string };

export type ParseResult = {
  cleaned: string;
  events: OscEvent[];
  parts: Array<
    | { type: 'text'; value: string }
    | { type: 'event'; event: OscEvent }
  >;
};

// Matches OSC 633 sequences: \x1b]633;<payload>\x07
const OSC_633_RE = /\x1b\]633;([^\x07]*)\x07/g;

// Matches ANSI escape sequences (SGR, cursor, erase, etc.)
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;

export function parseOscSequences(data: string): ParseResult {
  const events: OscEvent[] = [];
  const parts: ParseResult['parts'] = [];
  let cleaned = '';
  let lastIndex = 0;

  data.replace(OSC_633_RE, (match, payload: string, offset: number) => {
    if (offset > lastIndex) {
      const text = data.slice(lastIndex, offset);
      cleaned += text;
      parts.push({ type: 'text', value: text });
    }

    const semi = payload.indexOf(';');
    const marker = semi === -1 ? payload : payload.slice(0, semi);
    const value = semi === -1 ? '' : payload.slice(semi + 1);
    let event: OscEvent | null = null;

    switch (marker) {
      case 'C':
        event = { type: 'command-started' };
        break;
      case 'B':
        event = { type: 'prompt-started' };
        break;
      case 'E': {
        const code = parseInt(value, 10);
        if (!isNaN(code)) event = { type: 'exit-code', code };
        break;
      }
      case 'D':
        if (value) event = { type: 'cwd', path: value };
        break;
    }

    if (event) {
      events.push(event);
      parts.push({ type: 'event', event });
    }

    lastIndex = offset + match.length;
    return '';
  });

  if (lastIndex < data.length) {
    const text = data.slice(lastIndex);
    cleaned += text;
    parts.push({ type: 'text', value: text });
  }

  return { cleaned, events, parts };
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}
