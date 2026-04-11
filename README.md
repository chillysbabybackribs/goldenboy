# V2 Workspace

A locally-hosted agent workbench that runs AI-driven browser automation and terminal tasks with deterministic validation and intelligent caching.

## Key Features

- **Deterministic Result Validation** — Every tool result is validated by `ConstraintValidator` before the model sees it. No hallucinated successes.
- **Browser & File Knowledge Caches** — Semantic-aware chunking with cached retrieval at ~200-400 tokens vs 2K-5K for full page extraction.
- **Intelligent Browser Perception** — Two-tier content extraction (semantic HTML first, readability fallback) with ranked actionable elements.
- **Research Search with Evidence Sufficiency** — Opens pages sequentially until evidence score meets threshold, then stops.
- **Sub-Agent Recursion** — Parent agents spawn isolated child agents for parallel constraint solving.
- **Chat & Task Memory** — Searchable conversation history and per-session findings for answer validation.

## Architecture

```
V2 Workspace (Electron)
├─ Main Process
│  ├─ AgentRuntime → HaikuProvider (Anthropic Haiku 4.5)
│  ├─ AgentToolExecutor → ConstraintValidator
│  ├─ SubAgentManager
│  ├─ BrowserService + BrowserPerception
│  ├─ PageKnowledgeStore / FileKnowledgeStore / ChatKnowledgeStore
│  └─ TerminalService
└─ Renderer (React)
   ├─ Command window (chat, logs, token tracking)
   └─ Execution window (browser tabs, terminal)
```

## Getting Started

```bash
git clone https://github.com/goldenboy/v2workspace.git
cd v2workspace
npm install
npm start
```

**Requirements**: Node.js 18+, Electron 28+, Anthropic API key.

## License

MIT

## Author

Goldenboy
