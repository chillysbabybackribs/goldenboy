# Browser Capability Benchmarks

This file tracks the browser agent's capability coverage against deterministic local fixtures and public benchmark sites.

It is meant to answer four questions:

1. What browser capabilities are currently validated?
2. Which site/task validated them?
3. What primitive or tool path was expected?
4. What should we test next when a gap appears?

## Status Key

- `PASS`: validated on at least one benchmark task with explicit postcondition evidence
- `SOFT PASS`: task completed, but verification was weaker than desired
- `GAP`: missing primitive or inadequate behavior
- `NEXT`: planned benchmark, not yet run

## Current Coverage

| Capability | Benchmark Site | Task | Expected Tool Path | Status | Notes |
|---|---|---|---|---|---|
| Direct URL navigation | Public sites | Navigate to explicit URLs instead of search-box behavior | `browser.navigate` | PASS | Covered repeatedly across all benchmarks. |
| Semantic login | SauceDemo | Login with `standard_user` / `secret_sauce` | `browser.run_intent_program` -> `INTENT.LOGIN` | PASS | Hardened after React-style input issues. |
| Add to cart | SauceDemo-like flow | Add item to cart | `INTENT.ADD_TO_CART` | PASS | Validated in local checkout fixture. |
| Cart navigation | SauceDemo-like flow | Open cart | `INTENT.OPEN_CART` | PASS | Added explicit cart heuristics after false positives. |
| Checkout info form | SauceDemo-like flow | Fill first/last/postal | `INTENT.FILL_CHECKOUT_INFO` | PASS | Validated in local checkout fixture. |
| Finish order | SauceDemo-like flow | Complete checkout | `INTENT.FINISH_ORDER` | PASS | Validated in local checkout fixture. |
| Drag and drop | ExpandTesting | Drag circle into can | `browser.drag` or `INTENT.DRAG_DROP` | PASS | Public benchmark. |
| Drag and drop | The Internet | Drag box A onto box B | `browser.drag` | PASS | Public benchmark with a different DnD implementation. |
| Native click with physical coordinates | UI Testing Playground | Click challenge (`event.screenX > 0`) | `browser.click` | PASS | Fixed by adding native input + global coordinates. |
| Semantic text input | UI Testing Playground | Rename button in text input challenge | `browser.type` + `browser.click` | PASS | Public benchmark. |
| Wait for delayed content | UI Testing Playground | AJAX data challenge | `browser.click` + `browser.wait_for` | PASS | Verified without blind fixed sleep. |
| Pointer interception detection | UI Testing Playground | Hidden Layers | `browser.hit_test` + `browser.click` preflight | PASS | Second click now blocked before false success. |
| Hover / CSS `:hover` | The Internet | Hover over first profile card | `browser.hover` or `INTENT.HOVER` | PASS | Added after CSS injection workaround exposed the missing primitive. |
| JavaScript alert handling | The Internet | JS Alert accept flow | `browser.get_dialogs` + `browser.accept_dialog` | PASS | Public benchmark; modal no longer blocks the agent. |
| JavaScript confirm handling | The Internet | JS Confirm dismiss flow | `browser.get_dialogs` + `browser.dismiss_dialog` | PASS | Public benchmark; verified exact result text `You clicked: Cancel`. |
| JavaScript prompt handling | The Internet | JS Prompt accept flow with typed input | `browser.get_dialogs` + `browser.accept_dialog` | PASS | Public benchmark; prompt captured through shim backend and verified exact result text `You entered: Goldenboy`. |
| File upload | The Internet | Upload local file and verify echoed filename | `browser.upload_file` + `browser.click` | PASS | Public benchmark rerun completed with the real upload primitive and explicit filename verification. |
| New tab activation / extraction | The Internet | Open new tab and continue work there | `browser.click` + tab activation/state verification | PASS | Public benchmark opened a second tab and extracted the `New Window` heading from the active new tab. |
| Iframe reachability / extraction | The Internet | Inspect TinyMCE editor iframe and verify final content | frame inspection + `browser.evaluate_js` fallback | SOFT PASS | Same-origin iframe was reachable and content was verified, but normal click/type editing was blocked by TinyMCE read-only mode on the public page. |
| Nested frames / frameset extraction | The Internet | Read text from left/middle/right/bottom frame documents | direct extraction preferred, `browser.evaluate_js` fallback used | SOFT PASS | Legacy `<frame>` documents were detectable, but standard extraction did not traverse them and the public run only partially completed before tool limits. |
| Shadow DOM reachability / interaction | ExpandTesting | Read text and click button inside shadow root | direct extraction preferred, `browser.evaluate_js` fallback used | SOFT PASS | Shadow DOM was detected and interacted with, but only by explicitly traversing `shadowRoot` in JS; standard selector-based tools did not pierce the shadow boundary. |
| Browser download tracking | The Internet | Click downloadable files and verify they land on disk | `browser.click` + download state + filesystem verification | GAP | Public benchmark clicked file links, but the server served them as navigable/inline resources, so no browser download event fired and no file landed on disk. |
| Semantic dialog intents | Local dialog fixture | Accept prompt / dismiss confirm through VM bytecode | `browser.run_intent_program` -> `INTENT.ACCEPT_DIALOG` / `INTENT.DISMISS_DIALOG` | PASS | Deterministic local regression coverage for dialog workflows. |
| Diagnostics: console | Any failure case | Inspect console after render/action failure | `browser.get_console_events` | PASS | Tool exists and is available to agent runtime. |
| Diagnostics: network | Any failure case | Inspect failed requests after render/action failure | `browser.get_network_events` | PASS | Tool exists and is available to agent runtime. |
| Scroll into view | UI Testing Playground | Scrollbars | `browser.hit_test` + `browser.click` | SOFT PASS | Click completed, but no strong explicit page-side success signal. |

