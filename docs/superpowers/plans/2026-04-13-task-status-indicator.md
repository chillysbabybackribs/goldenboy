# Task Status Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a text-only typewriter status bar above the input box during agent runs, mapping raw progress events to short friendly phrases that type in, hold, then snap off.

**Architecture:** Add a single `<div id="taskStatusBar">` between the chat thread and input footer in the HTML. Drive it entirely from the existing `onProgress` handler in `command.ts` — no new IPC or main-process code. A self-contained `TaskStatusBar` class owns the typewriter loop, phrase mapping, and lifecycle.

**Tech Stack:** TypeScript, vanilla DOM, CSS (IBM Plex Mono, existing design tokens)

---

## File Map

| File | Change |
|---|---|
| `src/renderer/command/index.html` | Add `<div id="taskStatusBar">` between `#chatThread` and `.cc-input-footer` |
| `src/renderer/command/command.css` | Add `.cc-task-status` styles |
| `src/renderer/command/taskStatusBar.ts` | New file — `TaskStatusBar` class (typewriter engine + phrase mapper + lifecycle) |
| `src/renderer/command/command.ts` | Import and wire `TaskStatusBar` into run start/stop/progress |

---

### Task 1: Add the DOM element and CSS

**Files:**
- Modify: `src/renderer/command/index.html` (between line 34 and 36 — after `</div>` closing `#chatThread`, before `<!-- Input footer -->`)
- Modify: `src/renderer/command/command.css` (after the `.cc-chat` block, around line 88)

- [ ] **Step 1: Add the status bar element to the HTML**

Open `src/renderer/command/index.html`. Find this block (around line 34–36):

```html
        </div>

        <!-- Input footer — Command Center -->
```

Insert between them:

```html
        <!-- Task status bar — typewriter progress indicator -->
        <div id="taskStatusBar" class="cc-task-status" hidden></div>

```

- [ ] **Step 2: Add CSS for the status bar**

Open `src/renderer/command/command.css`. After the `.cc-chat-inner > :first-child:last-child` block (around line 94), add:

```css
/* ─── Task Status Bar ─────────────────────────────────────── */

.cc-task-status {
  padding: 0 clamp(48px, 6vw, 100px);
  height: 24px;
  display: flex;
  align-items: center;
  background: #0a0a0a;
  flex-shrink: 0;
  /* no border-top */
}

.cc-task-status-text {
  font-family: var(--font-code);
  font-size: 11px;
  color: #4a4a4a;
  letter-spacing: 0.3px;
  white-space: nowrap;
  overflow: hidden;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/command/index.html src/renderer/command/command.css
git commit -m "feat(command): add task status bar DOM element and CSS"
```

---

### Task 2: Create the TaskStatusBar class

**Files:**
- Create: `src/renderer/command/taskStatusBar.ts`

- [ ] **Step 1: Create the file**

Create `src/renderer/command/taskStatusBar.ts` with this full content:

```typescript
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
    // Otherwise the normal hold→snap cycle will call afterExit() which hides
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
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/command/taskStatusBar.ts
git commit -m "feat(command): TaskStatusBar class — typewriter engine and phrase mapper"
```

---

### Task 3: Wire TaskStatusBar into command.ts

**Files:**
- Modify: `src/renderer/command/command.ts`

- [ ] **Step 1: Import TaskStatusBar and get the DOM element**

At the top of `src/renderer/command/command.ts`, after the existing imports (around line 13), add:

```typescript
import { TaskStatusBar } from './taskStatusBar.js';
```

In the `// ─── DOM ───` section (around line 20), after the existing `const` declarations, add:

```typescript
const taskStatusBarEl = document.getElementById('taskStatusBar') as HTMLDivElement;
```

- [ ] **Step 2: Instantiate TaskStatusBar after DOM declarations**

After the DOM declarations block and before the `// ─── State ───` section, add:

```typescript
// ─── Task Status Bar ─────────────────────────────────────────────────────

const taskStatusBar = new TaskStatusBar(taskStatusBarEl);
```

- [ ] **Step 3: Call start() when a run begins**

Find the line `runningTaskId = taskId;` (around line 769). Add the `start()` call immediately after it:

```typescript
  runningTaskId = taskId;
  taskStatusBar.start();
  createLiveRunCard(taskId, resolvedOwner, prompt || undefined);
```

- [ ] **Step 4: Call end() in the finally block**

Find the `finally` block (around line 783):

```typescript
  } finally {
    runningTaskId = null;
    chatStopBtn.hidden = true;
    chatInput.focus();
  }
```

