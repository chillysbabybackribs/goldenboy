# Chat UI Audit: Message Layout & Auto-Scroll Behavior

## Executive Summary

The chat UI currently has a **structural ordering issue** where the live processing panel (thoughts + tool calls) is rendered **above** the final model response text, not below it. Combined with the auto-scroll logic, this creates a visual flow problem where tool execution details appear above the descriptive text they relate to.

---

## Current DOM Structure & Rendering Order

### **Live Message Card Architecture** (`src/renderer/command/live-run.ts:69-87`)

```typescript
root.innerHTML =
  promptHtml +
  `<div class="chat-live-panel chat-live-panel-empty">` +
    `<div class="chat-stream"></div>` +
  `</div>` +
  `<div class="chat-msg-text chat-markdown"></div>`;
```

**Current order in the DOM:**
1. `chat-live-prompt` (task/user prompt, if provided)
2. `chat-live-divider` (visual separator)
3. **`chat-live-panel`** ← Contains thoughts + tool execution lines
   - `.chat-stream` → renders thoughts (`.chat-thought-line`) and tool calls (`.chat-tool-line`)
4. **`chat-msg-text`** ← Final model response text (streamed output)

### **Problem: Visual Flow Inversion**

- **Tool calls and processing details appear first** (in `chat-live-panel` / `chat-stream`)
- **Model's descriptive response appears after** (in `chat-msg-text`)
- This is backwards from user expectation: description → tool calls → results

---

## Rendering Pipeline: How Content Gets Added

### 1. **Thoughts/Process Lines** → `chat-stream`
*File: `src/renderer/command/live-run.ts:315-330`*

```typescript
export function appendThought(taskId: string, text: string): void {
  // Filtered thinking lines go into stream...
  card.output.innerHTML = escapeHtml(next)  // Shows in live-status-text
  syncLivePanelScroll(card);
  card.callbacks.scheduleChatScrollToBottom(false, 1);
}
```

**Where it renders:**
- Quick internal thoughts → `card.output` (status text area)
- Deferred tool events → `card.stream` as `.chat-thought-line` or `.chat-tool-line`

### 2. **Tool Call Events** → `chat-stream`
*File: `src/renderer/command/live-run.ts:355-375`*

```typescript
function renderToolLine(card: LiveRunCard, taskId: string, kind: 'start' | 'done', text: string): void {
  const el = document.createElement('div');
  el.className = 'chat-tool-line chat-tool-active';  // Active tool gets shimmer
  card.stream.appendChild(el);  // Appended to stream in order
  syncLiveProcessDisclosure(card);
  syncLivePanelScroll(card);
  card.callbacks.scheduleChatScrollToBottom(false, 1);
}
```

**Behavior:**
- Tool **start** events: create `.chat-tool-active` with shimmer animation
- Tool **done** events: switch to `.chat-tool-done` (no shimmer)
- All tool lines remain in `chat-stream` in chronological order

### 3. **Model Response Text** → `chat-msg-text`
*File: `src/renderer/command/live-run.ts:141-156`*

```typescript
export function appendToken(taskId: string, text: string): void {
  card.tokenBuffer += text;
  card.output.className = 'chat-msg-text chat-markdown chat-msg-streaming';
  card.output.innerHTML = card.callbacks.renderMarkdown(card.tokenBuffer);  // Streaming into separate element
  card.callbacks.scheduleChatScrollToBottom(force?, frames?);
}
```

**Behavior:**
- Tokens stream into `card.output` (.chat-msg-text)
- Rendered **after** the process panel in DOM order
- **Layout Lock:** When output starts, card layout locks and process panel position is fixed

---

## CSS Layout: Stacking & Visibility

### **Live Panel Styling** (`src/renderer/command/command.css:613-649`)

