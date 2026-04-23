# MEMORY.md - Long-Term Memory

This file is for durable context that should survive beyond a single day.

## Stable Preferences

- User prefers concise, action-oriented communication.

## Durable Facts

- Main workspace includes agent operating files such as `AGENTS.md`, `SOUL.md`, and `IDENTITY.md`.
- Parallel sessions/hooks can land commits on the same branch while an agent is working. Always re-check `git log` and `git status` before assuming a task is unstarted.
- **Prior status drift:** threads below had been marked COMPLETE in this file while their files were only on disk (not on any branch tip). On 2026-04-23 everything was consolidated into `a2ff860 chore: publish pending workspace state` on `codex/model-auto-handoff` and pushed to origin. The orphaned grounding-gate commits `3cd32bc..86bca7b` remain in the reflog (unreachable, will be gc'd) — their content lives in the consolidated commit. A pre-publish working-tree snapshot is at `refs/backup/pre-publish-1776938727` for emergency recovery.
- `AgentPromptBuilder`'s `ALWAYS_ON_CONTRACT_SECTIONS` allowlist gates which `AGENTS.md` H2 sections reach the model prompt. `Operating Rules` is in that allowlist; dropping it silently regresses the `browser.research_search` query-hygiene rule (lives under `Operating Rules → Web research`). `sourceValidationPolicy.test.ts` guards this. Regression fixed in `39f6e44` (2026-04-23).

## Open Threads

### browser.research_search rework — COMPLETE (2026-04-23)

Plan: `docs/superpowers/plans/2026-04-23-browser-research-search-rework.md`

Root cause the rework addresses: the old tool opened a visible Google SERP and parsed it with fragile client-side selectors; scoring had a pricing-vocabulary bonus that made non-pricing queries unreachable; `matchSnippets` was silently empty when the page cache had no chunks; snippets carried leading date/rating noise; the model habitually wrote bot-style queries with `site:`/`filetype:` operators.

New pipeline:
1. `sanitizeResearchQuery` strips `site:`/`inurl:`/`intitle:`/`intext:`/`filetype:`/`ext:`/`before:`/`after:`/`cache:`/`related:`/`link:`/`define:`/`allinurl:`/`allintitle:`/`allintext:` unless `preserveOperators: true`. Collapses whitespace, trims trailing punctuation, caps at 200 chars.
2. `probeSerps` fetches Google (`udm=14`), DuckDuckGo-lite, and Bing in parallel via `globalThis.fetch` (undici in main process; no shared cookies with the visible browser on purpose, to avoid session side-effects). 8-second per-engine timeout with abort + race-timeout fallback so a hanging fetch cannot stall the probe.
3. Three engine-specific parsers (`googleParser`, `duckduckgoParser`, `bingParser`) extract `{ url, title, snippet, serpRank, serpSource }` from server-rendered HTML with regex-based balanced-tag scanning. Google detects `consent.google.com` and `/sorry/index` captcha walls; DDG-lite decodes `//duckduckgo.com/l/?uddg=` redirects; Bing filters ads (`b_ad`) and Microsoft-internal hosts.
4. `canonicalizeUrl` + `mergeCandidates` dedupe across engines (lowercase host, drop tracking params, strip trailing slashes, drop fragment), union `sources`, take min `bestRank`, longest `snippet`.
5. `scoreCandidates` applies signal-based weights: rank inverse, query-term overlap in title (2×) and snippet (1×), multi-engine agreement (+2 per extra source), clean-path bonus, https bonus, spam-TLD penalty, boilerplate snippet penalty, AMP-subdomain penalty. `pickTopX` returns the highest-scoring X (ties → lower rank wins).
6. `browser.research_search` now auto-navigates the visible tab to candidate #1 and opens #2..#X as parallel new tabs. No SERP page is ever shown to the user. The tool response includes `sanitizedQuery`, `strippedOperators`, `serpProbe.{engines, candidateCount, topScored, discarded}` for transparency.
7. Graceful degradation: if the probe returns zero usable candidates (all three engines blocked/timed out), the tool falls back to the old visible-SERP path so behavior is never worse than before.
8. `scoreEvidence` rewritten: deleted the pricing-vocabulary bonus, gated the keyFacts bonus on actual term-match, and falls back to `summary + keyFacts` when `matchSnippets` is empty. New `cleanSnippet` helper strips leading month-day-year prefixes, star ratings, "About N results" headers, collapses whitespace, caps at 200 chars.
9. `AGENTS.md ### Web research` and `skills/browser-operation/SKILL.md` updated with the query-hygiene rule.

New files under `src/main/agent/research/`: `querySanitizer.ts`, `queryTerms.ts`, `scoreEvidence.ts`, `serpProbe.ts`, `candidateScoring.ts`, `types.ts`, `serpParsers/{google,duckduckgo,bing}Parser.ts`, plus `__fixtures__/*.html` for the parser tests.

Tests: 98 new tests across 8 files, all green. `npx tsc -p tsconfig.main.json --noEmit` clean. Full suite: 490/491 (one pre-existing unrelated `sourceValidationPolicy.test.ts` failure that predates this work).

Known tradeoffs: using `globalThis.fetch` means the probe does not share cookies with the visible browser — google.com searches in the probe are logged-out, which can trigger a consent wall. The three-engine merge already compensates and the visible-SERP fallback catches the degenerate case. A future iteration could route the probe through `Electron.net.fetch` for a shared session.

### Browser Deterministic Kernel — COMPLETE (step 1) / smoke tests retired

Plan: `docs/superpowers/plans/2026-04-23-browser-deterministic-kernel.md`
Spec: `docs/superpowers/specs/2026-04-23-browser-deterministic-kernel-design.md`

All 9 tasks landed on branch `codex/model-auto-handoff`:

| Task | Commit | Scope |
|---|---|---|
| 1 | `04168e0` | Scaffold kernel types + capability interface |
| 2 | `46d5074` | `DeterministicKernel` with rollback + idempotency |
| 3 | `717e178` | `userAgent`, `visual`, `networkBlocklist` pins |
| 4 | `ca84676` | `viewport`, `localeTimezone` CDP pins |
| 5 | `87defcd` + `1749c34` fix | Seed+clock preload pin; fix restricts Date patch to zero-arg construction |
| 6 | `b8ea85d` + `27d2af2` fix | Electron adapter; fix removes unauthorized `reloadTab` |
| 7 | `530e63a` | Wire `openTabDeterministic` to kernel via optional hook |
| 8 | `20b95ed` | Wire `DeterministicKernel` singleton into `browser.open_tab` |
| 9 | `9cb598a` | Skill doc: `browser-operation` deterministic section + refresh stale tool list |

Verification: `npx tsc -p tsconfig.main.json --noEmit` clean, `npx vitest run` green (386/386 in kernel scope; 1 unrelated pre-existing failure in `sourceValidationPolicy.test.ts`).

**E2E harness landed (2026-04-23) — retires the manual smoke tests.**
- `scripts/e2e/determinism/harness.js` — Electron main-process harness; hidden `BrowserWindow` + minimal tab registry + real `DeterministicKernel` + all 6 pins. Runs 4 cases.
- `scripts/e2e/determinism/run.js` — Node wrapper. `npm run test:e2e:determinism`. Headless CI path: `E2E_DISPLAY=headless` (wraps in `xvfb-run`).
- Both desktop (`:1` display) and xvfb headless runs: **overall PASS (~5s end-to-end, 4 cases)**.

**All three latent bugs surfaced by the v1 harness are now fixed (2026-04-23):**
1. ✅ `visualPin` CSS now survives navigation. Rewritten to inject via CDP `Page.addScriptToEvaluateOnNewDocument` (preload runs at document-start on every new document) with an additional `insertCSS` for the current document for immediate effect. Uses a MutationObserver to wait for `document.head` to exist before appending, so the HTML parser state is never corrupted. Harness Case B now loads `basic.html`, enters the kernel, then navigates to `anim.html` and asserts `animation-duration === '0s'` — a real post-navigation regression test.
2. ✅ `visualPin`'s `reduceMotion` dead-code branch removed. `reduceMotion` is now satisfied entirely by `localeTimezonePin` via `Emulation.setEmulatedMedia` (media feature flip). `visualPin` only reacts to `disableAnimations`.
3. ✅ `networkBlocklistPin` switched from session-scoped `webRequest.onBeforeRequest` to per-tab CDP `Fetch.enable` + `Fetch.requestPaused` → `Fetch.continueRequest` / `Fetch.failRequest`. The `KernelCapabilities` interface dropped `registerRequestBlocker`; `CdpHandle` gained `on`/`off` for event dispatch (Electron's `webContents.debugger.on('message', ...)` is bridged to per-method handler sets in `electronKernelCapabilities.ts`). Harness Case D proves two concurrent tabs sharing a session can maintain divergent blocklists.

**Electron v41+ workaround baked into the adapter.** `createElectronKernelCapabilities` now installs a no-op `session.webRequest.onErrorOccurred(() => {})` sentinel on every tab session it touches. Without it, [electron/electron#50678](https://github.com/electron/electron/issues/50678) (Dec 2025 Chromium bump regression) causes intermittent ERR_FAILED on main-frame navigation whenever the debugger has CDP interception active. The sentinel is idempotent per session (tracked via WeakSet).

Verification: `npx tsc -p tsconfig.main.json --noEmit` clean, `npx vitest run` green (396/397; one pre-existing unrelated failure in `sourceValidationPolicy.test.ts`), `npm run test:e2e:determinism` PASS on all 4 cases.

**Required prereq when running harness:** `npm run build:main` (it requires compiled output from `dist/main/`).

### Codex runtime — start/end rot fixes (2026-04-23)

User observed two symptoms in smoke tests: duplicate `browser.open_tab` at task start, and the live-run card stuck on "Exploring ideas" after `answer.submit`. Traced to three independent bugs in `AppServerProvider.ts`:

1. **Terminal-turn misclassification.** `turn/completed` classified a turn as `kind: 'tool_calls'` whenever any MCP tool fired, including a successful `answer.submit`. The outer loop then queued another empty turn; Codex kept the socket warm with `thread/tokenUsage/updated` keepalives, no `turn/completed` ever arrived, and the UI sat on "Exploring ideas". Fix: track a `finalAnswerSubmitted` flag at `item/completed` for the `answer.submit` tool with `error === null`, and resolve `kind: 'final'` at `turn/completed`. Failed submissions still fall through the old `toolsCalled` path so the model can revise.
2. **Over-steering continuation prompt.** Post-tool turns injected a multi-sentence paragraph ("Continue the task using the tool results…, If the next tool call is obvious, call it immediately…") as the user input. That directive biased the model toward re-issuing the just-completed tool — the duplicate `browser.open_tab` chip at run start. `POST_TOOL_CONTINUATION_INPUT` is now a single neutral word (`'continue'`); tool results and thread history drive the next turn.
3. **Turn timeout reset on every message.** `resetTimer` ran inside the inbound message handler, so Codex's per-second tokenUsage keepalives indefinitely extended the deadline. Split into two timers: `wallClockTimer` (3 minutes, armed once at `turn/start`, never reset) guards against any stall including keepalive flooding; `idleTimer` (30s, reset on every inbound message) converts silent sockets into a `RecoverableTurnError` quickly enough for the existing reconnect+resume path to salvage the turn before the wall clock fires. Both clean up in the shared `cleanup`.

Tests: 4 new/updated tests in `AppServerProvider.test.ts` cover successful+failed `answer.submit` terminal detection, the minimal continuation token, idle timeout firing, and idle timer staying quiet while heartbeats flow. `npx vitest run src/main/agent/AppServerProvider.test.ts` → 19/19 green.

## Maintenance Rule

Keep this curated. If something belongs in a daily log instead, put it in `memory/YYYY-MM-DD.md`.
