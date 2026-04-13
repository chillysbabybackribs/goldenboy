# Command Center Input Area Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three-zone input footer (top bar + textarea + bottom bar) with a slim two-zone layout: a minimal top bar (single model chip + icon-only history) and a unified bordered input box (textarea + attach buttons + send inside one container), while moving token counts to the status bar.

**Architecture:** Pure HTML/CSS/TS changes in `src/renderer/command/`. No new files needed — three existing files are modified in sequence: HTML structure first, then CSS to match, then TS to rewire DOM references. The model dropdown, history popup, attach logic, and submit/stop wiring are all preserved unchanged — only the elements they bind to change.

**Tech Stack:** Vanilla TypeScript, plain HTML/CSS (no build step for HTML/CSS changes; TS is compiled by the existing build pipeline).

---

## File Map

| File | What changes |
|---|---|
| `src/renderer/command/index.html` | Replace dual-toggle + token gauge + separate bottom bar with model chip, icon-only history, and unified `cc-compose-box` |
| `src/renderer/command/command.css` | Remove `.cc-model-toggle*` and `.cc-token-gauge*` blocks; add `.cc-model-chip` and `.cc-compose-box` rules; slim down `.cc-compose-topbar` |
| `src/renderer/command/command.ts` | Swap DOM refs: `modelToggleGroup/Gpt54Btn/HaikuBtn` → `modelChip`; `tokenGauge/tokenInLabel/tokenOutLabel/tokenResetBtn` → `tokenStatusLabel`; update `syncModelToggleState`, `initializeModelToggle`, `updateTokenUsageDisplay`, and `renderState` to use new elements |

---

## Task 1: Restructure HTML — top bar

**Files:**
- Modify: `src/renderer/command/index.html:53-78`

Replace the compose-topbar contents (dual-toggle + token gauge + history button) with a single model chip and an icon-only history button. The token gauge `div#tokenGauge` is removed entirely from this area.

- [ ] **Step 1: Open the file and locate the compose-topbar block**

Read lines 53–78 of `src/renderer/command/index.html`. Confirm they contain `cc-compose-topbar`, `cc-model-toggle`, `cc-token-gauge`, and `cc-history-btn`.

- [ ] **Step 2: Replace the compose-topbar inner content**

Replace this entire block:
```html
            <!-- Top bar: model selector + token gauge + history -->
            <div class="cc-compose-topbar">
              <div class="cc-model-toggle" id="modelToggleGroup" role="group" aria-label="Primary model selection">
                <button class="cc-model-toggle-btn" id="modelToggleGpt54Btn" type="button" data-owner="gpt-5.4" aria-pressed="false">GPT-5.4</button>
                <button class="cc-model-toggle-btn" id="modelToggleHaikuBtn" type="button" data-owner="haiku" aria-pressed="false">HAIKU</button>
              </div>
              <div class="cc-token-gauge" id="tokenGauge">
                <svg class="cc-token-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM8 3v5l3.5 2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <span class="cc-token-in" id="tokenInLabel">0 in</span>
                <span class="cc-token-sep">/</span>
                <span class="cc-token-out" id="tokenOutLabel">0 out</span>
                <button class="cc-token-reset" id="tokenResetBtn" type="button" title="Reset token counter" aria-label="Reset token counter">
                  <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                    <path d="M1.5 6.5a4.5 4.5 0 018.24-2.5M10.5 5.5a4.5 4.5 0 01-8.24 2.5" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
                    <path d="M9.5 1.5v2.5h-2.5M2.5 10.5v-2.5h2.5" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </button>
              </div>
              <button class="cc-history-btn" id="chatHistoryBtn" type="button" title="Chat history" aria-label="Chat history">
                <svg class="cc-history-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <path d="M2 4h12M2 8h8M2 12h10" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                </svg>
                HISTORY
              </button>
            </div>
```

