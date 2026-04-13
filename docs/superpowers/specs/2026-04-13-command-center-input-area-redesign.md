# Command Center Input Area Redesign

**Date:** 2026-04-13  
**Scope:** `src/renderer/command/` — input footer UI only (HTML + CSS)  
**Goal:** Simplify and consolidate the input area into a compact, enterprise-grade layout with fewer visual layers.

---

## Problem

The current input footer has three distinct horizontal zones (top bar, textarea, bottom bar) plus a dual toggle for model selection and a token gauge that competes for attention. The result is visually noisy for what is ultimately a simple chat input.

---

## Design

### Structure

Two zones, not three:

1. **Slim top bar** — model selector (left) + history icon (right)
2. **Unified input box** — single bordered container holding the textarea, attach buttons, and send button

### Top Bar

- **Model selector chip** (left): Single `<button>` showing the active model name with an amber indicator dot and a chevron-down icon. Clicking opens the existing model-switch dropdown. Replaces the current dual-toggle (`GPT-5.4` / `HAIKU` buttons).
- **History button** (right): Icon-only — the existing three-lines SVG. No text label. `title="Chat history"` for tooltip. Replaces current icon + "HISTORY" text button.
- Token gauge: **removed from this area**. Token counts (`inputTokens`, `outputTokens`) move to the existing status bar at the bottom of the window (`cc-status`), rendered as a new `<span>` alongside the existing status labels. The reset button is dropped — token counts in the status bar are display-only.

### Unified Input Box

One `div.cc-compose-box` with `border: 1px solid` and `border-radius: 7px`, containing:

- **Textarea** (`cc-input`) — top portion, no border of its own
- **Inner bottom bar** — `border-top: 1px solid` inside the box, flex row:
  - Left: Doc button (icon + "Doc" label) and Image button (icon + "Image" label) — same icons as current, same file-input wiring
  - Right: Send button (up-arrow icon), Stop button (hidden by default, shown during agent run)

### Visual Style

Stays within the existing dark palette:

| Element | Value |
|---|---|
| Box background | `#0f0f0f` |
| Box border | `1px solid #222` |
| Inner bar background | `rgba(0,0,0,0.15)` |
| Inner bar border-top | `1px solid #181818` |
| Active model dot | `#d4a017` (amber) |
| Active model text | `#d4a017` |
| History / attach icons | `#555`, hover `#888` |
| Chip background | `#181818`, border `#252525` |

---

## Affected Files

| File | Change |
|---|---|
| `src/renderer/command/index.html` | Restructure input footer markup: replace dual-toggle with single model chip, remove token gauge from compose shell, add token span to status bar, collapse bottom bar into unified box |
| `src/renderer/command/command.css` | Remove `.cc-model-toggle` / `.cc-model-toggle-btn` rules; add `.cc-model-chip` rule; update `.cc-compose-shell`, `.cc-compose-topbar`, `.cc-compose-bottombar`; add `.cc-compose-box` unified container; move token display styles to status bar context |
| `src/renderer/command/command.ts` | Update DOM references: `modelToggleGroup`, `modelToggleGpt54Btn`, `modelToggleHaikuBtn` → `modelChip` (single element); update token rendering to write to new status bar span; keep all existing logic intact |

---

## Out of Scope

- History popup contents (unchanged)
- Chat message rendering
- Status bar layout beyond adding the token span
- Model dropdown implementation (exists, just re-triggered from chip)
- Any changes to the logs panel or header

---

## Success Criteria

- Input footer renders in two visual zones (top bar + unified box)
- Active model name shown in single chip; switching still works
- Token counts appear in the status bar
- History opens on icon click with tooltip
- Doc and Image attach still work with labeled buttons inside the box
- Stop button still appears/hides correctly during agent runs
- No regressions in existing chat, history, or model-switching behavior
