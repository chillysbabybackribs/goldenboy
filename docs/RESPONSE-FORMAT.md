# Goldenboy Response Format

This is the repo-owned response format for Goldenboy assistant output.

It replaces the old `MARKDOWN-IT.md` reference. Goldenboy does not use `markdown-it`; the chat surface renders a small custom Markdown subset from `src/renderer/command/markdown.ts`.

## Goals

- Keep answers scannable under pressure.
- Match the renderer's actual supported syntax.
- Reduce brittle, cluttered, over-nested output.
- Make default answers consistent without forcing a rigid template on every turn.

## Default Shape

Use the smallest structure that fits the task.

- Simple answer: 1 short paragraph.
- Simple code/task update: 1 to 2 short paragraphs.
- Larger implementation or analysis: 2 to 3 short sections with optional flat bullets.
- Review/finding-heavy work: findings first, then open questions or residual risk.

Do not force headers or lists when plain prose is clearer.

## Canonical Rules

- Start with the answer or outcome, not preamble.
- Prefer short paragraphs over bullet spam.
- Use lists only when the content is inherently list-shaped.
- Keep bullets flat. No nested bullets.
- Keep numbered lists flat and use `1.` `2.` `3.`
- Use at most 2 to 3 high-signal sections in most final answers.
- Avoid changelog-style file inventories unless the user explicitly wants them.
- Do not add a recap after the answer if the answer is already complete.

## Supported Markdown

The renderer currently supports:

- Paragraphs
- Headings with `#` through `####`
- Unordered lists with `-` or `*`
- Ordered lists with `1.` style markers
- Fenced code blocks with triple backticks
- Blockquotes with `>`
- Horizontal rules with `---`, `***`, or `___`
- Pipe tables
- Inline `code`
- Inline `**bold**`
- Markdown links `[label](url)`

## Avoid

These are either unsupported, visually noisy, or too brittle for the chat surface:

- Nested bullets or nested numbered lists
- Deep heading hierarchies
- Raw HTML
- Italic-only emphasis as a structural signal
- Tables for normal prose or status updates
- Long file-path dumps inline in sentences
- Giant multi-section recaps

## File Links

When referencing local files, use clickable markdown links in this form:

`[label](/absolute/path/to/file.ts:12)`

Use file links when they materially help the reader inspect code. Do not turn every path mention into a link.

## Recommended Patterns

## Simple Answer

Use one short paragraph that leads with the conclusion.

Example:

```md
The current doc should be removed. Goldenboy does not use `markdown-it`, and the real rendering behavior lives in [markdown.ts](/home/dp/Documents/goldenboy/src/renderer/command/markdown.ts:1).
```

## Change Summary

Use one short paragraph, optionally followed by a brief verification line.

Example:

```md
I replaced the old markdown-it reference with a repo-owned response format spec and tightened the runtime guidance in [AGENTS.md](/home/dp/Documents/goldenboy/AGENTS.md:295).

Verification: `npm run build`
```

## Findings

Use flat bullets ordered by severity.

Example:

```md
- High: The renderer does not support nested lists, so deeply structured answers collapse into noisy prose.
- Medium: The old doc describes `markdown-it`, but the app uses a custom renderer in [markdown.ts](/home/dp/Documents/goldenboy/src/renderer/command/markdown.ts:1).
```

## Tables

Use tables only for true matrix comparisons, not for normal summaries.

Good:

```md
| Option | Pros | Cons |
|---|---|---|
| Keep custom renderer | Small and predictable | Limited syntax |
| Switch to markdown-it | Richer syntax | More complexity |
```

Avoid using tables for:

- Status updates
- Narrative explanations
- Single-column lists
- Anything that would read better as 2 to 4 bullets

## Decision

Goldenboy should standardize on:

- Concise prose by default
- Flat lists when needed
- Fenced code blocks for code
- File links for code references
- Tables only when a matrix is genuinely useful

That format matches the renderer, stays readable in the command pane, and avoids the clutter that came from treating generic Markdown as the spec.
