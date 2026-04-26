---
name: browser-operation
description: Use when the task requires fast, accurate browser work — navigation, research, inspection, tab management, and reliable form interaction.
allowed-tools:
  - browser.navigate
  - browser.open_tab
  - browser.create_tab
  - browser.activate_tab
  - browser.close_tab
  - browser.research_search
  - browser.record_finding
  - browser.get_element_state
  - browser.select_option
  - browser.upload_file
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
  - browser.evaluate_js
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

Use this skill when a task requires fast browser execution with high confidence and minimal tool churn.

## Workflow

1. Immediatley navigate to first search url. Assume the browser is always ready.
2. If the task is web research or asks for current online information, call `browser.research_search` first. Stop when enough live evidence is found. Do not answer from model memory.
   - **Query hygiene.** Use plain English. Do not prepend `site:`, `inurl:`, `intitle:`, `intext:`, `filetype:`, `ext:`, `before:`, `after:`, `cache:`, `related:`, `link:`, `define:`, `allinurl:`, `allintitle:`, or `allintext:` unless the user explicitly asked for one. The tool queries Google, DuckDuckGo, and Bing in parallel and quality-scores every candidate; operator-heavy queries distort the candidate pool and make the agent visibly bot-like. If you truly need an operator-scoped query, pass `preserveOperators: true` and justify it.
3. For a new tab, prefer `browser.open_tab` with `reuseExisting: true` - run these two in parralell if possible - unless the task explicitly requires a brand-new tab.
4. Inspect once before acting. Prefer `browser.inspect_page` for page shape and `browser.find_element` for target resolution.
5. Use the most specific tool available for the control:
   `browser.select_option` for native selects.
   `browser.upload_file` for file inputs.
   `browser.drag` for drag/drop.
   `browser.hover` for hover-dependent UI.
6. For multi-step UI flows, prefer `browser.run_intent_program` over chaining many small actions.
7. Verify immediately after each meaningful action with `browser.get_element_state`, `browser.wait_for`, page extraction, or observed page text.
8. Persist durable findings with `browser.record_finding` when they will matter in later turns.
9. Use `browser.evaluate_js` only as an escape hatch when no first-class tool fits the control or DOM shape.

## Rules

- This skill governs browser procedure only. It does not decide plan-vs-execute or whether a task should become browser work in the first place.
- Use live browser evidence, not remembered page content.
- Prefer `browser.record_finding` for durable takeaways instead of repeating the same extraction later.
- Optimize for fewer tool turns. Avoid inspect -> find -> inspect again loops unless the page changed.
- Do not default to low-level `click` or `type`. If a first-class tool exists for the control, use it.
- Treat verification as mandatory for form interaction and submission.
- Use `browser.evaluate_js` only when the DOM/control cannot be handled by a first-class tool, and say why.

## Preferred Tools

- `browser.navigate`
- `browser.open_tab` (deterministic; supports `reuseExisting` for idempotent opens and an opt-in `deterministic` field — see below)
- `browser.create_tab`
- `browser.activate_tab`
- `browser.research_search`
- `browser.record_finding`
- `browser.inspect_page`
- `browser.find_element`
- `browser.get_element_state`
- `browser.select_option`
- `browser.upload_file`
- `browser.run_intent_program`
- `browser.wait_for`
- `browser.extract_page`
- `browser.summarize_page`
- `browser.drag`
- `browser.hover`
- `browser.get_console_events`
- `browser.get_network_events`
- `browser.evaluate_js` as last resort

## Fast Paths

- Single-page read: `browser.inspect_page` or `browser.extract_page`, then answer.
- Research: `browser.research_search`, then `browser.record_finding` when evidence is sufficient.
- Native form: `browser.inspect_page` -> `browser.find_element` if needed -> control-specific tool -> `browser.get_element_state` or `browser.wait_for`.
- Multi-step flow: one `browser.run_intent_program` with explicit assertions is usually better than many independent actions.

## Control Policy

- Native `<select>`: use `browser.select_option`.
- `input[type="file"]`: use `browser.upload_file`.
- Range/color/custom widgets: inspect first. If there is no dedicated tool and the widget is not expressible via intent instructions, use `browser.evaluate_js` narrowly and verify the resulting state.
- Use `browser.drag` and `browser.hover` only when the page behavior actually depends on them.

## Deterministic mode for `browser.open_tab`

`browser.open_tab` accepts an optional `deterministic` field. Pass `true` for default pinning (seed=1, clock frozen, viewport 1280×800, locale en-US, timezone UTC, animations off, `prefers-reduced-motion: reduce`) or a config object to override specific pins:

```json
{ "url": "https://example.com/", "deterministic": { "seed": 42, "userAgent": "goldenboy/1.0", "blockNetworkPatterns": ["https://www.google-analytics.com/*"] } }
```

Supported config fields: `seed`, `clock` (`'frozen'` or a numeric epoch ms), `viewport` (`{ width, height, deviceScaleFactor? }`), `locale`, `timezone`, `userAgent`, `disableAnimations`, `reduceMotion`, `blockNetworkPatterns` (glob-style, session-scoped in v1).

Use this whenever the next steps depend on stable clocks, seeded randomness, pinned viewport, or blocked analytics — particularly for non-reasoning tasks where reproducibility matters more than realism. Omit the field for normal, live-web behavior.