Change it to:

```typescript
  } finally {
    taskStatusBar.end();
    runningTaskId = null;
    chatStopBtn.hidden = true;
    chatInput.focus();
  }
```

- [ ] **Step 5: Call end(true) on STOP**

Find the `chatStopBtn` click handler (around line 789):

```typescript
chatStopBtn.addEventListener('click', () => {
  const modelApi = getModelAPI();
  if (runningTaskId && modelApi?.cancel) {
    void modelApi.cancel(runningTaskId);
  }
});
```

Change it to:

```typescript
chatStopBtn.addEventListener('click', () => {
  const modelApi = getModelAPI();
  if (runningTaskId && modelApi?.cancel) {
    taskStatusBar.end(true);
    void modelApi.cancel(runningTaskId);
  }
});
```

- [ ] **Step 6: Push progress events to the status bar**

Find the `onProgress` handler (around line 1038). The existing block is:

```typescript
  modelApi.onProgress((progress: any) => {
    const card = progress?.taskId ? getLiveRunCard(progress.taskId) : null;
    if (!card?.root.isConnected) return;
    if (progress.type === 'token') {
      appendToken(progress.taskId, String(progress.data || ''));
      return;
    }
    if (progress.type === 'item') {
      appendCodexItemProgress(progress.taskId, String(progress.data || ''), progress.codexItem as any);
      return;
    }
    if (progress.type === 'status') {
      const text = String(progress.data || '');
      if (text.startsWith('tool-start:') || text.startsWith('tool-done:')) {
        appendToolStatusInternal(progress.taskId, text);
      } else if (text.startsWith('Calling ')) {
        appendToolActivity(progress.taskId, 'call', text.replace(/^Calling\s+/, '').replace(/\.\.\.$/, ''));
      } else if (text.startsWith('Tool result: ')) {
        appendToolActivity(progress.taskId, 'result', text.slice('Tool result: '.length));
      } else if (text && !/^Turn completed/.test(text)) {
        appendThought(progress.taskId, text);
      }
    }
  });
```

Replace it with (adds two `taskStatusBar.push` calls):

```typescript
  modelApi.onProgress((progress: any) => {
    const card = progress?.taskId ? getLiveRunCard(progress.taskId) : null;
    if (!card?.root.isConnected) return;
    if (progress.type === 'token') {
      appendToken(progress.taskId, String(progress.data || ''));
      return;
    }
    if (progress.type === 'item') {
      appendCodexItemProgress(progress.taskId, String(progress.data || ''), progress.codexItem as any);
      return;
    }
    if (progress.type === 'status') {
      const text = String(progress.data || '');
      taskStatusBar.push(text);
      if (text.startsWith('tool-start:') || text.startsWith('tool-done:')) {
        appendToolStatusInternal(progress.taskId, text);
      } else if (text.startsWith('Calling ')) {
        appendToolActivity(progress.taskId, 'call', text.replace(/^Calling\s+/, '').replace(/\.\.\.$/, ''));
      } else if (text.startsWith('Tool result: ')) {
        appendToolActivity(progress.taskId, 'result', text.slice('Tool result: '.length));
      } else if (text && !/^Turn completed/.test(text)) {
        appendThought(progress.taskId, text);
      }
    }
  });
```

- [ ] **Step 7: Commit**

```bash
git add src/renderer/command/command.ts
git commit -m "feat(command): wire TaskStatusBar into run lifecycle and progress events"
```

---

### Task 4: Build and verify

- [ ] **Step 1: Run the TypeScript build**

```bash
npm run build 2>&1 | tail -20
```

Expected: no TypeScript errors. If you see `Cannot find module './taskStatusBar.js'`, confirm the file was created at `src/renderer/command/taskStatusBar.ts`.

- [ ] **Step 2: Start the app and send a message**

```bash
npm start
```

Send any message. While the agent is running, verify:
- A short phrase (e.g. `reading files`) appears below the chat thread, above the input box
- No dividing line between chat and the status bar
- Text types in character by character, holds ~1.5s, then snaps off
- A new phrase appears after the gap
- When the run finishes, the last phrase completes its hold and the bar disappears

- [ ] **Step 3: Test the STOP button**

While a task is running, click STOP. Verify the status bar disappears immediately (no hold).

- [ ] **Step 4: Commit if any fixups were needed**

```bash
git add -p
git commit -m "fix(command): task status bar fixups after manual verification"
```

Only commit if there were actual changes. Skip this step if build and verification passed cleanly.