With:
```html
            <!-- Top bar: model chip + history icon -->
            <div class="cc-compose-topbar">
              <button class="cc-model-chip" id="modelChip" type="button" aria-haspopup="true" aria-label="Select model">
                <span class="cc-model-chip-dot" aria-hidden="true"></span>
                <span class="cc-model-chip-label" id="modelChipLabel">AUTO</span>
                <svg class="cc-model-chip-chevron" viewBox="0 0 10 10" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
                  <path d="M2 3.5l3 3 3-3"/>
                </svg>
              </button>
              <button class="cc-history-btn" id="chatHistoryBtn" type="button" title="Chat history" aria-label="Chat history">
                <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round">
                  <path d="M2 4h12M2 8h8M2 12h10"/>
                </svg>
              </button>
            </div>
```

- [ ] **Step 3: Verify the file looks correct**

Read lines 50–85 of `src/renderer/command/index.html` and confirm:
- `modelChip` button is present with `modelChipLabel` span inside
- No `modelToggleGroup`, `modelToggleGpt54Btn`, `modelToggleHaikuBtn` remain
- No `tokenGauge`, `tokenInLabel`, `tokenOutLabel`, `tokenResetBtn` remain
- `chatHistoryBtn` still present, text "HISTORY" removed, only SVG inside

---

## Task 2: Restructure HTML — unified input box

**Files:**
- Modify: `src/renderer/command/index.html:80-116`

Wrap the textarea and bottom bar together in a `cc-compose-box` container. Remove the standalone border from the textarea (it will be provided by the box).

- [ ] **Step 1: Replace the textarea + bottom bar section**

Replace this block (starting after the closing `</div>` of `cc-compose-topbar`):
```html
            <!-- Textarea -->
            <textarea class="cc-input" id="chatInput" placeholder="Send a message..." autocomplete="off" rows="2"></textarea>

            <!-- Bottom bar: attach buttons + stop + send -->
            <div class="cc-compose-bottombar">
              <div class="cc-attach-group">
                <button class="cc-attach-btn" id="attachDocBtn" type="button" title="Attach document" aria-label="Attach document">
                  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                    <path d="M9 1.5H4.5a2 2 0 00-2 2v9a2 2 0 002 2h7a2 2 0 002-2V6L9 1.5z" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M9 1.5V6h4.5" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                  <span>Doc</span>
                </button>
                <button class="cc-attach-btn" id="attachImgBtn" type="button" title="Attach image" aria-label="Attach image">
                  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                    <rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.1"/>
                    <circle cx="5.5" cy="6" r="1.25" fill="none" stroke="currentColor" stroke-width="1"/>
                    <path d="M1.5 11l3.5-3.5L8.5 11l2.5-2.5 3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                  <span>Image</span>
                </button>
              </div>
              <div class="cc-compose-actions">
                <button class="cc-stop-btn" id="chatStopBtn" type="button" title="Stop task" aria-label="Stop task" hidden>STOP</button>
                <button class="cc-send-btn" id="chatSubmitBtn" type="button" title="Send message" aria-label="Send message">
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M12 6v12"></path>
                    <path d="M7 11l5-5 5 5"></path>
                  </svg>
                </button>
              </div>
            </div>
```

With:
```html
            <!-- Unified input box: textarea + inner bottom bar -->
            <div class="cc-compose-box">
              <textarea class="cc-input" id="chatInput" placeholder="Send a message..." autocomplete="off" rows="2"></textarea>
              <div class="cc-compose-innerbar">
                <div class="cc-attach-group">
                  <button class="cc-attach-btn" id="attachDocBtn" type="button" title="Attach document" aria-label="Attach document">
                    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                      <path d="M9 1.5H4.5a2 2 0 00-2 2v9a2 2 0 002 2h7a2 2 0 002-2V6L9 1.5z" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>
                      <path d="M9 1.5V6h4.5" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <span>Doc</span>
                  </button>
                  <button class="cc-attach-btn" id="attachImgBtn" type="button" title="Attach image" aria-label="Attach image">
                    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                      <rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.1"/>
                      <circle cx="5.5" cy="6" r="1.25" fill="none" stroke="currentColor" stroke-width="1"/>
                      <path d="M1.5 11l3.5-3.5L8.5 11l2.5-2.5 3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <span>Image</span>
                  </button>
                </div>
                <div class="cc-compose-actions">
                  <button class="cc-stop-btn" id="chatStopBtn" type="button" title="Stop task" aria-label="Stop task" hidden>STOP</button>
                  <button class="cc-send-btn" id="chatSubmitBtn" type="button" title="Send message" aria-label="Send message">
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path d="M12 6v12"></path>
                      <path d="M7 11l5-5 5 5"></path>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
```

