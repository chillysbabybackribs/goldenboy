---
name: filesystem-operation
description: Use when reading, searching, or browsing files is required (including plan-only turns where editing is not allowed). Prefer cache-first reads before whole-file reads.
allowed-tools:
  - filesystem.list
  - filesystem.index_workspace
  - filesystem.search_file_cache
  - filesystem.read_file_chunk
  - filesystem.cache_inventory
  - filesystem.search
  - filesystem.read
  - filesystem.patch
  - filesystem.write
references:
  - src/main/agent/tools/filesystemTools.ts
  - src/main/fileKnowledge/
  - src/main/context/diskCache.ts
  - src/shared/types/ipc.ts
---

# Filesystem Operation

Use this skill when a task requires reading, searching, creating, or editing files.

## Workflow

1. Index the workspace when the cache is empty or stale.
2. Search cached file chunks before broad reads.
3. Read only the chunk ids needed to answer the task.
4. Use `filesystem.read` only for cache misses, stale chunks, or edit context.
5. Make patches against current file contents.
6. Keep edits scoped to the requested task.
7. Report changed paths and verification results.

## Rules

- This skill governs filesystem procedure only. It does not grant permission to edit files on plan-only turns.
- Prefer cached/indexed reads before full-file reads.
- Use write tools only when the runtime scope already permits editing.

## Preferred Tools

- `filesystem.list`
- `filesystem.index_workspace`
- `filesystem.search_file_cache`
- `filesystem.read_file_chunk`
- `filesystem.cache_inventory`
- `filesystem.search`
- `filesystem.read`
- `filesystem.patch`
- `filesystem.write`