```css
.chat-live-panel {
  height: min(280px, 38vh);
  max-height: min(280px, 38vh);
  overflow-y: auto;
  padding: 2px 0 0;
  transition: opacity 180ms, max-height 180ms, ...;
}

.chat-live-panel.chat-live-panel-empty {
  height: 0;
  max-height: 0;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
}

.chat-msg-live-has-output .chat-live-panel {
  opacity: 0.72;  /* Dims when output appears */
}
```

**Key facts:**
- Panel starts **hidden** (0 height, opacity 0)
- When tool activity detected → panel expands to 280px / 38vh max
- When text output starts → panel **dims to 72% opacity** and **stays visible above output**
- No `flex-direction: column-reverse` or `order` property to reorder visually

### **Message Text Styling** (`src/renderer/command/command.css:575-591`)

```css
.chat-msg-text {
  color: #9DA7B3;
  font-family: var(--font-reading);
  font-size: calc(15px * var(--cc-chat-zoom));
  line-height: 1.75;
}

.chat-msg-live .chat-msg-text:not(:empty) {
  margin-top: 12px;
  opacity: 1;
  transform: translateY(0);
}
```

**Key facts:**
- Regular margin/padding; no special positioning
- When output content arrives, margin-top: 12px adds spacing from panel above
- Responsive `transform: translateY(0)` for animation

---

## Auto-Scroll Logic: Current Implementation

### **Scroll Management** (`src/renderer/command/command.ts:321-480`)

```typescript
function isChatNearBottom(threshold = 56): boolean {
  const distanceFromBottom = chatThread.scrollHeight - (chatThread.scrollTop + chatThread.clientHeight);
  return distanceFromBottom <= threshold;
}

function scheduleChatScrollToBottom(force = false, frames = 3): void {
  if (!force && !chatAutoPinned) return;  // Only scroll if pinned OR forced
  if (force) chatAutoPinned = true;
  chatScrollFramesRemaining = Math.max(chatScrollFramesRemaining, frames);
  if (chatScrollRaf !== null) return;
  
  const tick = () => {
    performChatScrollToBottom();
    chatScrollFramesRemaining -= 1;
    if (chatScrollFramesRemaining > 0) {
      chatScrollRaf = window.requestAnimationFrame(tick);
      return;
    }
    chatScrollRaf = null;
  };
  
  chatScrollRaf = window.requestAnimationFrame(tick);
}
```

**Behavior:**
- **Auto-pinning:** User near bottom → `chatAutoPinned = true`
- **RAF loop:** Multiple `requestAnimationFrame` ticks (default 3) to ensure scroll happens after DOM updates
- **Deferred scrolling:** Waits for layout/paint before scrolling to bottom
- **Interrupt on scroll up:** User wheel up with `deltaY < 0` → unpins auto-scroll

### **Mutation Observer for Content Changes** (`src/renderer/command/command.ts:458-483`)

```typescript
const chatMutationObserver = new MutationObserver(() => {
  if (chatEmptyState.parentNode) return;
  scheduleChatScrollToBottom(false, 1);  // Single frame scroll on mutation
});
chatMutationObserver.observe(chatInner, {
  childList: true,
});
```

**Behavior:**
- Observes `chatInner` for any child DOM changes
- When thoughts/tools/output added → schedules scroll with 1 frame (minimal delay)
- Respects `chatAutoPinned` state

### **Scroll Control UI** (`src/renderer/command/command.ts:360-395`)

```typescript
function updateChatScrollControls(): void {
  const hasOverflow = maxScrollTop > 8;
  if (!hasOverflow || !chatScrollControlsActivated) {
    chatScrollTopBtn.hidden = true;
    chatScrollBottomBtn.hidden = true;
    return;
  }
  
  const nearTop = isChatNearTop();
  const nearBottom = isChatNearBottom();
  
  if (nearTop) {
    chatScrollTopBtn.hidden = true;
    chatScrollBottomBtn.hidden = false;
  } else if (nearBottom) {
    chatScrollTopBtn.hidden = false;
    chatScrollBottomBtn.hidden = true;
  } else {
    // In middle: show both buttons
    const inUpperHalf = chatThread.scrollTop < scrollMidpoint;
    chatScrollTopBtn.hidden = inUpperHalf;
    chatScrollBottomBtn.hidden = !inUpperHalf;
  }
}
```

