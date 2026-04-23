# Browser Research Search Rework Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the visible-browser Google SERP extraction in `browser.research_search` with a headless multi-engine SERP probe, quality-scored candidate filtering, and auto-navigation directly to the top-X content pages. User and model never see a SERP. Also rewrite evidence scoring to remove pricing bias and fix snippet hygiene.

**Motivation:** Current tool produces bad results because (a) it parses the visible Google SERP which is JS-rendered, consent-walled, and selector-unstable; (b) it scores evidence with a hard-coded pricing-vocabulary bonus so non-pricing queries never clear the threshold; (c) `matchSnippets` is silently empty when the page cache has no chunks; (d) raw container `innerText` as snippets includes breadcrumbs/dates/rating noise; (e) the model writes "bot-style" queries with `site:`/`inurl:`/`filetype:` operators that distort SERPs and make the agent visibly non-human.

**Architecture:**
1. Query hygiene strips search operators and normalizes whitespace.
2. A headless `net.fetch` probe hits Google, DDG-lite, and Bing **in parallel** off the Electron session (cookies + UA shared with the visible browser, so we look like the user).
3. Each engine parser extracts `{ url, title, snippet, serpRank, serpSource }` from its server-rendered HTML.
4. Candidates are merged, deduped by canonical URL, then quality-scored with signal-based weights (SERP rank, query-term coverage, URL cleanliness, TLD sanity, HTTPS, snippet non-boilerplate, multi-engine agreement bonus).
5. Top X candidates → auto-navigate the visible tab to #1 and open tabs 2..X in parallel; the rest of the pipeline (page caching, evidence extraction, finding pinning) is unchanged.
6. Evidence scoring is rewritten to use rank-relative "sufficient" (no absolute threshold), fall back to `summary` + `keyFacts` when `matchSnippets` is empty, and clean snippets of leading date/rating noise.

**Tech Stack:** TypeScript, Electron (`net.fetch`), Vitest, jsdom (optional; probably regex-based parsers).

---

## Root-cause ↔ Task Map (for reviewers)