## Local Fixtures

These are deterministic regression pages we own and should keep green in CI:

| Fixture | Purpose | Primary Coverage |
|---|---|---|
| [intent-lab.html](/home/dp/Desktop/v2workspace/demo-app/public/intent-lab.html) | Basic semantic workflow | login, upload, checkout, extract |
| [checkout-lab.html](/home/dp/Desktop/v2workspace/demo-app/public/checkout-lab.html) | E-commerce flow | login, add to cart, cart, checkout info, finish order |
| [drag-lab.html](/home/dp/Desktop/v2workspace/demo-app/public/drag-lab.html) | Drag/drop | native drag support |
| [hover-lab.html](/home/dp/Desktop/v2workspace/demo-app/public/hover-lab.html) | Hover reveal | native hover support |
| [dialog-lab.html](/home/dp/Desktop/v2workspace/demo-app/public/dialog-lab.html) | Dialog semantics | accept/dismiss/prompt intent flows |

Regression coverage lives in [WebIntentVM.test.ts](/home/dp/Desktop/v2workspace/src/main/browser/WebIntentVM.test.ts).

## Public Benchmark Sites

These are the current high-value benchmark sites:

| Site | Why It Matters |
|---|---|
| `https://practice.expandtesting.com/` | Focused automation exercises with fewer irrelevant variables |
| `https://the-internet.herokuapp.com/` | Clean browser primitives: drag/drop, alerts, frames, uploads |
| `http://uitestingplayground.com/` | Adversarial automation traps: dynamic IDs, hidden layers, AJAX delays, physical click |
| `https://www.saucedemo.com/` | Realistic e-commerce flow |

## Expected Agent Policy

When a benchmark fails, the agent should:

1. Try the proper primitive first.
2. Verify the postcondition explicitly.
3. If verification fails, inspect page state.
4. If still ambiguous, inspect console and network.
5. Report the failure as a capability gap, not a vague narrative.
6. Convert the gap into either:
   - a new primitive/tool,
   - a VM opcode,
   - a stronger verifier,
   - or a local regression fixture.

## Recent Capability Upgrades

Recent commits tied directly to benchmark-driven improvements:

| Commit | Change |
|---|---|
| `213c68f` | Add real file upload browser primitive |
| `444fcd2` | Bridge prompt shim into page world |
| `54c25fb` | Add prompt dialog fallback for browser tabs |
| `f5c5ebb` | Add dialog intents to Web Intent VM |
| `5432f97` | Add JavaScript dialog browser tools |
| `79376e0` | Add native hover browser primitive |
| `3126f49` | Detect pointer interception before browser clicks |
| `3e94def` | Send global coordinates for native browser input |
| `f5edf5f` | Use native input for browser clicks |
| `361b462` | Expose browser diagnostics to agents |
| `6533dae` | Add browser drag intent support |
| `bce905b` | Expand Web Intent VM for end-to-end checkout flows |

## Next Benchmarks

These should be run next, in roughly this order:

| Priority | Capability | Site | Goal | Expected Tool Path |
|---|---|---|---|---|
| 1 | Nested frames completion | The Internet or custom fixture | Extract all frame texts deterministically without direct URL hopping or `evaluate_js` fallback | likely needs explicit frame traversal/extraction primitives |
| 2 | Download fixture rerun | Custom fixture or attachment-forcing endpoint | Trigger a real attachment download and verify it lands on disk | browser download state + filesystem verification |
| 3 | Popup/window distinction | The Internet or custom fixture | Distinguish new tab vs popup window semantics explicitly | likely needs explicit popup/window metadata |
| 4 | Shadow DOM primitive rerun | ExpandTesting or custom fixture | Revalidate shadow-root extraction and interaction without `evaluate_js` fallback | needs shadow-root traversal support |

## Prompt Templates

Use prompts in this shape when running public benchmarks:

### Primitive benchmark

```text
Navigate to <URL> and complete the <task>.

Use the proper browser primitive first. Verify the postcondition explicitly.
If the action fails or the page is ambiguous, inspect page state, then console/network diagnostics before concluding failure.

Return:
1. final URL
2. selector(s) used
3. tool result object(s)
4. verification evidence
5. any capability gap revealed
```

### VM benchmark

```text
Use browser.run_intent_program to complete the task on <URL>.

Use semantic intents where possible, then assert the postcondition.
If the run fails, inspect console/network diagnostics before finalizing.
```

## Open Gaps

These areas still need deeper work:

- Frame-aware interaction and extraction without `evaluate_js` fallbacks
- Legacy `<frame>/<frameset>` traversal and extraction
- Shadow DOM traversal
- Download verification integrated into browser benchmarks
- Explicit popup/window semantics beyond tab activation
- Stronger success verification for tasks with no explicit UI confirmation
- Formal benchmark runner or scripted benchmark harness
