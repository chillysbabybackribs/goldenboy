# Sidebar Running/Completed Sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the agent sidebar into "Running" (backgrounded tasks) and "Completed" sections, hiding the active task from the sidebar entirely, and capping completed tasks at 3 with a "Show N more" toggle.

**Architecture:** All changes are confined to `command.ts` (`syncAgentTabs`) and `command.css`. The HTML gets two new section wrappers inside `#agentTabsList`. A module-level boolean tracks the "show more" expanded state and is reset whenever the task list changes shape (different task count or different set of IDs).

**Tech Stack:** Vanilla TypeScript, HTML, CSS — no new dependencies.

---

## File Map

- **Modify:** `src/renderer/command/command.ts` — rewrite `syncAgentTabs`, add `completedExpanded` state variable
- **Modify:** `src/renderer/command/command.css` — add section header styles (`.cc-agent-section-label`), "show more" button styles (`.cc-agent-show-more`)

---

### Task 1: Add CSS for section headers and "show more" button

**Files:**
- Modify: `src/renderer/command/command.css` (after the `.cc-agent-tab-new` block, around line 1048)

- [ ] **Step 1: Add section label and show-more styles**

Open `src/renderer/command/command.css`. After the `@keyframes cc-agent-btn-shimmer` block (around line 1048), insert:

```css
/* ─── Agent Sidebar Sections ──────────────────────────────────────────── */

.cc-agent-section-label {
  width: 100%;
  padding: 10px 4px 4px 4px;
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.cc-agent-section-label::before {
  content: '';
  display: block;
  width: 3px;
  height: 10px;
  border-radius: 2px;
  flex-shrink: 0;
}

.cc-agent-section-label-running {
  color: rgba(220, 185, 100, 0.75);
}

.cc-agent-section-label-running::before {
  background: rgba(220, 185, 100, 0.6);
}

.cc-agent-section-label-completed {
  color: rgba(130, 180, 140, 0.6);
  margin-top: 8px;
}

.cc-agent-section-label-completed::before {
  background: rgba(130, 180, 140, 0.45);
}

.cc-agent-show-more {
  width: 100%;
  padding: 8px 16px;
  background: transparent;
  border: 1px dashed rgba(255, 255, 255, 0.08);
  border-radius: 5px;
  color: rgba(255, 255, 255, 0.35);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.3px;
  cursor: pointer;
  text-align: left;
  transition: color 140ms, border-color 140ms;
  -webkit-app-region: no-drag;
  box-sizing: border-box;
  margin-top: 2px;
}

.cc-agent-show-more:hover {
  color: rgba(255, 255, 255, 0.55);
  border-color: rgba(255, 255, 255, 0.14);
}
```

- [ ] **Step 2: Build and verify no CSS errors**

```bash
npm run build 2>&1 | tail -20
```

Expected: build completes, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/command/command.css
git commit -m "feat: add sidebar section label and show-more button styles"
```

---

### Task 2: Rewrite `syncAgentTabs` with Running/Completed sections

**Files:**
- Modify: `src/renderer/command/command.ts` — add `completedExpanded` + `lastTaskListSignature`, rewrite `syncAgentTabs`

- [ ] **Step 1: Add module-level state variables**

In `src/renderer/command/command.ts`, find the existing module-level state block (around line 132, where `runningTaskIds` is declared). Add these two lines directly after it:

```typescript
let completedExpanded = false;
let lastTaskListSignature = '';
```

- [ ] **Step 2: Rewrite `syncAgentTabs`**

Find the existing `syncAgentTabs` function (starts around line 1483). Replace the entire function with:

```typescript
const COMPLETED_PREVIEW_COUNT = 3;