**Behavior:**
- Buttons hidden unless content exceeds 8px scroll height
- Context-aware: shows "scroll down" near top, "scroll up" near bottom
- Buttons auto-hide after 900ms idle (CSS class `cc-chat-scroll-idle`)

---

## Issues Identified

### **Issue #1: DOM Order Inversion** ⚠️ **CRITICAL**

| Element | Order | Visibility |
|---------|-------|------------|
| `chat-live-panel` (thoughts + tools) | 2nd | Shows first during run |
| `chat-msg-text` (final response) | 3rd | Shows after panel |

**Impact:**
- User sees tool execution before reading why tools are needed
- Breaks narrative flow: context → action → results (becomes action → context → results)

### **Issue #2: Panel Opacity During Output** ⚠️ **UX PROBLEM**

```css
.chat-msg-live-has-output .chat-live-panel {
  opacity: 0.72;  /* Dims to 72% */
}
```

**Impact:**
- Panel doesn't fully disappear or collapse when output starts
- Creates visual clutter: dimmed tools hovering above new content
- User doesn't know if panel will collapse or expand

### **Issue #3: Scroll Doesn't Account for Panel State** ⚠️ **MINOR**

The auto-scroll triggers on every mutation (thoughts, tools, output) but doesn't change strategy when:
- Panel transitions from empty → visible (expands height)
- Panel collapses when output starts
- User is intentionally reading tool details (panel visible) and scroll still forces bottom

**Code Location:** `src/renderer/command/command.ts:458-483`

### **Issue #4: No Visual Feedback for Panel Collapse** ⚠️ **UX PROBLEM**

Panel collapses via CSS `details` element (file `src/renderer/command/live-run.ts:258-275`) but:
- No animation for collapse/expand
- No color change or highlight to show it's collapsible
- Clicking details element doesn't trigger scroll adjustment

---

## File Locations Summary

| File | Line(s) | Component |
|------|---------|-----------|
| `src/renderer/command/live-run.ts` | 60-100 | Card creation & DOM structure |
| `src/renderer/command/live-run.ts` | 315-330 | Thought appending |
| `src/renderer/command/live-run.ts` | 355-375 | Tool line rendering |
| `src/renderer/command/live-run.ts` | 141-156 | Token/output streaming |
| `src/renderer/command/command.css` | 575-691 | Live panel & output styling |
| `src/renderer/command/command.ts` | 321-480 | Auto-scroll implementation |
| `src/renderer/command/command.ts` | 458-483 | Mutation observer for scroll |

---

## Current Scroll Behavior Checklist

✅ Auto-scroll **active** when user near bottom
✅ Auto-scroll **disabled** when user scrolls up
✅ RAF frame batching prevents jank
✅ Scroll buttons context-aware (top/bottom/middle position)
✅ Scroll buttons auto-hide after 900ms idle
❌ Panel visibility changes **don't trigger layout recalc** for scroll target
❌ No preference for staying on **tool details vs output** when both visible

---

## Recommendations for Audit Findings

1. **Reorder DOM:** Move `chat-msg-text` before `chat-live-panel` (or use CSS `flex-direction: column-reverse`)
2. **Panel Collapse:** When output starts, fully hide or collapse panel (not just dim to 72%)
3. **Scroll Strategy:** Check panel state before scheduling scroll:
   - If panel is expanded/visible: consider staying in place
   - If panel collapsed: auto-scroll to show output
4. **Transition Animation:** Add CSS transition when panel collapses to signal change
5. **Focus Signal:** Highlight `.chat-msg-text` entry point (e.g., fade-in pulse)
