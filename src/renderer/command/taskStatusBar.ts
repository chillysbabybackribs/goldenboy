// ─── TaskStatusBar ────────────────────────────────────────────────────────
// Typewriter-style progress indicator shown during agent runs.
// Sits above the input box; driven by progress events from onProgress.

const PHRASE_MAP: Array<{ pattern: RegExp; phrase: string }> = [
  { pattern: /filesystem\.read|read_file_chunk/i,       phrase: 'reading files' },
  { pattern: /filesystem\.search|search_file_cache/i,   phrase: 'searching files' },
  { pattern: /filesystem\.index_workspace/i,            phrase: 'indexing workspace' },
  { pattern: /filesystem\.answer_from_cache/i,          phrase: 'checking file cache' },
  { pattern: /browser\.navigate/i,                      phrase: 'navigating' },
  { pattern: /browser\.search_page_cache|browser\.read_cached_chunk/i, phrase: 'reading page cache' },
  { pattern: /browser\.research_search|browser\.search_web/i,          phrase: 'searching the web' },
  { pattern: /browser\.extract_page/i,                  phrase: 'reading page' },
  { pattern: /terminal\.exec/i,                         phrase: 'running command' },
  { pattern: /subagent\.spawn/i,                        phrase: 'spawning agent' },
  { pattern: /subagent\.wait/i,                         phrase: 'waiting for agent' },
];

const CHAR_INTERVAL_MS = 38;
const HOLD_MS = 1500;
const GAP_MS = 120;

export class TaskStatusBar {
  private root: HTMLElement;
  private textEl: HTMLElement;

  private currentPhrase = '';
  private pendingPhrase: string | null = null;
  private phase: 'idle' | 'typing' | 'holding' | 'gap' = 'idle';
  private charIndex = 0;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private runEnding = false;

  constructor(rootEl: HTMLElement) {
    this.root = rootEl;
    this.textEl = document.createElement('span');
    this.textEl.className = 'cc-task-status-text';
    this.root.appendChild(this.textEl);
  }

  /** Call when a run starts. Shows the bar (empty) and resets state. */
  start(): void {
    this.runEnding = false;
    this.currentPhrase = '';
    this.pendingPhrase = null;
    this.phase = 'idle';
    this.charIndex = 0;
    this.clearTimer();
    this.textEl.textContent = '';
    this.root.hidden = false;
  }

  /**
   * Feed a raw progress status string. The bar maps it to a friendly phrase
   * and queues it. Skips tool-result events and unknown strings.
   */
  push(rawText: string): void {
    if (this.runEnding) return;
    const phrase = this.mapPhrase(rawText);
    if (!phrase) return;
    if (phrase === this.currentPhrase && this.phase !== 'idle') return; // dedupe

    if (this.phase === 'idle') {
      this.currentPhrase = phrase;
      this.startTyping();
    } else {
      // Queue — will be picked up after current phrase exits
      this.pendingPhrase = phrase;
    }
  }

  /**
   * Call when a run ends (success, error, or cancel).
   * - cancel=true: hide immediately.
   * - cancel=false: let current phrase finish its hold then hide.
   */
  end(cancel = false): void {
    if (cancel) {
      this.clearTimer();
      this.hide();
      return;
    }
    this.runEnding = true;
    this.pendingPhrase = null;
    // If already idle (no phrase ever arrived), hide immediately
    if (this.phase === 'idle') {
      this.hide();
    }
    // Otherwise the normal hold→snap cycle will call afterHold() which hides
  }

  // ── private ────────────────────────────────────────────────────────────

  private mapPhrase(raw: string): string | null {
    // Skip result events entirely
    if (raw.startsWith('Tool result:')) return null;
    if (raw.startsWith('tool-start:') || raw.startsWith('tool-done:')) return null;
    if (/^Turn completed/.test(raw)) return null;

    // Check Calling ... prefix first (strip it for matching)
    const stripped = raw.replace(/^Calling\s+/, '').replace(/\.\.\.$/, '').trim();

    for (const { pattern, phrase } of PHRASE_MAP) {
      if (pattern.test(stripped) || pattern.test(raw)) return phrase;
    }

    // Thoughts/reasoning that don't match a tool pattern
    if (!raw.startsWith('Calling ') && raw.trim().length > 0) return 'thinking';

    return null;
  }

  private startTyping(): void {
    this.phase = 'typing';
    this.charIndex = 0;
    this.tick();
  }

  private tick(): void {
    const phrase = this.currentPhrase;
    if (this.charIndex <= phrase.length) {
      this.textEl.textContent = phrase.slice(0, this.charIndex);
      this.charIndex++;
      this.timerId = setTimeout(() => this.tick(), CHAR_INTERVAL_MS);
    } else {
      // Done typing — hold
      this.phase = 'holding';
      this.timerId = setTimeout(() => this.afterHold(), HOLD_MS);
    }
  }

  private afterHold(): void {
    // Snap off
    this.textEl.textContent = '';
    this.phase = 'gap';

    if (this.runEnding) {
      this.hide();
      return;
    }

    this.timerId = setTimeout(() => this.afterGap(), GAP_MS);
  }

  private afterGap(): void {
    const next = this.pendingPhrase;
    this.pendingPhrase = null;

    if (next && next !== this.currentPhrase) {
      this.currentPhrase = next;
      this.startTyping();
    } else if (next) {
      // Same phrase — skip dedupe, just wait for more events
      this.phase = 'idle';
    } else {
      this.phase = 'idle';
    }
  }

  private hide(): void {
    this.clearTimer();
    this.phase = 'idle';
    this.textEl.textContent = '';
    this.root.hidden = true;
  }

  private clearTimer(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }
}
