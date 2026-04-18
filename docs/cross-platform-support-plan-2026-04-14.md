# Cross-Platform Support Plan

Date: 2026-04-14

## Goal

Make V2 Workspace usable on Linux, macOS, and Windows with predictable behavior for:

- app startup
- browser surface
- terminal surface
- agent tool execution
- local development workflow
- packaged distribution

## Current Feasibility Summary

### Linux

Current primary target. The codebase is already designed around Linux-friendly assumptions.

### macOS

Feasible with moderate work.

The Electron app shell, browser surface, persisted state, and most path handling should port cleanly. The largest gaps are packaging, Chrome cookie import, and hardening shell/runtime behavior outside Linux.

### Windows

Feasible, but not "as is" for full product behavior.

The main blocker is that the terminal and agent terminal tools are written with POSIX shell assumptions. The app may launch, but terminal-driven workflows are likely to be degraded or incorrect until the shell abstraction is redesigned.

## What Already Looks Portable

- Electron window lifecycle and macOS activation handling are already cross-platform aware.
- Most filesystem paths use `path`, `os`, and Electron `app.getPath(...)`.
- Browser session persistence is stored under Electron `userData`, which is portable.
- File search has a fallback path if `rg` is unavailable.
- Development startup already accounts for `npm.cmd` and `electron.cmd` on Windows.

## Current Portability Risks

### 1. Terminal shell selection is not enough by itself

The app chooses `cmd.exe` on Windows and a Unix shell elsewhere, but command orchestration above that layer still assumes POSIX behavior.

Relevant code:

- `src/main/terminal/TerminalService.ts`
- `src/main/agent/tools/terminalTools.ts`

### 2. Agent terminal commands are POSIX-specific

The terminal tool runtime changes directories with:

`cd '<cwd>' && <command>`

That is valid for bash/zsh, but not for `cmd.exe`, and quoting rules differ for PowerShell as well.

### 3. Shell integration only supports bash and zsh

Structured command tracking currently injects OSC 633 hooks only for bash/zsh. There is no equivalent support for PowerShell or `cmd.exe`.

Relevant code:

- `src/main/terminal/shellIntegration.ts`

Impact:

- weaker command completion detection
- weaker cwd tracking
- less reliable terminal tool behavior on Windows

### 4. Chrome cookie import is Linux-only

Chrome session import is currently implemented with Linux paths and Linux-specific dependencies:

- `~/.config/google-chrome/...`
- `secret-tool`
- `sqlite3`
- Linux cookie decryption assumptions

Relevant code:

- `src/main/browser/chromeCookieImporter.ts`
- `src/main/browser/chromeCookieCrypto.ts`

This feature will not work on macOS or Windows without separate implementations.

### 5. Packaging is not implemented

The repo currently builds and runs Electron from source, but it does not define a cross-platform packaging pipeline such as Electron Forge or Electron Builder.

Relevant code:

- `package.json`

### 6. Some developer scripts remain Unix-oriented

Examples:

- `npm run clean` uses `rm -rf`
- dev process shutdown relies on POSIX-style signals

Relevant code:

- `package.json`
- `scripts/dev.js`

These are not the main product blockers, but they reduce day-to-day portability.

## Recommendation

Support all three platforms, but do it in this order:

1. Linux baseline stabilization
2. macOS runtime parity
3. Windows terminal/runtime parity
4. packaging and signed distribution

macOS is the easier next target because the existing terminal model is already closer to bash/zsh. Windows should be treated as a deliberate platform adaptation effort, not a packaging exercise.

## Implementation Plan

### Phase 1: Establish a platform abstraction layer

Add a small runtime platform module that centralizes:

- detected OS
- preferred default shell
- shell command wrapping rules
- cwd change strategy
- interrupt behavior
- terminal integration capability flags
- optional browser-cookie import capability

Deliverables:

- `PlatformRuntime` or similar module in `src/main/platform/`
- no direct shell syntax in feature code outside the platform layer

### Phase 2: Make terminal execution cross-platform

Replace direct POSIX command composition with shell-aware command builders.

Work:

- define supported shells per OS
- prefer `pwsh` on Windows when available
- support `cmd.exe` only as a fallback
- implement per-shell cwd wrapping
- implement per-shell quoting helpers
- define how interrupts are sent on each platform

Acceptance criteria:

- terminal session starts on Linux, macOS, and Windows
- `terminal.exec` works with an explicit cwd on all three
- `terminal.spawn`, `terminal.write`, and `terminal.kill` behave predictably

### Phase 3: Rework shell integration

Extend structured terminal tracking beyond bash/zsh.

Options:

- implement PowerShell integration
- keep Windows in fallback mode initially, but mark capabilities clearly

Acceptance criteria:

- command completion and cwd tracking are reliable on Linux and macOS
- Windows behavior is either fully implemented or intentionally degraded with explicit product messaging

### Phase 4: Make browser session import optional by platform

Do not block cross-platform support on cookie import.

Short-term:

- gate the feature behind capability detection
- disable or hide it on unsupported platforms

Long-term:

- add macOS-specific Chrome profile/keychain support
- add Windows-specific Chrome profile/credential support

Acceptance criteria:

- unsupported platforms do not surface broken session-import UX
- browser surface remains fully usable without cookie import

### Phase 5: Make developer tooling portable

Work:

- replace `rm -rf dist` with a Node-based clean script or a portable package
- harden `scripts/dev.js` for Windows process teardown
- add platform-specific setup notes to `README.md`
- document native rebuild requirements for `node-pty`

Acceptance criteria:

- `npm run build`, `npm run dev`, `npm test`, and `npm run clean` work on all three platforms

### Phase 6: Add packaging and release automation

Work:

- choose Electron Forge or Electron Builder
- define targets for Linux, macOS, and Windows
- package `node-pty` correctly for each platform
- add CI build matrix

Acceptance criteria:

- reproducible artifacts for all supported platforms
- one documented install path per OS

### Phase 7: Add a real compatibility test matrix

Test at two levels:

- startup and smoke behavior
- feature parity by surface

Minimum matrix:

- Linux
- macOS Apple Silicon
- Windows 11

Smoke tests:

- app launch
- command window + execution window open
- terminal starts
- browser tab loads
- Codex provider availability probe runs
- task can be created and persisted

## Proposed Priority Order

### Short-term

1. Introduce platform abstraction
2. Fix terminal command wrapping
3. Gate unsupported Chrome import behavior
4. Make scripts portable

### Mid-term

1. PowerShell shell integration
2. packaging
3. CI matrix

### Long-term

1. native Chrome-session import on macOS
2. native Chrome-session import on Windows
3. signed release process per OS

## Bottom Line

This application can be designed to work on Linux, macOS, and Windows.

It is not currently full-feature portable "as is".

The main product architecture is portable, but the terminal and browser-session integration layers still encode Linux-first assumptions. macOS is a realistic near-term target. Windows is also realistic, but it needs explicit shell/runtime portability work before it should be considered supported.