- [ ] **Step 2: Verify the file looks correct**

Read lines 78–120 of `src/renderer/command/index.html` and confirm:
- `cc-compose-box` div wraps both the textarea and inner bar
- `cc-compose-innerbar` replaces `cc-compose-bottombar` as the inner flex row
- `attachDocBtn`, `attachImgBtn`, `chatStopBtn`, `chatSubmitBtn` IDs all present
- No `cc-compose-bottombar` class remains

---

## Task 3: Add token display to status bar in HTML

**Files:**
- Modify: `src/renderer/command/index.html:151-158`

Add a `<span id="tokenStatusLabel">` to the existing `cc-status` bar.

- [ ] **Step 1: Locate the status bar block**

Read lines 150–160 of `src/renderer/command/index.html`. Confirm it contains `cc-status` div with spans: `syncLabel`, `splitLabel`, `targetLabel`, `modelLabel`, `sessionLabel`, `taskCount`.

- [ ] **Step 2: Add the token span to the status bar**

Replace:
```html
    <div class="cc-status">
      <span id="syncLabel">synced</span>
      <span id="splitLabel">split 50/50</span>
      <span id="targetLabel">target auto</span>
      <span id="modelLabel">idle</span>
      <span id="sessionLabel">—</span>
      <span id="taskCount">tasks: 0</span>
    </div>
```

With:
```html
    <div class="cc-status">
      <span id="syncLabel">synced</span>
      <span id="splitLabel">split 50/50</span>
      <span id="targetLabel">target auto</span>
      <span id="modelLabel">idle</span>
      <span id="sessionLabel">—</span>
      <span id="taskCount">tasks: 0</span>
      <span id="tokenStatusLabel">0 in / 0 out</span>
    </div>
```

- [ ] **Step 3: Commit HTML changes**

```bash
git add src/renderer/command/index.html
git commit -m "refactor(command): restructure input footer HTML — model chip, unified box, token in status bar"
```

---

## Task 4: Update CSS — remove old rules

**Files:**
- Modify: `src/renderer/command/command.css`

Remove the CSS blocks for the old dual-toggle and token gauge. These are dead code once the HTML elements are gone.

- [ ] **Step 1: Remove `.cc-model-toggle` and `.cc-model-toggle-btn` blocks**

Delete the entire block from the comment `/* ─── Top Bar` through the end of `.cc-model-toggle-btn:disabled` (approximately lines 541–619 in the original file — the full `.cc-compose-topbar`, `.cc-model-toggle`, and all `.cc-model-toggle-btn` variant rules).

