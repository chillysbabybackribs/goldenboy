// ─── TaskStatusBar ────────────────────────────────────────────────────────
// Self-contained typewriter status bar shown while a task is running.
// Rotates through a fixed phrase list independently — no event wiring needed.
// Usage: call start() when a run begins, end() when it finishes.

const PHRASES = [
  'working',
  'thinking',
  'reading files',
  'searching',
  'planning next step',
  'processing',
  'checking results',
  'almost there',
];

const CHAR_INTERVAL_MS = 45;  // ms per character typed
const HOLD_MS = 2000;         // how long the full phrase is visible
const GAP_MS = 150;           // blank gap before next phrase

export class TaskStatusBar {
  private root: HTMLElement;
  private textEl: HTMLElement;

  private phraseIndex = 0;
  private charIndex = 0;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(rootEl: HTMLElement) {
    this.root = rootEl;
    this.textEl = document.createElement('span');
    this.textEl.className = 'cc-task-status-text';
    this.root.appendChild(this.textEl);
  }

  /** Call when a run starts. Reveals the bar and begins the phrase loop. */
  start(): void {
    this.clearTimer();
    this.running = true;
    this.phraseIndex = 0;
    this.charIndex = 0;
    this.textEl.textContent = '';
    this.root.hidden = false;
    this.tick();
  }

  /**
   * Call when a run ends.
   * cancel=true  → hide immediately (STOP button)
   * cancel=false → finish the current phrase then hide
   */
  end(cancel = false): void {
    this.running = false;
    if (cancel) {
      this.clearTimer();
      this.hide();
    }
    // non-cancel: let the current tick() / afterHold() cycle call hide() naturally
  }

  // ── private ────────────────────────────────────────────────────────────

  private tick(): void {
    if (!this.running) { this.hide(); return; }

    const phrase = PHRASES[this.phraseIndex];
    if (this.charIndex <= phrase.length) {
      this.textEl.textContent = phrase.slice(0, this.charIndex);
      this.charIndex++;
      this.timerId = setTimeout(() => this.tick(), CHAR_INTERVAL_MS);
    } else {
      // Fully typed — hold
      this.timerId = setTimeout(() => this.afterHold(), HOLD_MS);
    }
  }

  private afterHold(): void {
    if (!this.running) { this.hide(); return; }
    // Snap off, advance to next phrase
    this.textEl.textContent = '';
    this.phraseIndex = (this.phraseIndex + 1) % PHRASES.length;
    this.charIndex = 0;
    this.timerId = setTimeout(() => this.tick(), GAP_MS);
  }

  private hide(): void {
    this.clearTimer();
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
