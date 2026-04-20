# Agent Tool Names

Canonical inventory for the stable dotted tool names exposed to agents.

Update this file when adding, removing, or renaming agent-facing tools. Keep names stable even if implementation files move. The authoritative live list is also available at runtime via the tool catalog chunks in `~/.config/v2-workspace/tool-catalog/`.

## Attachments

- `attachments.list`
- `attachments.read_chunk`
- `attachments.read_document`
- `attachments.search`
- `attachments.stats`

## Browser

- `browser.accept_dialog`
- `browser.activate_tab`
- `browser.answer_from_cache`
- `browser.back`
- `browser.cache_current_page`
- `browser.cache_stats`
- `browser.capture_snapshot`
- `browser.click`
- `browser.click_text`
- `browser.close_all_tabs`
- `browser.close_tab`
- `browser.create_tab`
- `browser.dismiss_dialog`
- `browser.download_link`
- `browser.download_url`
- `browser.drag`
- `browser.evaluate_js`
- `browser.extract_page`
- `browser.find_element`
- `browser.forward`
- `browser.get_actionable_elements`
- `browser.get_console_events`
- `browser.get_dialogs`
- `browser.get_downloads`
- `browser.get_network_events`
- `browser.get_state`
- `browser.get_tabs`
- `browser.hit_test`
- `browser.hover`
- `browser.inspect_page`
- `browser.list_cached_pages`
- `browser.list_cached_sections`
- `browser.navigate`
- `browser.navigate_to`
- `browser.read_cached_chunk`
- `browser.reload`
- `browser.research_search`
- `browser.run_intent_program`
- `browser.search_page_cache`
- `browser.search_web`
- `browser.summarize_page`
- `browser.type`
- `browser.upload_file`
- `browser.wait_for`
- `browser.wait_for_download`

## Chat

- `chat.cache_stats`
- `chat.read_last`
- `chat.read_message`
- `chat.read_window`
- `chat.recall`
- `chat.search`
- `chat.thread_summary`

## Filesystem

- `filesystem.answer_from_cache`
- `filesystem.delete`
- `filesystem.file_cache_stats`
- `filesystem.index_workspace`
- `filesystem.list`
- `filesystem.list_cached_files`
- `filesystem.mkdir`
- `filesystem.move`
- `filesystem.patch`
- `filesystem.read`
- `filesystem.read_file_chunk`
- `filesystem.search`
- `filesystem.search_file_cache`
- `filesystem.write`

## Runtime

- `runtime.list_loaded_tools`
- `runtime.load_tools`
- `runtime.search_tools`

## Session

- `session.clear_all`
- `session.end`
- `session.get_all_sessions`
- `session.get_context_string`
- `session.get_previous_context`
- `session.record_message`
- `session.start`
- `session.stats`

## Sub-Agent

- `subagent.cancel`
- `subagent.list`
- `subagent.message`
- `subagent.spawn`
- `subagent.wait`

## Terminal

- `terminal.exec`
- `terminal.kill`
- `terminal.spawn`
- `terminal.write`