Specifically, remove these CSS rules (find by class name, not line number, since previous edits may shift lines):
- `.cc-compose-topbar` — keep the selector but gut its content (we'll rewrite it below)
- `.cc-model-toggle` — remove entirely
- `.cc-model-toggle-btn` — remove entirely
- `.cc-model-toggle-btn:hover:not(:disabled)` — remove entirely
- `.cc-model-toggle-btn:active:not(:disabled)` — remove entirely
- `.cc-model-toggle-btn[aria-pressed="true"]` — remove entirely
- `.cc-model-toggle-btn[aria-pressed="true"]:hover:not(:disabled)` — remove entirely
- `.cc-model-toggle-btn[data-status="busy"]` — remove entirely
- `.cc-model-toggle-btn[data-status="unavailable"], .cc-model-toggle-btn[data-status="error"]` — remove entirely
- `.cc-model-toggle-btn:disabled` — remove entirely

- [ ] **Step 2: Remove `.cc-token-gauge` block and all its children**

Remove these rules entirely (find by selector):
- `.cc-token-gauge`
- `.cc-token-gauge:hover`
- `.cc-token-gauge.cc-token-active`
- `.cc-token-icon`
- `.cc-token-gauge.cc-token-active .cc-token-icon`
- `@keyframes cc-token-pulse`
- `.cc-token-in`
- `.cc-token-sep`
- `.cc-token-out`
- `.cc-token-gauge.cc-token-active .cc-token-in, .cc-token-gauge.cc-token-active .cc-token-out`
- `.cc-token-reset`
- `.cc-token-reset svg`
- `.cc-token-reset:hover`
- `.cc-token-reset:active`

- [ ] **Step 3: Remove `.cc-compose-bottombar` rule**

Find and remove the `.cc-compose-bottombar` rule block (the "aluminum lower trim" section, approximately lines 947–955).

---

## Task 5: Update CSS — add new rules

**Files:**
- Modify: `src/renderer/command/command.css`

Add the new CSS rules for the model chip, slim top bar, and unified compose box.

- [ ] **Step 1: Replace `.cc-compose-topbar` with a slim version**

Find the `.cc-compose-topbar` rule (now emptied in Task 4) and replace its content with:

```css
/* ─── Top Bar — slim model chip + history ────────────────────────────── */

.cc-compose-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  flex-shrink: 0;
}
```

- [ ] **Step 2: Add `.cc-model-chip` rules after `.cc-compose-topbar`**

Insert after the `.cc-compose-topbar` rule:

```css
/* ─── Model Chip ─────────────────────────────────────────────────────── */

.cc-model-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: #181818;
  border: 1px solid #252525;
  border-radius: 5px;
  padding: 3px 8px;
  color: #888;
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 500;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  cursor: pointer;
  transition: border-color 140ms, background 140ms, color 140ms;
  -webkit-app-region: no-drag;
}

.cc-model-chip:hover {
  border-color: #333;
  background: #1e1e1e;
  color: #aaa;
}

.cc-model-chip:active {
  transform: scale(0.97);
}

.cc-model-chip-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #555;
  flex-shrink: 0;
  transition: background 200ms;
}

.cc-model-chip.cc-model-chip-explicit .cc-model-chip-dot {
  background: #d4a017;
}

.cc-model-chip.cc-model-chip-explicit .cc-model-chip-label {
  color: #d4a017;
}

.cc-model-chip-label {
  color: inherit;
  transition: color 200ms;
}

.cc-model-chip-chevron {
  width: 8px;
  height: 8px;
  color: #444;
  flex-shrink: 0;
}
```

- [ ] **Step 3: Update `.cc-history-btn` to remove text label styles**

Find `.cc-history-btn` and replace its rule with a leaner icon-only version:

```css
/* ─── History Button — icon only ────────────────────────────────────── */

.cc-history-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  background: none;
  border: none;
  border-radius: 5px;
  color: #555;
  cursor: pointer;
  transition: color 140ms, background 140ms;
  -webkit-app-region: no-drag;
  flex-shrink: 0;
  padding: 0;
}

.cc-history-btn:hover {
  color: #999;
  background: rgba(255, 255, 255, 0.04);
}

.cc-history-btn:active {
  color: #ccc;
  transform: scale(0.94);
}

.cc-history-btn svg {
  width: 14px;
  height: 14px;
}
```

Also remove the `.cc-history-icon` rule that follows (it was only used for the icon inside the old labeled button; the new button styles the SVG directly).

- [ ] **Step 4: Add `.cc-compose-box` and `.cc-compose-innerbar` rules**

Insert after `.cc-compose-shell:focus-within` (which is around line 537 in the original):

```css
/* ─── Compose Box — unified textarea container ───────────────────────── */

.cc-compose-box {
  background: #0f0f0f;
  border: 1px solid #222;
  border-radius: 7px;
  overflow: hidden;
  transition: border-color 200ms;
}

.cc-compose-box:focus-within {
  border-color: #2e2e2e;
}

/* ─── Compose Inner Bar — attach + send inside the box ──────────────── */

.cc-compose-innerbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 8px;
  border-top: 1px solid #181818;
  background: rgba(0, 0, 0, 0.15);
  flex-shrink: 0;
}
```

- [ ] **Step 5: Strip border/background from `.cc-input`**

Find the `.cc-input` rule block. Remove the `border`, `background`, and `border-radius` properties from it (those are now provided by `.cc-compose-box`). Leave `padding`, `font-*`, `color`, `resize`, `outline`, `min-height`, and any other properties intact.

The `.cc-input` rule should NOT have:
- `border: ...`
- `background: ...`
- `border-radius: ...`

(These three are removed; the box provides them.)

- [ ] **Step 6: Commit CSS changes**

```bash
git add src/renderer/command/command.css
git commit -m "refactor(command): update CSS — model chip, unified compose box, remove old token gauge and toggle rules"
```

---

## Task 6: Update TypeScript — rewire DOM references

**Files:**
- Modify: `src/renderer/command/command.ts:39-55`

Replace the old DOM bindings with the new element IDs.

- [ ] **Step 1: Update the DOM reference section**

Find this block in `command.ts` (lines 39–55):
```typescript
const modelToggleGroup = document.getElementById('modelToggleGroup') as HTMLDivElement;

// ...

// Token usage (split labels)
const tokenGauge = document.getElementById('tokenGauge') as HTMLDivElement;
const tokenInLabel = document.getElementById('tokenInLabel')!;
const tokenOutLabel = document.getElementById('tokenOutLabel')!;
const tokenResetBtn = document.getElementById('tokenResetBtn')!;
```

Replace those four token-gauge lines and the `modelToggleGroup` line with:
```typescript
const modelChip = document.getElementById('modelChip') as HTMLButtonElement;
const modelChipLabel = document.getElementById('modelChipLabel') as HTMLSpanElement;

// Token usage — displayed in status bar
const tokenStatusLabel = document.getElementById('tokenStatusLabel')!;
```

Also remove `modelToggleGpt54Btn` and `modelToggleHaikuBtn` references if they appear as separate const declarations (search the file — they may only appear inside `syncModelToggleState`).

- [ ] **Step 2: Rewrite `syncModelToggleState`**

Find `function syncModelToggleState` (around line 158). Replace the entire function body with a version that drives `modelChip` instead of button iteration:

```typescript
function syncModelToggleState(state: any = (window as any).__lastState): void {
  const isExplicit = selectedOwner !== 'auto';
  modelChip.classList.toggle('cc-model-chip-explicit', isExplicit);
  modelChipLabel.textContent = OWNER_LABELS[selectedOwner].toUpperCase();

  // Disable chip while a task is running (except for the selected owner)
  modelChip.disabled = Boolean(runningTaskId);

  if (isExplicit) {
    const runtime = getProviderRuntime(state, selectedOwner as ExplicitSelectableOwner);
    const status = runtime?.status || 'unavailable';
    const details = [OWNER_LABELS[selectedOwner], runtime?.model || status, runtime?.errorDetail || '']
      .filter(Boolean);
    modelChip.title = details.join(' • ');
  } else {
    modelChip.title = 'Select model (auto)';
  }
}
```

- [ ] **Step 3: Rewrite `initializeModelToggle`**

Find `function initializeModelToggle` (around line 179). Replace it with:

```typescript
function initializeModelToggle(): void {
  selectedOwner = getStoredSelectedOwner();

  modelChip.addEventListener('click', () => {
    // Cycle: auto → PRIMARY_PROVIDER_ID → HAIKU_PROVIDER_ID → auto
    const state = (window as any).__lastState;
    const cycle: SelectableOwner[] = ['auto', PRIMARY_PROVIDER_ID, HAIKU_PROVIDER_ID];
    const currentIdx = cycle.indexOf(selectedOwner);
    const nextOwner = cycle[(currentIdx + 1) % cycle.length];
    setSelectedOwner(nextOwner, state);
  });

  syncModelToggleState();
}
```

- [ ] **Step 4: Rewrite `updateTokenUsageDisplay`**

Find `function updateTokenUsageDisplay` (around line 930). Replace the function body:

```typescript
function updateTokenUsageDisplay(state: any): void {
  const usage = state?.tokenUsage;
  if (!usage) return;
  tokenStatusLabel.textContent = `${formatTokenCount(usage.inputTokens)} in / ${formatTokenCount(usage.outputTokens)} out`;
}
```

- [ ] **Step 5: Remove `tokenResetBtn` event listener**

Find and delete this block (around line 937):
```typescript
tokenResetBtn.addEventListener('click', () => {
  const workspaceAPI = getWorkspaceAPI();
  if (workspaceAPI) {
    void workspaceAPI.resetTokenUsage();
  }
});
```

- [ ] **Step 6: Update `renderState` — remove `tokenGauge.classList` calls**

Find the two `tokenGauge.classList` calls in `renderState` and the `submitChat` function:

In `submitChat` (around line 744):
```typescript
  tokenGauge.classList.add('cc-token-active');
```
and in the `finally` block (around line 760):
```typescript
    tokenGauge.classList.remove('cc-token-active');
```

Delete both lines. The token gauge no longer exists.

- [ ] **Step 7: Update `renderState` — remove `modelToggleGroup` query in running-task guard**

Find this block in `renderState` (around line 998):
```typescript
  if (runningTaskId) {
    const buttons = modelToggleGroup.querySelectorAll<HTMLButtonElement>('.cc-model-toggle-btn');
    buttons.forEach((button) => {
      if (selectedOwner !== 'auto' && button.dataset.owner === selectedOwner) return;
      button.disabled = true;
    });
  } else {
    syncModelToggleState(state);
  }
```

Replace with:
```typescript
  syncModelToggleState(state);
```

(The `syncModelToggleState` rewrite in Step 2 already handles disabling the chip during a run via `modelChip.disabled = Boolean(runningTaskId)`.)

- [ ] **Step 8: Build and check for TypeScript errors**

```bash
cd /home/dp/Desktop/v2workspace && npm run build 2>&1 | head -60
```

Expected: no errors referencing `modelToggleGroup`, `tokenGauge`, `tokenInLabel`, `tokenOutLabel`, `tokenResetBtn`.

If errors appear: read the error line, find the remaining stale reference in `command.ts`, and fix it.

- [ ] **Step 9: Commit TS changes**

```bash
git add src/renderer/command/command.ts
git commit -m "refactor(command): rewire TS DOM refs — model chip cycle, token to status bar, remove gauge"
```

---

## Task 7: Visual verification

Start the app and visually confirm all success criteria.

- [ ] **Step 1: Start the app**

```bash
cd /home/dp/Desktop/v2workspace && npm start 2>&1 &
```

Wait ~5 seconds for the window to open.

- [ ] **Step 2: Check the input footer layout**

Visually confirm:
- Top bar: single chip showing "AUTO" (or active model name in amber when selected), history list-icon on the right
- Clicking the chip cycles: AUTO → GPT-5.4 → HAIKU → AUTO — chip label and dot color update
- History icon opens the history popup
- Unified box below the top bar with textarea and inner bottom bar
- Doc + Image buttons (with labels) in inner bar bottom-left
- Send button bottom-right

- [ ] **Step 3: Check token display**

Confirm `tokenStatusLabel` in the status bar shows `0 in / 0 out` initially.

Send a message and confirm the count updates after the response completes.

- [ ] **Step 4: Check stop button**

While a response is streaming, confirm the STOP button appears inside the compose box (bottom-right, next to Send).

- [ ] **Step 5: Check attach flow**

Click Doc — confirm file picker opens, attach a file, confirm preview appears.
Click Image — confirm file picker opens, attach an image, confirm preview appears.

- [ ] **Step 6: Final commit if any visual fixes were needed**

If any CSS adjustments were made during verification:
```bash
git add src/renderer/command/command.css
git commit -m "fix(command): visual polish from input area redesign verification"
```
