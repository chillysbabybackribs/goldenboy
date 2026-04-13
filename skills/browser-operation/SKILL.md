# Browser Operation

Use this skill when a task requires navigation, web search, page inspection, clicking, typing, tab management, or page extraction.

## Relevant Files

- `src/main/browser/BrowserService.ts`
- `src/main/browser/BrowserPageAnalysis.ts`
- `src/main/browser/BrowserPerception.ts`
- `src/main/actions/browserActionExecutor.ts`
- `src/shared/types/browser.ts`
- `src/shared/types/browserIntelligence.ts`
- `src/renderer/execution/execution.ts`

## Workflow

1. Read current browser state.
2. If the user asks to search, look up, find online, research, or get current web information, call `browser.research_search` with the user query first. Let it open/cache one result at a time and stop when enough evidence is found. Do not answer from model memory.
3. Identify the active tab and URL.
4. When the user asks for a new or separate tab, use `browser.create_tab` rather than reusing `browser.navigate` on the active tab.
5. For page understanding, search cached chunks before requesting broad page text.
6. Use page extraction or actionable element inspection before clicking.
7. Prefer semantic or ranked actions when available.
8. Record navigation and important page findings.
9. Return concise page evidence, not full raw page dumps.

## Preferred Tools

- `browser.get_state`
- `browser.get_tabs`
- `browser.navigate`
- `browser.create_tab`
- `browser.activate_tab`
- `browser.search_web`
- `browser.research_search`
- `browser.cache_current_page`
- `browser.answer_from_cache`
- `browser.search_page_cache`
- `browser.read_cached_chunk`
- `browser.list_cached_sections`
- `browser.click`
- `browser.type`
- `browser.drag`
- `browser.hover`
- `browser.hit_test`
- `browser.get_console_events`
- `browser.get_network_events`
- `browser.get_dialogs`
- `browser.accept_dialog`
- `browser.dismiss_dialog`
- `browser.run_intent_program`
- `browser.extract_page`
- `browser.get_actionable_elements`
- `browser.capture_snapshot`
