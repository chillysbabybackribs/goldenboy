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
};

// Matches OSC 633 sequences: \x1b]633;<payload>\x07
const OSC_633_RE = /\x1b\]633;([^\x07]*)\x07/g;

// Matches ANSI escape sequences (SGR, cursor, erase, etc.)
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;

export function parseOscSequences(data: string): ParseResult {
  const events: OscEvent[] = [];

  const cleaned = data.replace(OSC_633_RE, (_match, payload: string) => {
    const semi = payload.indexOf(';');
    const marker = semi === -1 ? payload : payload.slice(0, semi);
    const value = semi === -1 ? '' : payload.slice(semi + 1);

    switch (marker) {
      case 'C':
        events.push({ type: 'command-started' });
        break;
      case 'B':
        events.push({ type: 'prompt-started' });
        break;
      case 'E': {
        const code = parseInt(value, 10);
        if (!isNaN(code)) events.push({ type: 'exit-code', code });
        break;
      }
      case 'D':
        if (value) events.push({ type: 'cwd', path: value });
        break;
    }

    return ''; // strip the OSC sequence from output
  });

  return { cleaned, events };
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}
