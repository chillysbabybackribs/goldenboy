# Filesystem Operation

Use this skill when a task requires reading, searching, creating, or editing files.

## Relevant Files

- `src/main/agent/tools/filesystemTools.ts`
- `src/main/fileKnowledge/`
- `src/main/context/diskCache.ts`
- `src/shared/types/ipc.ts`

## Workflow

1. Index the workspace when the cache is empty or stale.
2. Search cached file chunks before broad reads.
3. Read only the chunk ids needed to answer the task.
4. Use `filesystem.read` only for cache misses, stale chunks, or edit context.
5. Make patches against current file contents.
6. Keep edits scoped to the requested task.
7. Report changed paths and verification results.

## Preferred Tools

- `filesystem.list`
- `filesystem.index_workspace`
- `filesystem.answer_from_cache`
- `filesystem.search_file_cache`
- `filesystem.read_file_chunk`
- `filesystem.list_cached_files`
- `filesystem.file_cache_stats`
- `filesystem.search`
- `filesystem.read`
- `filesystem.patch`
- `filesystem.write`
