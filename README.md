# V2 Workspace

**V2 Workspace** is a local Electron application that brings AI-powered autonomous task completion to your desktop. It combines a control plane for conversation and task management with an execution surface for browser automation and terminal operations, all unified under a single local agent runtime.

## What It Can Do

V2 Workspace is built to help you work smarter by letting an AI agent operate your browser and terminal in real-time, following your instructions with deterministic result validation and intelligent constraint checking.

### Core Capabilities

#### 🤖 **Autonomous Agent Operations**
- AI agent processes your tasks using a structured tool system
- Full browser automation: navigate, search, click, type, extract page content
- Terminal execution: run commands, capture output, validate results
- Sub-agent spawning for parallel or decomposed tasks
- Intelligent task memory and constraint validation

#### 🌐 **Browser Automation**
- Open and navigate to URLs
- Perform web research with sequential result evaluation
- Click elements, type text, and interact with page components
- Extract structured data from web pages
- Cache and search page content for efficient re-use
- Built-in evidence sufficiency tracking to stop when enough information is gathered

#### 💻 **Terminal Control**
- Execute shell commands and capture output
- Run scripts, CLIs, and package managers
- Manage long-running processes (servers, watchers, tunnels)
- Track exit codes and error signals
- Verify creation and state changes post-execution

#### 📚 **Intelligent Knowledge Caching**
- **File Knowledge Cache**: Index your workspace, search code chunks, avoid redundant reads
- **Browser Page Cache**: Cache web page content, search across visited pages
- **Chat Memory**: Full conversation history with progressive recall
- Dramatically reduce token usage through smart caching

#### ✅ **Deterministic Result Validation**
- Every tool result is validated against explicit constraints
- Constraint status checking: PASS, FAIL, UNKNOWN, ESTIMATED, CONDITIONAL
- Runtime validation blocks prevent false-positive claims
- Support for complex multi-constraint scenarios
- Source validation for factual and technical claims

#### 🎯 **Dual-Window Interface**
- **Command Window**: Conversation, task creation, model logs, run status
- **Execution Window**: Live browser tabs and terminal sessions
- Persistent window bounds and state management
- Single-instance lock to prevent duplicate sessions

### Advanced Features

- **Skill Loading**: Modular task-specific instruction sets in `skills/` directory
- **Provider Integration**: Haiku 4.5 via Anthropic SDK with optional Gemini sidecar for supporting decisions
- **IPC Architecture**: Type-safe inter-process communication between main and renderer threads
- **Event Router**: Centralized event fanout for real-time state updates
- **App State Store**: Persistent application state with automatic recovery
- **Preload Security**: Sandboxed preload scripts for safe IPC bridges

## Architecture

```
HaikuProvider (AI Agent)
  ↓
AgentRuntime (Task orchestration)
  ↓
AgentToolExecutor (Tool dispatch)
  ↓
Tool Modules (Typed operations)
  ├─ BrowserService (Automation)
  ├─ TerminalService (Shell execution)
  ├─ FileSystem (Knowledge cache & operations)
  └─ ChatMemory (Conversation tracking)
  ↓
ConstraintValidator (Result validation)
  ↓
IPC → Renderer Windows
```

## Development

### Prerequisites
- Node.js 18+
- npm
- Anthropic API key (for agent operations)

### Quick Start

```bash
# Install dependencies
npm install

# Build and run
npm start

# Development mode with hot rebuild
npm run dev

# Build only
npm run build

# Clean build artifacts
npm run clean
```

### Project Structure

```
v2-workspace/
├── src/
│   ├── main/              # Electron main process
│   │   ├── agent/         # Agent runtime & tools
│   │   ├── browser/       # Browser automation
│   │   ├── terminal/      # Terminal service
│   │   ├── windows/       # Window management
│   │   ├── state/         # App state store
│   │   ├── events/        # Event routing
│   │   ├── ipc/           # IPC handlers
│   │   └── fileKnowledge/ # File caching
│   ├── renderer/          # Electron renderer processes
│   │   ├── command/       # Control plane UI
│   │   └── execution/     # Browser & terminal UI
│   └── shared/            # Shared types & contracts
├── skills/                # AI skill definitions
├── dist/                  # Compiled output
├── package.json
├── tsconfig.json
└── AGENT.md              # Agent contract documentation
```

### Key Files

- **Main Process**: `src/main/main.ts`
- **Agent Runtime**: `src/main/agent/AgentRuntime.ts`
- **Browser Service**: `src/main/browser/BrowserService.ts`
- **Terminal Service**: `src/main/terminal/TerminalService.ts`
- **IPC Registration**: `src/main/ipc/registerIpc.ts`
- **Window Manager**: `src/main/windows/windowManager.ts`

## Configuration

Set your Anthropic API key:

```bash
export ANTHROPIC_API_KEY="your-key-here"
```

## Features in Action

### Example: Trip Planning
The agent can research flight options, hotel prices, and attractions, validate results against your constraints (budget, dates, preferences), and compile a complete travel plan.

### Example: Code Task
The agent can browse code repositories, search documentation, write files, run tests, and verify results all within the execution environment.

### Example: Data Research
The agent can search multiple sources, extract and cache page content, compare information across sites, and stop once sufficient evidence is gathered.

## Validation & Constraints

Every result is validated deterministically:

```
✅ VALID   — All constraints pass, no uncertainty
❌ INVALID — Any constraint fails
⚠️  INCOMPLETE — Some constraint unknown or estimated
```

This ensures results are reliable before the model acts on them.

## Performance Optimization

- **Token Efficiency**: Smart caching reduces repeated file reads and browser extractions
- **Constraint-Driven**: Only operates when evidence meets declared constraints
- **Progressive Recall**: Chat history indexed for efficient memory access
- **Bounded Context**: Loads only necessary file chunks and page sections

## Troubleshooting

### App Won't Start
```bash
npm run clean
npm run build
npm start
```

### Terminal Not Responsive
Check that node-pty is installed and your terminal emulator is accessible.

### Browser Automation Issues
Ensure browser process has necessary permissions and GPU acceleration is disabled (defaults to CPU mode).

## Contributing

The codebase follows strict TypeScript typing and IPC contracts. See `AGENT.md` for the full agent contract and operating rules.

## License

This project is part of the V2 Workspace ecosystem.

---

**V2 Workspace brings autonomous task completion to your local machine with deterministic validation, intelligent caching, and a unified browser and terminal interface.**
