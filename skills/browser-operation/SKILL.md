---
name: browser-operation
description: Use when the task requires browser work — navigation, web search/research, page inspection, clicking, typing, tab management, or page extraction.
allowed-tools:
  - browser.navigate
  - browser.open_tab
  - browser.create_tab
  - browser.activate_tab
  - browser.close_tab
  - browser.research_search
  - browser.record_finding
  - browser.click
  - browser.type
  - browser.drag
  - browser.hover
  - browser.get_console_events
  - browser.get_network_events
  - browser.run_intent_program
  - browser.extract_page
  - browser.inspect_page
  - browser.find_element
  - browser.summarize_page
  - browser.wait_for
references:
  - src/main/browser/BrowserService.ts
  - src/main/browser/BrowserPageAnalysis.ts
  - src/main/browser/BrowserPerception.ts
  - src/main/actions/browserActionExecutor.ts
  - src/shared/types/browser.ts
  - src/shared/types/browserIntelligence.ts
  - src/renderer/execution/execution.ts
---

# Browser Operation

Use this skill when a task requires navigation, web search, page inspection, clicking, typing, tab management, or page extraction.

## Workflow

1. Read current browser state.
2. If the user asks to search, look up, find online, research, or get current web information, call `browser.research_search` with the user query first. Let it open/cache one result at a time and stop when enough evidence is found. Do not answer from model memory.
3. Identify the active tab and URL.
4. When the user asks for a new or separate tab, prefer `browser.open_tab` — it is the deterministic tab opener that verifies the new tab exists and is active before returning. Pass `reuseExisting: true` when you only need *a* tab at that URL (re-runs, idempotent flows, "open docs" style tasks) so you do not pile up duplicates. Fall back to `browser.create_tab` only when you explicitly need a brand-new tab regardless of what is already open.
5. For page understanding, extract with `browser.extract_page` / `browser.summarize_page` on the live tab and persist durable takeaways with `browser.record_finding`.
6. Use page extraction or actionable element inspection before clicking.
7. Prefer semantic or ranked actions when available.
8. Record navigation and important page findings.
9. Return concise page evidence, not full raw page dumps.

## Rules

- This skill governs browser procedure only. It does not decide plan-vs-execute or whether a task should become browser work in the first place.
- Use live browser evidence, not remembered page content.
- Prefer `browser.record_finding` for durable takeaways instead of repeating the same extraction later.

## Preferred Tools

- `browser.navigate`
- `browser.open_tab` (deterministic; supports `reuseExisting` for idempotent opens and an opt-in `deterministic` field — see below)
- `browser.create_tab`
- `browser.activate_tab`
- `browser.research_search`
- `browser.record_finding`
- `browser.click`
- `browser.type`
- `browser.drag`
- `browser.hover`
- `browser.get_console_events`
- `browser.get_network_events`
- `browser.run_intent_program`
- `browser.extract_page`
- `browser.inspect_page`
- `browser.find_element`
- `browser.summarize_page`
- `browser.wait_for`

## Deterministic mode for `browser.open_tab`

`browser.open_tab` accepts an optional `deterministic` field. Pass `true` for default pinning (seed=1, clock frozen, viewport 1280×800, locale en-US, timezone UTC, animations off, `prefers-reduced-motion: reduce`) or a config object to override specific pins:

```json
{ "url": "https://example.com/", "deterministic": { "seed": 42, "userAgent": "goldenboy/1.0", "blockNetworkPatterns": ["https://www.google-analytics.com/*"] } }
```

Supported config fields: `seed`, `clock` (`'frozen'` or a numeric epoch ms), `viewport` (`{ width, height, deviceScaleFactor? }`), `locale`, `timezone`, `userAgent`, `disableAnimations`, `reduceMotion`, `blockNetworkPatterns` (glob-style, session-scoped in v1).

Use this whenever the next steps depend on stable clocks, seeded randomness, pinned viewport, or blocked analytics — particularly for non-reasoning tasks where reproducibility matters more than realism. Omit the field for normal, live-web behavior.