function syncAgentTabs(state: any): void {
  const tasks: any[] = state?.tasks ?? [];
  const activeId: string | null = state?.activeTaskId ?? null;

  // Running = status 'running' but NOT the active task (those are backgrounded)
  const runningTasks = tasks.filter(t => t.status === 'running' && t.id !== activeId);
  // Completed = done or failed, newest first
  const completedTasks = [...tasks]
    .filter(t => t.status === 'completed' || t.status === 'failed')
    .sort((a, b) => b.updatedAt - a.updatedAt);

  // Sidebar only appears when there are backgrounded running OR completed tasks
  if (runningTasks.length === 0 && completedTasks.length === 0) {
    agentTabs.hidden = true;
    return;
  }
  agentTabs.hidden = false;

  // Reset expansion state when list shape changes
  const signature = tasks.map(t => t.id + t.status).join(',');
  if (signature !== lastTaskListSignature) {
    lastTaskListSignature = signature;
    completedExpanded = false;
  }

  agentTabsList.innerHTML = '';

  // ── Running section ──────────────────────────────────────────────────
  if (runningTasks.length > 0) {
    const runningLabel = document.createElement('div');
    runningLabel.className = 'cc-agent-section-label cc-agent-section-label-running';
    runningLabel.textContent = 'Running';
    agentTabsList.appendChild(runningLabel);

    for (const task of runningTasks) {
      agentTabsList.appendChild(buildAgentTab(task, activeId));
    }
  }

  // ── Completed section ────────────────────────────────────────────────
  if (completedTasks.length > 0) {
    const completedLabel = document.createElement('div');
    completedLabel.className = 'cc-agent-section-label cc-agent-section-label-completed';
    completedLabel.textContent = 'Completed';
    agentTabsList.appendChild(completedLabel);

    const visibleCompleted = completedExpanded
      ? completedTasks
      : completedTasks.slice(0, COMPLETED_PREVIEW_COUNT);

    for (const task of visibleCompleted) {
      agentTabsList.appendChild(buildAgentTab(task, activeId));
    }

    const hiddenCount = completedTasks.length - COMPLETED_PREVIEW_COUNT;
    if (hiddenCount > 0) {
      const showMoreBtn = document.createElement('button');
      showMoreBtn.type = 'button';
      showMoreBtn.className = 'cc-agent-show-more';
      showMoreBtn.textContent = completedExpanded
        ? 'Show less'
        : `Show ${hiddenCount} more`;
      showMoreBtn.addEventListener('click', () => {
        completedExpanded = !completedExpanded;
        syncAgentTabs((window as any).__lastState);
      });
      agentTabsList.appendChild(showMoreBtn);
    }
  }
}

function buildAgentTab(task: any, activeId: string | null): HTMLButtonElement {
  const tab = document.createElement('button');
  tab.type = 'button';
  tab.className = 'cc-agent-tab' +
    (task.id === activeId ? ' cc-agent-tab-active' : '') +
    (task.status === 'running' ? ' cc-agent-tab-running' : '');

  const dot = document.createElement('span');
  dot.className = 'cc-agent-tab-dot';

  const title = document.createElement('span');
  title.className = 'cc-agent-tab-title';
  const label = task.title || task.id;
  title.textContent = label.length > 24 ? label.slice(0, 24) + '…' : label;
  title.title = task.title || task.id;

  tab.append(dot, title);

  if (task.id !== activeId) {
    tab.addEventListener('click', () => switchToTask(task.id));
  }

  return tab;
}
```

- [ ] **Step 3: Remove the old tab-building inline code**

The old `syncAgentTabs` had a `for (const task of sorted)` loop that built tabs inline. That code is now in `buildAgentTab`. Verify the old function body is fully replaced (there should be no second `for (const task of sorted)` loop referencing `tab.append(dot, title)` outside `buildAgentTab`).

```bash
grep -n "for (const task of sorted)" src/renderer/command/command.ts
```

Expected: no output (zero matches).

- [ ] **Step 4: Build and verify no TypeScript errors**

```bash
npm run build 2>&1 | tail -30
```

Expected: build completes with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/command/command.ts
git commit -m "feat: split agent sidebar into Running/Completed sections with show-more"
```

---

### Task 3: Manual smoke test

- [ ] **Step 1: Start the app**

```bash
npm run dev
```

- [ ] **Step 2: Verify single-task behavior**

Start one task. Verify the agent sidebar is hidden (no running/completed tasks are backgrounded yet — the active task is only in the chat area).

- [ ] **Step 3: Verify Running section appears**

While the first task is still running, click "+ New Agent" and start a second task. Verify:
- The sidebar appears
- A "Running" section label (amber tint) is visible
- The first task appears under it with a pulsing dot
- The new (active) task does NOT appear in the sidebar

- [ ] **Step 4: Verify Completed section and show-more**

Let/stop the first task so it completes. Verify it moves from "Running" to "Completed" (green-tint label). Create enough completed tasks (4+) to trigger the "Show N more" button. Click it — verify all tasks appear. Click "Show less" — verify collapse.

- [ ] **Step 5: Verify switching tasks**

Click a completed task in the sidebar. Verify the chat area switches to show that task's conversation.

- [ ] **Step 6: Commit if no issues found**

If smoke test passes with no regressions:

```bash
git add -p  # stage any fix-up changes only
git commit -m "fix: sidebar section smoke test fixes (if any)"
```

If no changes needed, skip this commit.