| Root cause (from analysis) | Addressed by |
|---|---|
| Google SERP parsing is brittle + JS-raced (#1, #2) | Tasks 2, 3 — headless fetch + engine-specific server-HTML parsers |
| Pricing-vocabulary scoring bias (#3) | Task 6 — rewrite `scoreEvidence` |
| `matchSnippets` silently empty (#4) | Task 6 — fallback to `summary` + `keyFacts` |
| Snippet noise (breadcrumbs/dates/ratings) (#5) | Task 6 — snippet hygiene pass |
| Model uses bot operators | Task 1 — server-side sanitizer + Task 8 prompt/skill coaching |

---

## File Structure

**New files:**

```
src/main/agent/research/
  querySanitizer.ts                 — strip site:/inurl:/filetype:/before:/after:/intitle: etc.
  querySanitizer.test.ts
  serpProbe.ts                      — net.fetch Google/DDG/Bing in parallel, merge, dedupe
  serpProbe.test.ts                 — uses fixture HTML, mocks net.fetch
  serpParsers/
    googleParser.ts                 — regex/DOM-shim parser for Google server-rendered HTML
    googleParser.test.ts
    duckduckgoParser.ts             — parser for html.duckduckgo.com/html
    duckduckgoParser.test.ts
    bingParser.ts                   — parser for bing.com/search
    bingParser.test.ts
  candidateScoring.ts               — signal-based quality score + top-X selection
  candidateScoring.test.ts
  __fixtures__/
    google-results.html             — saved real SERP HTML (sanitized)
    google-consent.html             — consent-wall case
    duckduckgo-results.html
    bing-results.html
```

**Modified files:**

```
src/main/agent/tools/browser/index.ts    — rewrite browser.research_search execute(); rewrite scoreEvidence
src/main/browser/BrowserPageAnalysis.ts  — keep extractSearchResults for mode: 'open' fallback; no deletion
skills/browser-operation/SKILL.md        — add "Query hygiene: no site:/inurl:/filetype: operators" rule
AGENTS.md                                — update ### Web research section to mention operator-free queries
MEMORY.md                                — note the rework under Open Threads when done
```

---

## Task Breakdown

Each task has verification so we can stop mid-plan and know what's proven.

### Task 1 — Query sanitizer

**File:** `src/main/agent/research/querySanitizer.ts` (+ test)

**Interface:**
```ts
export type SanitizeResult = {
  sanitized: string;
  original: string;
  strippedOperators: string[];    // e.g. ['site:reddit.com', 'filetype:pdf']
  wasModified: boolean;
};
export function sanitizeResearchQuery(
  query: string,
  opts?: { preserveOperators?: boolean },
): SanitizeResult;
```

**Rules:**
- Strip tokens matching `/\b(site|inurl|intitle|intext|filetype|ext|before|after|cache|related|link|define|allinurl|allintitle|allintext|AROUND\(\d+\))\s*:\s*\S+/gi`.
- Strip trailing punctuation and collapse whitespace.
- Hard cap 200 chars.
- If `preserveOperators: true`, no-op.

**Tests:**
- `site:reddit.com best espresso` → `best espresso`, strippedOperators = `['site:reddit.com']`.
- `how to write a debounce function` → unchanged, wasModified=false.
- `filetype:pdf intitle:"annual report" tesla` → `tesla`.
- `preserveOperators: true` → no strip.
- 500-char query → truncated to 200.

**Verification:** `npx vitest run src/main/agent/research/querySanitizer.test.ts` green.

- [x] Implement sanitizer
- [x] Tests green

---

### Task 2 — Engine parsers (Google / DDG-lite / Bing)

**Files:** `src/main/agent/research/serpParsers/{google,duckduckgo,bing}Parser.ts` (+ tests + fixtures)

**Interface (each parser):**
```ts
export type SerpCandidate = {
  url: string;
  title: string;
  snippet: string;
  serpRank: number;          // 1-indexed position in the engine's results
  serpSource: 'google' | 'duckduckgo' | 'bing';
};
export function parseGoogleSerp(html: string): { candidates: SerpCandidate[]; consentWall: boolean };
// same shape for parseDuckduckgoSerp, parseBingSerp (consentWall always false)
```

**Parsers (regex-first, no jsdom dep in v1 — speed + small footprint):**
- **Google**: find `<a href="/url?q=…">…</a>` blocks inside the results area; decode `q` param; extract enclosing `<h3>` for title and adjacent text span for snippet. Detect consent by matching `<form action="https://consent.google.com` or `pathname /sorry/`.
- **DDG-lite**: server-rendered HTML. Match `<a class="result__a" href="…">` for title+URL; decode `/l/?uddg=…` wrapper if present; adjacent `<a class="result__snippet">` for snippet.
- **Bing**: match `<li class="b_algo">` blocks; pull `<h2><a href="…">` for title+URL and `<p>` inside for snippet.

**Tests** (per parser):
- Fixture HTML (saved from real SERPs, sanitized of personal data) → assert ≥5 candidates with non-empty URL/title.
- Consent-page fixture (Google only) → `consentWall: true`, `candidates: []`.
- Redirect-wrapper decoding: `/url?q=https%3A%2F%2Fexample.com%2Fpage&sa=…` decodes to `https://example.com/page`.
- Malformed HTML → empty candidates, no throw.

**Verification:** all three parser test files green.

- [x] google parser + test + fixture
- [x] duckduckgo parser + test + fixture
- [x] bing parser + test + fixture

---

### Task 3 — SERP probe (multi-engine fetch + merge + dedupe)

**File:** `src/main/agent/research/serpProbe.ts` (+ test)

**Interface:**
```ts
export type ProbeResult = {
  candidates: MergedCandidate[];    // deduped
  engines: {
    google: { hit: boolean; count: number; consentWall: boolean; error: string | null };
    duckduckgo: { hit: boolean; count: number; error: string | null };
    bing: { hit: boolean; count: number; error: string | null };
  };
};
export type MergedCandidate = {
  url: string;                      // canonical
  title: string;
  snippet: string;
  bestRank: number;                 // min rank across sources
  sources: Array<'google' | 'duckduckgo' | 'bing'>;
};
export async function probeSerps(
  query: string,
  opts?: { fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<ProbeResult>;
```

**Behavior:**
- Launch all three `net.fetch`es in parallel with 8s timeout each. Use Electron's session-bound `net.fetch` when run in main process (fallback to global `fetch` for tests via `fetchImpl` DI).
- Pass a plain desktop-Chrome `User-Agent` header and `Accept: text/html`.
- For each engine: on success → parser → candidates. On network/timeout error → record error, continue. On consent wall (Google) → record consentWall=true, candidates empty.
- **Canonical URL**: lowercase host, strip `?utm_*`, `?fbclid`, `?gclid`, `?ref=`, trailing slash (except root).
- **Dedupe**: group by canonical URL, merge into `MergedCandidate` (union `sources`, min `bestRank`, longest non-empty `snippet`, shortest non-empty `title`).

**Tests:**
- Mock `fetchImpl` returning fixture HTML for all three engines → assert merged candidates include cross-source URLs with `sources.length >= 2`.
- Mock Google returning consent page → `engines.google.consentWall: true`, still returns DDG + Bing results.
- Mock all three timing out → empty candidates, no throw; all `error` fields populated.
- Canonicalization: `https://example.com/page?utm_source=x` and `https://example.com/page/` merge into one candidate.
- Timeout: mock one engine hanging → completes within `timeoutMs + 500ms`.

**Verification:** `serpProbe.test.ts` green.

- [x] Implement probe
- [x] Tests green

---

### Task 4 — Candidate quality scoring

**File:** `src/main/agent/research/candidateScoring.ts` (+ test)

**Interface:**
```ts
export type ScoredCandidate = MergedCandidate & {
  qualityScore: number;
  qualityReasons: string[];
};
export function scoreCandidates(query: string, candidates: MergedCandidate[]): ScoredCandidate[];
export function pickTopX(scored: ScoredCandidate[], x: number): ScoredCandidate[];
```

**Weights** (additive, reason strings reported for debugging):
- `+max(0, 10 - bestRank)` — SERP rank inverse; rank 1 → +9, rank 10 → 0.
- `+2 per query term` matched in `title` (after lowercasing, stop-word-trimmed via existing `queryTerms`).
- `+1 per query term` matched in `snippet`.
- `+2 * (sources.length - 1)` — multi-engine agreement bonus.
- `+2` if URL path depth ≤ 3 and no more than one query string param.
- `+1` if HTTPS.
- `-2` if TLD in spam list: `.xyz`, `.top`, `.click`, `.loan`, `.work`, `.click`, `.buzz`, `.lol`.
- `-2` if snippet matches boilerplate regex `/please enable javascript|this site requires javascript|error 4\d\d|page not found/i`.
- `-3` if URL host matches `/(amp\.|\.amp\.)/`; prefer the canonical non-AMP URL.

**pickTopX:** sort by score desc, take top X; when tied, break by `bestRank` asc.

**Tests:**
- Pure docs URL on rank 1 across all 3 sources → top score.
- Low-quality spam domain with operators in URL → negative/filtered.
- Multi-source agreement bonus fires.
- Boilerplate snippet penalty.
- `pickTopX(results, 3)` returns exactly 3 in descending score order.

**Verification:** `candidateScoring.test.ts` green.

- [x] Implement scoring
- [x] Tests green

---

### Task 5 — Rewire `browser.research_search` to the new pipeline

**File:** `src/main/agent/tools/browser/index.ts` (modify `browser.research_search` execute)

**Flow:**
1. `const { sanitized, strippedOperators } = sanitizeResearchQuery(query, { preserveOperators: obj.preserveOperators === true })`.
2. `progress('probing search engines')`.
3. `const probe = await probeSerps(sanitized)`.
4. `const scored = scoreCandidates(sanitized, probe.candidates)`.
5. `const top = pickTopX(scored, maxPages)`.
6. `if (top.length === 0)` → fall back to the existing `browser.search-web` + extractSearchResults path (graceful degradation if all three SERPs are broken) OR return an empty result with clear `stopReason`. Pick based on simplicity — **graceful degradation to the old path** for safety.
7. For each top candidate in parallel: `runBrowserOperation('browser.create-tab', { url })` → `waitForBrowserSettled` → `cachePageForTab` + `extractPageEvidence` → existing `scoreEvidence` (rewritten in Task 6).
8. Auto-pin findings (unchanged logic).
9. Response payload adds: `sanitizedQuery`, `strippedOperators`, `serpProbe: { engines, candidateCount, topScored: [{url, qualityScore, qualityReasons, sources}] }`, `discarded: [{url, qualityScore}]` for candidates not in top X.

**Keep**: `mode: 'open'` path unchanged (explicit "just open Google" behavior).

**Tests:** integration test with mocked `probeSerps` + mocked `browserService` → assert top 3 URLs are navigated and response shape is correct.

**Verification:** existing research-search tests remain green; new integration test green.

- [x] Wire sanitizer + probe + scoring into execute
- [x] Keep mode:'open' path working
- [x] Integration test green

---

### Task 6 — Rewrite `scoreEvidence` + snippet hygiene

**File:** `src/main/agent/tools/browser/index.ts:194-236` (`scoreEvidence`), plus snippet helpers

**Changes:**
- Delete pricing-vocabulary bonus.
- Score inputs: when `matchSnippets` is empty, fall back to `summary` + `keyFacts` concatenated as the body text.
- New `sufficient` logic: `matchedTerms.length >= min(3, terms.length) && score >= relativeThreshold` where `relativeThreshold = max(6, 0.8 * bestScoreSeenSoFar)`. Caller passes `bestScoreSeenSoFar` in via new optional arg; default 0 for first call.
- New helper `cleanSnippet(raw: string): string`:
  - Strip leading date (`/^(?:jan|feb|...|dec)\s+\d{1,2},?\s+\d{4}\s*[-—]\s*/i`).
  - Strip leading rating (`/^[\d.]+\s*★\s*/`).
  - Strip leading result-count pattern (`/^About\s+[\d,]+\s+results.*?\)\s*/i`).
  - Collapse whitespace.
  - Cap 200 chars.
- Default `minEvidenceScore` lowered from 9 to 6 in the research_search execute.

**Tests:** expand `scoreEvidence` tests (create `scoreEvidence.test.ts` if not existing):
- Non-pricing query scores sensibly (e.g. "how to write a debounce function" on an MDN-style page clears threshold).
- Pricing query no longer gets +3 free.
- Empty `matchSnippets` + non-empty `summary` → score non-zero.
- `cleanSnippet` strips each noise pattern.

**Verification:** new test file green.

- [x] Rewrite scoreEvidence
- [x] Snippet hygiene
- [x] Tests green

---

### Task 7 — Skill + AGENTS.md prompt coaching

**Files:** `skills/browser-operation/SKILL.md`, `AGENTS.md`

**Additions:**
- `skills/browser-operation/SKILL.md`: new bullet under the research section — *"Use plain English queries. Do not prepend `site:`, `inurl:`, `intitle:`, `filetype:`, `before:`, `after:`, or similar operators unless the user explicitly asked for them. The research tool queries multiple engines and quality-scores all candidates; operator-heavy queries degrade the pool."*
- `AGENTS.md` `### Web research` section: same one-liner.

**Verification:** diff-review only; no tests.

- [x] Update skill
- [x] Update AGENTS.md

---

### Task 8 — Typecheck + full vitest + MEMORY.md note

- `npx tsc -p tsconfig.main.json --noEmit` clean.
- `npm test` — new tests green, existing tests green (or only the pre-existing `sourceValidationPolicy.test.ts` unrelated failure stays).
- `MEMORY.md` under Open Threads: new section "browser.research_search rework (2026-04-23)" with a one-paragraph summary + verification results.

- [x] Typecheck clean
- [x] Test suite green (minus known pre-existing unrelated)
- [x] MEMORY.md updated

---

## Risks & Rollback

- **Google UA-gating**: Google may start serving consent/captcha to our session. The three-engine probe with merge already mitigates this. If all three engines fail, Task 5 step 6 falls back to the existing visible-browser path — never worse than current behavior.
- **Session cookie side-effects**: `net.fetch` shares session cookies. A background fetch to google.com could update auth state. Mitigation: use a dedicated session or strip cookies from the probe request. Decision: in v1, use the default session (minor side effect, same as opening a background tab) and document it.
- **Parser brittleness**: engine HTML changes break parsers. Mitigation: fixtures are checked in; a parser regression produces zero-candidate output, not a crash. Fallback to visible-browser path keeps the tool functional until parsers get updated.
- **Rollback**: Task 5 rewiring is gated by import of new modules; reverting that single file reverts the whole feature. Tasks 1–4 new files can stay.

---

## Spec reference

No separate spec file for this one — the plan itself is the spec. Fine given scope (~600 lines new code, well-contained, testable at every step).
