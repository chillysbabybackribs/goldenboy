# Task Status Indicator — Design Spec

**Date:** 2026-04-13
**Status:** Approved

## Overview

A text-only animated status indicator shown in the command window chat area during agent runs. It sits between the chat thread and the input box, above the compose area, with no dividing border. It communicates what the agent is doing right now via short, friendly phrases that type in and snap off one at a time.

## Placement

- Rendered inside `.cc-input-footer` above the compose shell, or as a sibling element between `.cc-chat` and `.cc-input-footer` in the DOM.
- No border-top separating it from the chat area above.
- Left-aligned, matching the left edge of the compose shell (~48px from left or matching compose shell indent).
- Hidden (zero height, no layout impact) when no task is running.

## Animation — A2 style

Each phrase follows this lifecycle:

1. **Type in** — characters appear one at a time at ~38ms/char
2. **Hold** — full phrase visible for ~1.5s
3. **Snap off** — text clears instantly (no fade)
4. **Gap** — ~120ms empty before next phrase types in

When the run ends, the current phrase completes its hold, then snaps off and the element hides (no further phrases).

Font: `IBM Plex Mono` (matches app), size 11px, color `#4a4a4a`.

## Phrase Mapping

Runtime progress events are mapped to short friendly phrases before display. Raw event strings are never shown directly.

| Runtime event pattern | Display phrase |
|---|---|
| `Calling filesystem.read` / `read_file_chunk` | `reading files` |
| `filesystem.search` / `search_file_cache` | `searching files` |
| `filesystem.index_workspace` | `indexing workspace` |
| `filesystem.answer_from_cache` | `checking file cache` |
| `Calling browser.navigate` | `navigating` |
| `browser.search_page_cache` / `browser.read_cached_chunk` | `reading page cache` |
| `browser.research_search` / `browser.search_web` | `searching the web` |
| `browser.extract_page` | `reading page` |
| `terminal.exec` | `running command` |
| `subagent.spawn` | `spawning agent` |
| `subagent.wait` | `waiting for agent` |
| Thought / reasoning text | `thinking` |
| Tool result events | _(skip — don't display result events)_ |
| Unknown / unmapped | _(skip — show nothing rather than raw text)_ |

Consecutive identical phrases are deduplicated — if the same phrase would show twice in a row, skip and wait for the next distinct one.

## Visibility Lifecycle

- **Hidden** (display none / zero height) when `runningTaskId` is null.
- **Shown** as soon as a task starts (`runningTaskId` is set), before the first phrase arrives.
- On task completion: current phrase finishes its hold (~1.5s), then snaps off and the element hides.
- On task error: same as completion — hold then hide.
- STOP button cancels the run; status bar hides immediately on cancel.

## Implementation Scope

- New element in `src/renderer/command/index.html` — a `<div id="taskStatusBar">` placed between `#chatThread` and `.cc-input-footer`.
- CSS in `src/renderer/command/command.css` — sizing, font, color, no border-top.
- JS in `src/renderer/command/command.ts` — typewriter engine, phrase mapper, lifecycle tied to `runningTaskId`.
- No new IPC, no new main-process code. Driven entirely by the existing progress events already received in the renderer (`progress.type === 'status'`).

## Out of Scope

- No icons, dots, spinners, or non-text elements.
- No shimmer/gradient CSS animation — JS typewriter only.
- No per-tool color coding.
- No history of past phrases (one phrase at a time, no queue shown).
