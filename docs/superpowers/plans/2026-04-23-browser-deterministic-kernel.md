# Browser Deterministic Kernel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the L3 deterministic kernel described in `docs/superpowers/specs/2026-04-23-browser-deterministic-kernel-design.md`, validated by a new `deterministic` opt-in on the existing `browser.open_tab` tool.

**Architecture:** A pure, dependency-injected `DeterministicKernel` class holds a per-tab registry of applied pins. Each pin is a small `{ apply, revert }` module that talks only to a narrow `KernelCapabilities` interface. One Electron adapter implements `KernelCapabilities` in terms of `webContents.debugger` (CDP), `session.webRequest`, `session.setUserAgent`, and `webContents.insertCSS`. The kernel has zero Electron imports and is fully unit-testable with fakes.

**Tech Stack:** TypeScript, Electron (`webContents`, `session`, `webContents.debugger`), Vitest, mulberry32 PRNG, CSS injection.

---

## Spec ↔ Plan Map (for reviewers)

| Spec section | Covered by |
|---|---|
| Data shapes | Task 1 |
| Public API (`enter`/`exit`/`getState`/`isDeterministic`) + rollback | Task 2 |
| Pins #1, #6, #8 (userAgent, disableAnimations, networkBlocklist) | Task 3 |
| Pins #2, #3, #4, #5 (viewport, locale, timezone, reduceMotion) | Task 4 |
| Pin #7 (seed + clock preload script) | Task 5 |
| Electron adapter (L2 → `KernelCapabilities`) | Task 6 |
| `openTabDeterministic` integration (opt-in `deterministic` input) | Task 7 |
| Tool-layer wiring + response payload | Task 8 |
| Manual verification + skill doc update | Task 9 |

---

## File Structure

**New files:**

```
src/main/browser/determinism/
  kernelTypes.ts                      — pure types (DeterminismConfig, DeterministicTabState, KernelResult, KernelError)
  kernelCapabilities.ts               — KernelCapabilities interface
  DeterministicKernel.ts              — kernel class (no Electron imports)
  DeterministicKernel.test.ts         — kernel unit tests with fake capabilities
  pins/
    userAgentPin.ts                   — pin #1
    userAgentPin.test.ts
    visualPin.ts                      — pins #5 + #6 (reduceMotion + disableAnimations)
    visualPin.test.ts
    networkBlocklistPin.ts            — pin #8
    networkBlocklistPin.test.ts
    viewportPin.ts                    — pin #2
    viewportPin.test.ts
    localeTimezonePin.ts              — pins #3 + #4
    localeTimezonePin.test.ts
    seedAndClockPin.ts                — pin #7 + preload script template
    seedAndClockPin.test.ts
    seedAndClockPinScript.test.ts     — pure JS test of the injected script body
  adapters/
    electronKernelCapabilities.ts     — the only file that imports Electron
```

**Modified files:**

```
src/main/agent/tools/browser/openTabDeterministic.ts        — add `deterministic` input + kernel hook
src/main/agent/tools/browser/openTabDeterministic.test.ts   — cover the new input
src/main/agent/tools/browser/index.ts                       — construct kernel singleton, pass to tool
skills/browser-operation/SKILL.md                           — mention `deterministic` option
```

---

## Task 1: Types and capability interface

**Files:**
- Create: `src/main/browser/determinism/kernelTypes.ts`
- Create: `src/main/browser/determinism/kernelCapabilities.ts`

No tests in this task — these are pure declarations. The first real tests live in Task 2.

- [ ] **Step 1: Create `kernelTypes.ts`**

```ts
// src/main/browser/determinism/kernelTypes.ts

export type ClockSpec = 'frozen' | number;

export interface DeterminismConfig {
  seed?: number;
  clock?: ClockSpec;
  viewport?: { width: number; height: number; deviceScaleFactor?: number };
  locale?: string;
  timezone?: string;
  userAgent?: string;
  disableAnimations?: boolean;
  reduceMotion?: boolean;
  blockNetworkPatterns?: string[];
}

export interface ResolvedDeterminismConfig {
  seed: number;
  clock: ClockSpec;
  viewport: { width: number; height: number; deviceScaleFactor: number };
  locale: string;
  timezone: string;
  userAgent: string | null;
  disableAnimations: boolean;
  reduceMotion: boolean;
  blockNetworkPatterns: string[];
}

export interface PinHandle {
  name: string;
  revert: () => Promise<void> | void;
}

export interface DeterministicTabState {
  tabId: string;
  config: ResolvedDeterminismConfig;
  enteredAt: number;
  pinHandles: PinHandle[];
}

export interface KernelResult {
  tabId: string;
  pinsApplied: string[];
  enteredAt: number;
}

export interface KernelExitReport {
  tabId: string;
  pinsReverted: string[];
  errors: Array<{ pin: string; message: string }>;
}

export class KernelError extends Error {
  readonly pin: string;
  readonly applied: string[];
  readonly reverted: string[];

  constructor(message: string, pin: string, applied: string[], reverted: string[]) {
    super(message);
    this.name = 'KernelError';
    this.pin = pin;
    this.applied = applied;
    this.reverted = reverted;
  }
}

export const DEFAULT_CONFIG: ResolvedDeterminismConfig = {
  seed: 1,
  clock: 'frozen',
  viewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
  locale: 'en-US',
  timezone: 'UTC',
  userAgent: null,
  disableAnimations: true,
  reduceMotion: true,
  blockNetworkPatterns: [],
};

export function resolveConfig(input: DeterminismConfig | undefined): ResolvedDeterminismConfig {
  const src = input ?? {};
  return {
    seed: src.seed ?? DEFAULT_CONFIG.seed,
    clock: src.clock ?? DEFAULT_CONFIG.clock,
    viewport: {
      width: src.viewport?.width ?? DEFAULT_CONFIG.viewport.width,
      height: src.viewport?.height ?? DEFAULT_CONFIG.viewport.height,
      deviceScaleFactor: src.viewport?.deviceScaleFactor ?? DEFAULT_CONFIG.viewport.deviceScaleFactor,
    },
    locale: src.locale ?? DEFAULT_CONFIG.locale,
    timezone: src.timezone ?? DEFAULT_CONFIG.timezone,
    userAgent: src.userAgent ?? DEFAULT_CONFIG.userAgent,
    disableAnimations: src.disableAnimations ?? DEFAULT_CONFIG.disableAnimations,
    reduceMotion: src.reduceMotion ?? DEFAULT_CONFIG.reduceMotion,
    blockNetworkPatterns: src.blockNetworkPatterns ?? DEFAULT_CONFIG.blockNetworkPatterns,
  };
}
```

- [ ] **Step 2: Create `kernelCapabilities.ts`**

```ts
// src/main/browser/determinism/kernelCapabilities.ts

export interface CdpHandle {
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  detach: () => Promise<void>;
}

export interface KernelCapabilities {
  attachCdp(tabId: string): Promise<CdpHandle>;

  setUserAgent(tabId: string, userAgent: string): Promise<string>;
  restoreUserAgent(tabId: string, previous: string): Promise<void>;

  insertCss(tabId: string, css: string): Promise<string>;
  removeInsertedCss(tabId: string, cssKey: string): Promise<void>;

  setViewport(tabId: string, viewport: { width: number; height: number; deviceScaleFactor: number }): Promise<void>;
  clearViewport(tabId: string): Promise<void>;

  registerRequestBlocker(tabId: string, patterns: string[]): Promise<{ dispose: () => void }>;

  isTabAlive(tabId: string): boolean;
}
```

- [ ] **Step 3: Run TypeScript check**

Run: `npx tsc -p tsconfig.main.json --noEmit`
Expected: PASS (0 errors). These files have no dependencies yet.

- [ ] **Step 4: Commit**

```bash
git add src/main/browser/determinism/kernelTypes.ts src/main/browser/determinism/kernelCapabilities.ts
git commit -m "feat(determinism): scaffold kernel types and capability interface"
```

---

## Task 2: Kernel class — enter / exit / rollback

**Files:**
- Create: `src/main/browser/determinism/DeterministicKernel.ts`
- Create: `src/main/browser/determinism/DeterministicKernel.test.ts`

This task defines the kernel without any real pins yet. We inject a stub pin list so we can test rollback, idempotency, and registry behavior in isolation.

- [ ] **Step 1: Write failing kernel tests**

Create `DeterministicKernel.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { DeterministicKernel } from './DeterministicKernel';
import type { Pin } from './DeterministicKernel';
import type { KernelCapabilities } from './kernelCapabilities';
import type { ResolvedDeterminismConfig } from './kernelTypes';
import { KernelError } from './kernelTypes';

function makeCaps(overrides: Partial<KernelCapabilities> = {}): KernelCapabilities {
  return {
    attachCdp: vi.fn(async () => ({ send: vi.fn(async () => ({})), detach: vi.fn(async () => {}) })),
    setUserAgent: vi.fn(async () => 'prev-ua'),
    restoreUserAgent: vi.fn(async () => {}),
    insertCss: vi.fn(async () => 'css-key'),
    removeInsertedCss: vi.fn(async () => {}),
    setViewport: vi.fn(async () => {}),
    clearViewport: vi.fn(async () => {}),
    registerRequestBlocker: vi.fn(async () => ({ dispose: vi.fn() })),
    isTabAlive: vi.fn(() => true),
    ...overrides,
  };
}

function makePin(name: string, behavior: 'ok' | 'throw' = 'ok'): Pin {
  const revert = vi.fn(async () => {});
  const apply = vi.fn(async () => {
    if (behavior === 'throw') throw new Error(`${name} exploded`);
    return { name, revert };
  });
  return { name, apply } as Pin;
}

describe('DeterministicKernel', () => {
  it('enter applies pins in order and records state', async () => {
    const caps = makeCaps();
    const pins = [makePin('a'), makePin('b'), makePin('c')];
    const kernel = new DeterministicKernel({ capabilities: caps, pins });

    const result = await kernel.enter('tab_1', {});

    expect(result.pinsApplied).toEqual(['a', 'b', 'c']);
    expect(kernel.isDeterministic('tab_1')).toBe(true);
    expect(kernel.getState('tab_1')?.pinHandles.map(h => h.name)).toEqual(['a', 'b', 'c']);
  });

  it('exit reverts pins in reverse order and clears registry', async () => {
    const order: string[] = [];
    const mk = (name: string): Pin => ({
      name,
      apply: async () => ({ name, revert: async () => { order.push(name); } }),
    });
    const kernel = new DeterministicKernel({ capabilities: makeCaps(), pins: [mk('a'), mk('b'), mk('c')] });

    await kernel.enter('tab_1', {});
    await kernel.exit('tab_1');

    expect(order).toEqual(['c', 'b', 'a']);
    expect(kernel.isDeterministic('tab_1')).toBe(false);
    expect(kernel.getState('tab_1')).toBeNull();
  });

  it('partial failure rolls back already-applied pins and throws KernelError', async () => {
    const reverted: string[] = [];
    const okPin = (name: string): Pin => ({
      name,
      apply: async () => ({ name, revert: async () => { reverted.push(name); } }),
    });
    const kernel = new DeterministicKernel({
      capabilities: makeCaps(),
      pins: [okPin('a'), okPin('b'), makePin('c', 'throw')],
    });

    await expect(kernel.enter('tab_1', {})).rejects.toBeInstanceOf(KernelError);
    expect(reverted).toEqual(['b', 'a']);
    expect(kernel.isDeterministic('tab_1')).toBe(false);
  });

  it('enter is idempotent for identical config (no-op second call)', async () => {
    const pinA = makePin('a');
    const kernel = new DeterministicKernel({ capabilities: makeCaps(), pins: [pinA] });

    await kernel.enter('tab_1', { seed: 7 });
    await kernel.enter('tab_1', { seed: 7 });

    expect(pinA.apply).toHaveBeenCalledTimes(1);
  });

  it('enter with different config exits first then re-applies', async () => {
    const pinA = makePin('a');
    const kernel = new DeterministicKernel({ capabilities: makeCaps(), pins: [pinA] });

    await kernel.enter('tab_1', { seed: 7 });
    await kernel.enter('tab_1', { seed: 8 });

    expect(pinA.apply).toHaveBeenCalledTimes(2);
    expect(kernel.getState('tab_1')?.config.seed).toBe(8);
  });

  it('exit on unknown tab is a no-op', async () => {
    const kernel = new DeterministicKernel({ capabilities: makeCaps(), pins: [] });
    await expect(kernel.exit('ghost')).resolves.toEqual({
      tabId: 'ghost',
      pinsReverted: [],
      errors: [],
    });
  });

  it('exit collects per-pin revert errors without throwing', async () => {
    const bomb = (name: string): Pin => ({
      name,
      apply: async () => ({ name, revert: async () => { throw new Error(`revert-${name}`); } }),
    });
    const kernel = new DeterministicKernel({ capabilities: makeCaps(), pins: [bomb('a'), bomb('b')] });

    await kernel.enter('tab_1', {});
    const report = await kernel.exit('tab_1');

    expect(report.errors.map(e => e.pin).sort()).toEqual(['a', 'b']);
    expect(kernel.isDeterministic('tab_1')).toBe(false);
  });

  it('purgeTab removes registry entry without running reverts (use for tab-closed events)', async () => {
    const revert = vi.fn();
    const pin: Pin = {
      name: 'a',
      apply: async () => ({ name: 'a', revert }),
    };
    const kernel = new DeterministicKernel({ capabilities: makeCaps(), pins: [pin] });

    await kernel.enter('tab_1', {});
    kernel.purgeTab('tab_1');

    expect(revert).not.toHaveBeenCalled();
    expect(kernel.isDeterministic('tab_1')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/browser/determinism/DeterministicKernel.test.ts`
Expected: FAIL with module-not-found or "class DeterministicKernel not exported".

- [ ] **Step 3: Implement the kernel**

Create `DeterministicKernel.ts`:

```ts
import type { KernelCapabilities } from './kernelCapabilities';
import {
  DeterminismConfig,
  DeterministicTabState,
  KernelError,
  KernelExitReport,
  KernelResult,
  PinHandle,
  ResolvedDeterminismConfig,
  resolveConfig,
} from './kernelTypes';

export interface PinContext {
  tabId: string;
  config: ResolvedDeterminismConfig;
  capabilities: KernelCapabilities;
}

export interface Pin {
  name: string;
  apply: (ctx: PinContext) => Promise<PinHandle>;
}

export interface DeterministicKernelOptions {
  capabilities: KernelCapabilities;
  pins: readonly Pin[];
  now?: () => number;
}

export class DeterministicKernel {
  private readonly capabilities: KernelCapabilities;
  private readonly pins: readonly Pin[];
  private readonly now: () => number;
  private readonly registry = new Map<string, DeterministicTabState>();

  constructor(opts: DeterministicKernelOptions) {
    this.capabilities = opts.capabilities;
    this.pins = opts.pins;
    this.now = opts.now ?? (() => Date.now());
  }

  isDeterministic(tabId: string): boolean {
    return this.registry.has(tabId);
  }

  getState(tabId: string): DeterministicTabState | null {
    return this.registry.get(tabId) ?? null;
  }

  async enter(tabId: string, input: DeterminismConfig | undefined): Promise<KernelResult> {
    const resolved = resolveConfig(input);
    const existing = this.registry.get(tabId);
    if (existing && configsEqual(existing.config, resolved)) {
      return { tabId, pinsApplied: existing.pinHandles.map(h => h.name), enteredAt: existing.enteredAt };
    }
    if (existing) {
      await this.exit(tabId);
    }

    const ctx: PinContext = { tabId, config: resolved, capabilities: this.capabilities };
    const applied: PinHandle[] = [];
    for (const pin of this.pins) {
      try {
        const handle = await pin.apply(ctx);
        applied.push(handle);
      } catch (err) {
        const reverted: string[] = [];
        for (let i = applied.length - 1; i >= 0; i--) {
          try { await applied[i].revert(); reverted.push(applied[i].name); } catch { /* swallow during rollback */ }
        }
        const message = err instanceof Error ? err.message : String(err);
        throw new KernelError(
          `pin "${pin.name}" failed: ${message}`,
          pin.name,
          applied.map(h => h.name),
          reverted,
        );
      }
    }

    const enteredAt = this.now();
    this.registry.set(tabId, { tabId, config: resolved, enteredAt, pinHandles: applied });
    return { tabId, pinsApplied: applied.map(h => h.name), enteredAt };
  }

  async exit(tabId: string): Promise<KernelExitReport> {
    const state = this.registry.get(tabId);
    if (!state) return { tabId, pinsReverted: [], errors: [] };

    const pinsReverted: string[] = [];
    const errors: KernelExitReport['errors'] = [];
    for (let i = state.pinHandles.length - 1; i >= 0; i--) {
      const handle = state.pinHandles[i];
      try {
        await handle.revert();
        pinsReverted.push(handle.name);
      } catch (err) {
        errors.push({ pin: handle.name, message: err instanceof Error ? err.message : String(err) });
      }
    }
    this.registry.delete(tabId);
    return { tabId, pinsReverted, errors };
  }

  purgeTab(tabId: string): void {
    this.registry.delete(tabId);
  }
}

function configsEqual(a: ResolvedDeterminismConfig, b: ResolvedDeterminismConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/browser/determinism/DeterministicKernel.test.ts`
Expected: PASS (8/8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/browser/determinism/DeterministicKernel.ts src/main/browser/determinism/DeterministicKernel.test.ts
git commit -m "feat(determinism): implement DeterministicKernel with rollback and idempotency"
```

---

## Task 3: No-CDP pins — userAgent, visual, networkBlocklist

**Files:**
- Create: `src/main/browser/determinism/pins/userAgentPin.ts`
- Create: `src/main/browser/determinism/pins/userAgentPin.test.ts`
- Create: `src/main/browser/determinism/pins/visualPin.ts`
- Create: `src/main/browser/determinism/pins/visualPin.test.ts`
- Create: `src/main/browser/determinism/pins/networkBlocklistPin.ts`
- Create: `src/main/browser/determinism/pins/networkBlocklistPin.test.ts`

These three pins use no CDP — purely `session.setUserAgent`, `webContents.insertCSS`, and `session.webRequest`. Fastest to ship.

- [ ] **Step 1: Write failing userAgent pin test**

Create `userAgentPin.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { userAgentPin } from './userAgentPin';
import type { PinContext } from '../DeterministicKernel';
import { resolveConfig } from '../kernelTypes';

function makeCtx(overrides: Partial<PinContext['capabilities']> = {}, userAgent: string | null = 'test-ua'): PinContext {
  const config = resolveConfig({ userAgent: userAgent ?? undefined });
  return {
    tabId: 'tab_1',
    config,
    capabilities: {
      attachCdp: vi.fn(),
      setUserAgent: vi.fn(async () => 'prev-ua'),
      restoreUserAgent: vi.fn(async () => {}),
      insertCss: vi.fn(),
      removeInsertedCss: vi.fn(),
      setViewport: vi.fn(),
      clearViewport: vi.fn(),
      registerRequestBlocker: vi.fn(),
      isTabAlive: vi.fn(() => true),
      ...overrides,
    } as PinContext['capabilities'],
  };
}

describe('userAgentPin', () => {
  it('applies the configured user agent and reverts to the previous one', async () => {
    const ctx = makeCtx({}, 'goldenboy-ua');
    const handle = await userAgentPin.apply(ctx);
    expect(ctx.capabilities.setUserAgent).toHaveBeenCalledWith('tab_1', 'goldenboy-ua');
    await handle.revert();
    expect(ctx.capabilities.restoreUserAgent).toHaveBeenCalledWith('tab_1', 'prev-ua');
  });

  it('is a no-op when userAgent is null in config', async () => {
    const ctx = makeCtx({}, null);
    const handle = await userAgentPin.apply(ctx);
    expect(ctx.capabilities.setUserAgent).not.toHaveBeenCalled();
    await handle.revert();
    expect(ctx.capabilities.restoreUserAgent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/browser/determinism/pins/userAgentPin.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `userAgentPin.ts`**

```ts
import type { Pin } from '../DeterministicKernel';

export const userAgentPin: Pin = {
  name: 'userAgent',
  async apply({ tabId, config, capabilities }) {
    if (!config.userAgent) {
      return { name: 'userAgent', revert: () => Promise.resolve() };
    }
    const previous = await capabilities.setUserAgent(tabId, config.userAgent);
    return {
      name: 'userAgent',
      revert: () => capabilities.restoreUserAgent(tabId, previous),
    };
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/browser/determinism/pins/userAgentPin.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Write failing visual pin test**

Create `visualPin.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { visualPin } from './visualPin';
import type { PinContext } from '../DeterministicKernel';
import { resolveConfig } from '../kernelTypes';

function makeCtx(overrides: Partial<import('../kernelTypes').DeterminismConfig> = {}): PinContext {
  const insertCss = vi.fn(async () => 'css-123');
  const removeInsertedCss = vi.fn(async () => {});
  return {
    tabId: 'tab_1',
    config: resolveConfig(overrides),
    capabilities: {
      attachCdp: vi.fn(),
      setUserAgent: vi.fn(),
      restoreUserAgent: vi.fn(),
      insertCss,
      removeInsertedCss,
      setViewport: vi.fn(),
      clearViewport: vi.fn(),
      registerRequestBlocker: vi.fn(),
      isTabAlive: vi.fn(() => true),
    } as PinContext['capabilities'],
  };
}

describe('visualPin', () => {
  it('injects zero-duration CSS when disableAnimations is true and reverts with the returned key', async () => {
    const ctx = makeCtx({ disableAnimations: true, reduceMotion: false });
    const handle = await visualPin.apply(ctx);
    const css = (ctx.capabilities.insertCss as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(css).toMatch(/animation-duration:\s*0s/);
    expect(css).toMatch(/transition-duration:\s*0s/);
    await handle.revert();
    expect(ctx.capabilities.removeInsertedCss).toHaveBeenCalledWith('tab_1', 'css-123');
  });

  it('does not inject CSS when both disableAnimations and reduceMotion are false', async () => {
    const ctx = makeCtx({ disableAnimations: false, reduceMotion: false });
    const handle = await visualPin.apply(ctx);
    expect(ctx.capabilities.insertCss).not.toHaveBeenCalled();
    await handle.revert();
    expect(ctx.capabilities.removeInsertedCss).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run test to verify fails**

Run: `npx vitest run src/main/browser/determinism/pins/visualPin.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 7: Implement `visualPin.ts`**

```ts
import type { Pin } from '../DeterministicKernel';

const ANIMATIONS_OFF_CSS = `
*, *::before, *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  scroll-behavior: auto !important;
}
`.trim();

export const visualPin: Pin = {
  name: 'visual',
  async apply({ tabId, config, capabilities }) {
    if (!config.disableAnimations && !config.reduceMotion) {
      return { name: 'visual', revert: () => Promise.resolve() };
    }
    if (config.disableAnimations) {
      const key = await capabilities.insertCss(tabId, ANIMATIONS_OFF_CSS);
      return {
        name: 'visual',
        revert: () => capabilities.removeInsertedCss(tabId, key),
      };
    }
    return { name: 'visual', revert: () => Promise.resolve() };
  },
};
```

Note: `reduceMotion` is honored via CDP `Emulation.setEmulatedMedia` in Task 4's CDP pins; this pin handles the CSS half only. If `disableAnimations` is false but `reduceMotion` is true, the CDP pin carries it.

- [ ] **Step 8: Run tests**

Run: `npx vitest run src/main/browser/determinism/pins/visualPin.test.ts`
Expected: PASS (2/2).

- [ ] **Step 9: Write failing networkBlocklist pin test**

Create `networkBlocklistPin.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { networkBlocklistPin } from './networkBlocklistPin';
import type { PinContext } from '../DeterministicKernel';
import { resolveConfig } from '../kernelTypes';

function makeCtx(patterns: string[]): PinContext {
  const dispose = vi.fn();
  return {
    tabId: 'tab_1',
    config: resolveConfig({ blockNetworkPatterns: patterns }),
    capabilities: {
      attachCdp: vi.fn(),
      setUserAgent: vi.fn(),
      restoreUserAgent: vi.fn(),
      insertCss: vi.fn(),
      removeInsertedCss: vi.fn(),
      setViewport: vi.fn(),
      clearViewport: vi.fn(),
      registerRequestBlocker: vi.fn(async () => ({ dispose })),
      isTabAlive: vi.fn(() => true),
    } as PinContext['capabilities'],
  };
}

describe('networkBlocklistPin', () => {
  it('registers the blocker with exact patterns and disposes on revert', async () => {
    const ctx = makeCtx(['https://*.doubleclick.net/*', 'https://ga.jspm.io/*']);
    const handle = await networkBlocklistPin.apply(ctx);
    expect(ctx.capabilities.registerRequestBlocker).toHaveBeenCalledWith('tab_1', [
      'https://*.doubleclick.net/*',
      'https://ga.jspm.io/*',
    ]);
    await handle.revert();
    const firstCall = (ctx.capabilities.registerRequestBlocker as ReturnType<typeof vi.fn>).mock.results[0].value;
    const blocker = await firstCall;
    expect(blocker.dispose).toHaveBeenCalled();
  });

  it('does not register a blocker when patterns is empty', async () => {
    const ctx = makeCtx([]);
    await networkBlocklistPin.apply(ctx);
    expect(ctx.capabilities.registerRequestBlocker).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 10: Run test, verify fails**

Run: `npx vitest run src/main/browser/determinism/pins/networkBlocklistPin.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 11: Implement `networkBlocklistPin.ts`**

```ts
import type { Pin } from '../DeterministicKernel';

export const networkBlocklistPin: Pin = {
  name: 'networkBlocklist',
  async apply({ tabId, config, capabilities }) {
    if (config.blockNetworkPatterns.length === 0) {
      return { name: 'networkBlocklist', revert: () => Promise.resolve() };
    }
    const blocker = await capabilities.registerRequestBlocker(tabId, config.blockNetworkPatterns);
    return {
      name: 'networkBlocklist',
      revert: () => { blocker.dispose(); return Promise.resolve(); },
    };
  },
};
```

- [ ] **Step 12: Run tests**

Run: `npx vitest run src/main/browser/determinism/pins/networkBlocklistPin.test.ts`
Expected: PASS (2/2).

- [ ] **Step 13: Commit**

```bash
git add src/main/browser/determinism/pins/userAgentPin.ts \
        src/main/browser/determinism/pins/userAgentPin.test.ts \
        src/main/browser/determinism/pins/visualPin.ts \
        src/main/browser/determinism/pins/visualPin.test.ts \
        src/main/browser/determinism/pins/networkBlocklistPin.ts \
        src/main/browser/determinism/pins/networkBlocklistPin.test.ts
git commit -m "feat(determinism): add userAgent, visual, and networkBlocklist pins"
```

---

## Task 4: CDP pins — viewport, localeTimezone, reduceMotion

**Files:**
- Create: `src/main/browser/determinism/pins/viewportPin.ts`
- Create: `src/main/browser/determinism/pins/viewportPin.test.ts`
- Create: `src/main/browser/determinism/pins/localeTimezonePin.ts`
- Create: `src/main/browser/determinism/pins/localeTimezonePin.test.ts`

These pins require a live CDP attach. The `visualPin` from Task 3 handled the CSS half of `reduceMotion`; the `localeTimezonePin` here also handles the CDP `Emulation.setEmulatedMedia` half so `prefers-reduced-motion` reports correctly to `matchMedia`.

- [ ] **Step 1: Write failing viewport pin test**

Create `viewportPin.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { viewportPin } from './viewportPin';
import type { PinContext } from '../DeterministicKernel';
import { resolveConfig } from '../kernelTypes';

function makeCtx(): { ctx: PinContext; setViewport: ReturnType<typeof vi.fn>; clearViewport: ReturnType<typeof vi.fn>; cdpSend: ReturnType<typeof vi.fn> } {
  const setViewport = vi.fn(async () => {});
  const clearViewport = vi.fn(async () => {});
  const cdpSend = vi.fn(async () => ({}));
  const ctx: PinContext = {
    tabId: 'tab_1',
    config: resolveConfig({ viewport: { width: 1024, height: 768, deviceScaleFactor: 2 } }),
    capabilities: {
      attachCdp: vi.fn(async () => ({ send: cdpSend, detach: vi.fn(async () => {}) })),
      setUserAgent: vi.fn(),
      restoreUserAgent: vi.fn(),
      insertCss: vi.fn(),
      removeInsertedCss: vi.fn(),
      setViewport,
      clearViewport,
      registerRequestBlocker: vi.fn(),
      isTabAlive: vi.fn(() => true),
    } as PinContext['capabilities'],
  };
  return { ctx, setViewport, clearViewport, cdpSend };
}

describe('viewportPin', () => {
  it('applies the configured viewport and reverts by clearing', async () => {
    const { ctx, setViewport, clearViewport } = makeCtx();
    const handle = await viewportPin.apply(ctx);
    expect(setViewport).toHaveBeenCalledWith('tab_1', { width: 1024, height: 768, deviceScaleFactor: 2 });
    await handle.revert();
    expect(clearViewport).toHaveBeenCalledWith('tab_1');
  });
});
```

- [ ] **Step 2: Verify fails**

Run: `npx vitest run src/main/browser/determinism/pins/viewportPin.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `viewportPin.ts`**

```ts
import type { Pin } from '../DeterministicKernel';

export const viewportPin: Pin = {
  name: 'viewport',
  async apply({ tabId, config, capabilities }) {
    await capabilities.setViewport(tabId, config.viewport);
    return {
      name: 'viewport',
      revert: () => capabilities.clearViewport(tabId),
    };
  },
};
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/main/browser/determinism/pins/viewportPin.test.ts`
Expected: PASS (1/1).

- [ ] **Step 5: Write failing localeTimezone pin test**

Create `localeTimezonePin.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { localeTimezonePin } from './localeTimezonePin';
import type { PinContext } from '../DeterministicKernel';
import { resolveConfig } from '../kernelTypes';

describe('localeTimezonePin', () => {
  it('sends Emulation.setLocaleOverride + setTimezoneOverride + setEmulatedMedia, and reverts all three', async () => {
    const send = vi.fn(async () => ({}));
    const detach = vi.fn(async () => {});
    const attach = vi.fn(async () => ({ send, detach }));
    const ctx: PinContext = {
      tabId: 'tab_1',
      config: resolveConfig({ locale: 'fr-FR', timezone: 'Europe/Paris', reduceMotion: true }),
      capabilities: {
        attachCdp: attach,
        setUserAgent: vi.fn(),
        restoreUserAgent: vi.fn(),
        insertCss: vi.fn(),
        removeInsertedCss: vi.fn(),
        setViewport: vi.fn(),
        clearViewport: vi.fn(),
        registerRequestBlocker: vi.fn(),
        isTabAlive: vi.fn(() => true),
      } as PinContext['capabilities'],
    };

    const handle = await localeTimezonePin.apply(ctx);
    const methodsCalled = send.mock.calls.map(c => c[0]);
    expect(methodsCalled).toContain('Emulation.setLocaleOverride');
    expect(methodsCalled).toContain('Emulation.setTimezoneOverride');
    expect(methodsCalled).toContain('Emulation.setEmulatedMedia');

    await handle.revert();
    const revertMethods = send.mock.calls.slice(3).map(c => c[0]);
    expect(revertMethods).toEqual([
      'Emulation.setLocaleOverride',
      'Emulation.setTimezoneOverride',
      'Emulation.setEmulatedMedia',
    ]);
    expect(send.mock.calls[3][1]).toEqual({ locale: '' });
    expect(send.mock.calls[4][1]).toEqual({ timezoneId: '' });
    expect(send.mock.calls[5][1]).toEqual({ features: [] });
  });

  it('skips setEmulatedMedia when reduceMotion is false', async () => {
    const send = vi.fn(async () => ({}));
    const attach = vi.fn(async () => ({ send, detach: vi.fn(async () => {}) }));
    const ctx: PinContext = {
      tabId: 'tab_1',
      config: resolveConfig({ reduceMotion: false }),
      capabilities: {
        attachCdp: attach,
        setUserAgent: vi.fn(),
        restoreUserAgent: vi.fn(),
        insertCss: vi.fn(),
        removeInsertedCss: vi.fn(),
        setViewport: vi.fn(),
        clearViewport: vi.fn(),
        registerRequestBlocker: vi.fn(),
        isTabAlive: vi.fn(() => true),
      } as PinContext['capabilities'],
    };

    await localeTimezonePin.apply(ctx);
    const methods = send.mock.calls.map(c => c[0]);
    expect(methods).not.toContain('Emulation.setEmulatedMedia');
  });
});
```

- [ ] **Step 6: Verify fails**

Run: `npx vitest run src/main/browser/determinism/pins/localeTimezonePin.test.ts`
Expected: FAIL.

- [ ] **Step 7: Implement `localeTimezonePin.ts`**

```ts
import type { Pin } from '../DeterministicKernel';

export const localeTimezonePin: Pin = {
  name: 'localeTimezone',
  async apply({ tabId, config, capabilities }) {
    const cdp = await capabilities.attachCdp(tabId);
    await cdp.send('Emulation.setLocaleOverride', { locale: config.locale });
    await cdp.send('Emulation.setTimezoneOverride', { timezoneId: config.timezone });
    if (config.reduceMotion) {
      await cdp.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
      });
    }
    return {
      name: 'localeTimezone',
      revert: async () => {
        await cdp.send('Emulation.setLocaleOverride', { locale: '' });
        await cdp.send('Emulation.setTimezoneOverride', { timezoneId: '' });
        await cdp.send('Emulation.setEmulatedMedia', { features: [] });
      },
    };
  },
};
```

- [ ] **Step 8: Run tests**

Run: `npx vitest run src/main/browser/determinism/pins/localeTimezonePin.test.ts`
Expected: PASS (2/2).

- [ ] **Step 9: Commit**

```bash
git add src/main/browser/determinism/pins/viewportPin.ts \
        src/main/browser/determinism/pins/viewportPin.test.ts \
        src/main/browser/determinism/pins/localeTimezonePin.ts \
        src/main/browser/determinism/pins/localeTimezonePin.test.ts
git commit -m "feat(determinism): add viewport and locale/timezone CDP pins"
```

---

## Task 5: Seed + clock pin (preload script)

**Files:**
- Create: `src/main/browser/determinism/pins/seedAndClockPin.ts`
- Create: `src/main/browser/determinism/pins/seedAndClockPin.test.ts`
- Create: `src/main/browser/determinism/pins/seedAndClockPinScript.test.ts`

The pin has two testable surfaces: (a) the wiring (does it send `Page.addScriptToEvaluateOnNewDocument` with a templated body, and `removeScriptToEvaluateOnNewDocument` on revert?) and (b) the script body itself (does the templated script, when evaluated, produce a seeded `Math.random` and a pinned `Date`?). Both are testable as pure JS.

- [ ] **Step 1: Write failing wiring test**

Create `seedAndClockPin.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { seedAndClockPin } from './seedAndClockPin';
import type { PinContext } from '../DeterministicKernel';
import { resolveConfig } from '../kernelTypes';

describe('seedAndClockPin (wiring)', () => {
  it('registers a document-start script and removes it on revert', async () => {
    const send = vi.fn(async (method: string) => {
      if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: 'script_42' };
      return {};
    });
    const ctx: PinContext = {
      tabId: 'tab_1',
      config: resolveConfig({ seed: 12345, clock: 1700000000000 }),
      capabilities: {
        attachCdp: vi.fn(async () => ({ send, detach: vi.fn(async () => {}) })),
        setUserAgent: vi.fn(), restoreUserAgent: vi.fn(),
        insertCss: vi.fn(), removeInsertedCss: vi.fn(),
        setViewport: vi.fn(), clearViewport: vi.fn(),
        registerRequestBlocker: vi.fn(),
        isTabAlive: vi.fn(() => true),
      } as PinContext['capabilities'],
    };

    const handle = await seedAndClockPin.apply(ctx);
    const addCall = send.mock.calls.find(c => c[0] === 'Page.addScriptToEvaluateOnNewDocument');
    expect(addCall).toBeDefined();
    const source = (addCall![1] as { source: string }).source;
    expect(source).toContain('12345');
    expect(source).toContain('1700000000000');
    expect(source).toContain('Math.random');

    await handle.revert();
    const removeCall = send.mock.calls.find(c => c[0] === 'Page.removeScriptToEvaluateOnNewDocument');
    expect(removeCall![1]).toEqual({ identifier: 'script_42' });
  });
});
```

- [ ] **Step 2: Write failing script-body test**

Create `seedAndClockPinScript.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildDeterministicPreloadScript } from './seedAndClockPin';

function evalScript(script: string): typeof globalThis {
  const sandbox: Record<string, unknown> = {};
  const glob = {
    Math: { ...Math },
    Date,
    performance: { now: () => 1000 },
    Object,
    console,
  } as unknown as typeof globalThis;
  const wrapped = `(function(globalThis){${script}; return globalThis;})(sandbox);`;
  const fn = new Function('sandbox', `
    const { Math, Date, performance, Object, console } = arguments[0];
    ${script};
    return { Math, Date, performance };
  `);
  return fn(glob) as typeof globalThis;
}

describe('deterministic preload script (pure JS)', () => {
  it('produces a seeded deterministic Math.random sequence', () => {
    const script = buildDeterministicPreloadScript({ seed: 42, clock: 'frozen', clockBase: 1_700_000_000_000 });
    const a = evalScript(script);
    const b = evalScript(script);
    const seqA = [a.Math.random(), a.Math.random(), a.Math.random()];
    const seqB = [b.Math.random(), b.Math.random(), b.Math.random()];
    expect(seqA).toEqual(seqB);
    expect(seqA[0]).not.toBe(seqA[1]);
  });

  it('returns the frozen wallclock from Date.now() when clock is "frozen"', () => {
    const script = buildDeterministicPreloadScript({ seed: 1, clock: 'frozen', clockBase: 1_700_000_000_000 });
    const { Date: D } = evalScript(script);
    expect((D as unknown as typeof Date).now()).toBe(1_700_000_000_000);
    expect(new (D as unknown as typeof Date)().getTime()).toBe(1_700_000_000_000);
  });

  it('returns a monotonically-advancing offset clock when clock is a number', () => {
    const script = buildDeterministicPreloadScript({ seed: 1, clock: 'offset', clockBase: 1_700_000_000_000 });
    const { Date: D } = evalScript(script);
    const t1 = (D as unknown as typeof Date).now();
    const t2 = (D as unknown as typeof Date).now();
    expect(t2).toBeGreaterThanOrEqual(t1);
  });
});
```

- [ ] **Step 3: Verify both test files fail**

Run: `npx vitest run src/main/browser/determinism/pins/seedAndClockPin.test.ts src/main/browser/determinism/pins/seedAndClockPinScript.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `seedAndClockPin.ts`**

```ts
import type { Pin } from '../DeterministicKernel';
import type { ClockSpec } from '../kernelTypes';

export interface PreloadScriptOptions {
  seed: number;
  clock: 'frozen' | 'offset';
  clockBase: number;
}

export function buildDeterministicPreloadScript(opts: PreloadScriptOptions): string {
  const { seed, clock, clockBase } = opts;
  return `
(() => {
  const SEED = ${seed >>> 0};
  const CLOCK_BASE = ${clockBase};
  const CLOCK_MODE = ${JSON.stringify(clock)};
  const ENTER_PERF = performance.now();

  let s = SEED >>> 0;
  const rand = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Object.defineProperty(Math, 'random', { value: rand, writable: false, configurable: false });

  const nowFrozen = () => CLOCK_BASE;
  const nowOffset = () => CLOCK_BASE + (performance.now() - ENTER_PERF);
  const now = CLOCK_MODE === 'frozen' ? nowFrozen : nowOffset;

  const OriginalDate = Date;
  function PatchedDate(...args) {
    if (!(this instanceof PatchedDate)) {
      return new OriginalDate(now()).toString();
    }
    if (args.length === 0) return Reflect.construct(OriginalDate, [now()]);
    return Reflect.construct(OriginalDate, args);
  }
  PatchedDate.now = now;
  PatchedDate.parse = OriginalDate.parse;
  PatchedDate.UTC = OriginalDate.UTC;
  PatchedDate.prototype = OriginalDate.prototype;
  Object.defineProperty(globalThis, 'Date', { value: PatchedDate, configurable: false, writable: false });
})();
`.trim();
}

function resolveClockBase(clock: ClockSpec, now: () => number): { base: number; mode: 'frozen' | 'offset' } {
  if (clock === 'frozen') return { base: now(), mode: 'frozen' };
  return { base: clock, mode: 'offset' };
}

export const seedAndClockPin: Pin = {
  name: 'seedAndClock',
  async apply({ tabId, config, capabilities }) {
    const cdp = await capabilities.attachCdp(tabId);
    const { base, mode } = resolveClockBase(config.clock, Date.now);
    const source = buildDeterministicPreloadScript({ seed: config.seed, clock: mode, clockBase: base });
    const result = (await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source })) as { identifier: string };
    return {
      name: 'seedAndClock',
      revert: async () => {
        await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: result.identifier });
      },
    };
  },
};
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/main/browser/determinism/pins/seedAndClockPin.test.ts src/main/browser/determinism/pins/seedAndClockPinScript.test.ts`
Expected: PASS (4/4).

- [ ] **Step 6: Commit**

```bash
git add src/main/browser/determinism/pins/seedAndClockPin.ts \
        src/main/browser/determinism/pins/seedAndClockPin.test.ts \
        src/main/browser/determinism/pins/seedAndClockPinScript.test.ts
git commit -m "feat(determinism): add seed+clock preload pin with deterministic Math.random and Date"
```

---

## Task 6: Electron adapter

**Files:**
- Create: `src/main/browser/determinism/adapters/electronKernelCapabilities.ts`

No unit tests for the adapter — it's thin glue over Electron and is verified by manual smoke-test in Task 9. All testable logic is in the kernel and pins.

- [ ] **Step 1: Inspect existing BrowserService handles we need to reach**

Run: `npx rg -n "public getTabWebContents|public getTabSession|getEntry|resolveEntry|webContents\\.debugger" src/main/browser/BrowserService.ts`
Record: the public accessor(s) used to get a tab's `webContents` (for `debugger`, `insertCSS`, `setUserAgent`) and its `Electron.Session` (for `webRequest`). If no public accessor exists, add a minimal one in the same commit: `public getTabWebContents(tabId: string): Electron.WebContents | null` and `public getTabSession(tabId: string): Electron.Session | null`.

- [ ] **Step 2: Create `electronKernelCapabilities.ts`**

```ts
import type { KernelCapabilities, CdpHandle } from '../kernelCapabilities';
import type { BrowserService } from '../../BrowserService';

export interface ElectronKernelCapabilitiesDeps {
  browserService: BrowserService;
}

export function createElectronKernelCapabilities(deps: ElectronKernelCapabilitiesDeps): KernelCapabilities {
  const { browserService } = deps;

  const cdpCache = new Map<string, CdpHandle>();
  const previousUserAgents = new Map<string, string>();
  const blockerRegistry = new WeakMap<Electron.Session, { entries: Set<{ regexes: RegExp[] }> }>();

  function requireWebContents(tabId: string): Electron.WebContents {
    const wc = browserService.getTabWebContents(tabId);
    if (!wc) throw new Error(`determinism: no webContents for tab ${tabId}`);
    return wc;
  }

  function requireSession(tabId: string): Electron.Session {
    const ses = browserService.getTabSession(tabId);
    if (!ses) throw new Error(`determinism: no session for tab ${tabId}`);
    return ses;
  }

  async function attachCdp(tabId: string): Promise<CdpHandle> {
    const cached = cdpCache.get(tabId);
    if (cached) return cached;

    const wc = requireWebContents(tabId);
    if (!wc.debugger.isAttached()) {
      wc.debugger.attach('1.3');
    }
    await wc.debugger.sendCommand('Page.enable');
    await wc.debugger.sendCommand('Runtime.enable');

    const handle: CdpHandle = {
      send: (method, params) => wc.debugger.sendCommand(method, params ?? {}),
      detach: async () => {
        try { if (wc.debugger.isAttached()) wc.debugger.detach(); } catch { /* ignore */ }
        cdpCache.delete(tabId);
      },
    };
    cdpCache.set(tabId, handle);
    return handle;
  }

  return {
    attachCdp,

    async setUserAgent(tabId, userAgent) {
      const wc = requireWebContents(tabId);
      const previous = wc.getUserAgent();
      previousUserAgents.set(tabId, previous);
      wc.setUserAgent(userAgent);
      return previous;
    },

    async restoreUserAgent(tabId, previous) {
      const wc = requireWebContents(tabId);
      wc.setUserAgent(previous);
      previousUserAgents.delete(tabId);
    },

    async insertCss(tabId, css) {
      const wc = requireWebContents(tabId);
      return wc.insertCSS(css);
    },

    async removeInsertedCss(tabId, cssKey) {
      const wc = requireWebContents(tabId);
      await wc.removeInsertedCSS(cssKey);
    },

    async setViewport(tabId, viewport) {
      const cdp = await attachCdp(tabId);
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: viewport.deviceScaleFactor,
        mobile: false,
      });
    },

    async clearViewport(tabId) {
      const cdp = await attachCdp(tabId);
      await cdp.send('Emulation.clearDeviceMetricsOverride', {});
    },

    async registerRequestBlocker(tabId, patterns) {
      const ses = requireSession(tabId);
      const regexes = patterns.map(globToRegex);
      const entry = { regexes };
      const existing = blockerRegistry.get(ses);
      if (existing) {
        existing.entries.add(entry);
      } else {
        const entries = new Set<{ regexes: RegExp[] }>([entry]);
        ses.webRequest.onBeforeRequest(
          { urls: ['<all_urls>'] },
          (details, callback) => {
            let blocked = false;
            for (const e of entries) {
              if (e.regexes.some(r => r.test(details.url))) { blocked = true; break; }
            }
            callback({ cancel: blocked });
          },
        );
        blockerRegistry.set(ses, { entries });
      }
      return {
        dispose: () => {
          const record = blockerRegistry.get(ses);
          if (!record) return;
          record.entries.delete(entry);
          if (record.entries.size === 0) {
            ses.webRequest.onBeforeRequest(null);
            blockerRegistry.delete(ses);
          }
        },
      };
    },

    isTabAlive(tabId) {
      return browserService.getTabWebContents(tabId) !== null;
    },
  };
}

function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}
```

- [ ] **Step 3: If `getTabWebContents` / `getTabSession` were missing, add them to `BrowserService.ts`**

Open `src/main/browser/BrowserService.ts` and locate the public methods block near `getTabs()`. Add:

```ts
public getTabWebContents(tabId: string): Electron.WebContents | null {
  const entry = this.tabs.get(tabId);
  return entry ? entry.view.webContents : null;
}

public getTabSession(tabId: string): Electron.Session | null {
  const entry = this.tabs.get(tabId);
  return entry ? entry.view.webContents.session : null;
}
```

Note: only add these if they don't already exist. If they exist under different names, use the existing ones in Step 2 instead.

- [ ] **Step 4: Typecheck**

Run: `npx tsc -p tsconfig.main.json --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/browser/determinism/adapters/electronKernelCapabilities.ts src/main/browser/BrowserService.ts
git commit -m "feat(determinism): add Electron adapter implementing KernelCapabilities"
```

---

## Task 7: Wire `openTabDeterministic` to the kernel

**Files:**
- Modify: `src/main/agent/tools/browser/openTabDeterministic.ts`
- Modify: `src/main/agent/tools/browser/openTabDeterministic.test.ts`

- [ ] **Step 1: Write new failing tests covering the `deterministic` input**

Append to `openTabDeterministic.test.ts`:

```ts
describe('openTabDeterministic — kernel integration', () => {
  it('calls kernel.enter with the new tab id when deterministic is true', async () => {
    const service = createFakeTabService([{ id: 'tab_1', url: 'about:blank' }]);
    const enter = vi.fn(async () => ({ tabId: 'tab_2', pinsApplied: ['userAgent'], enteredAt: 1 }));
    const isDeterministic = vi.fn(() => true);

    const result = await openTabDeterministic(
      { url: 'https://example.com/', deterministic: true },
      service,
      { kernel: { enter, isDeterministic } },
    );

    expect(enter).toHaveBeenCalledWith('tab_2', {});
    expect(result.deterministic).toEqual({ pinsApplied: ['userAgent'] });
  });

  it('passes a DeterminismConfig object through to kernel.enter', async () => {
    const service = createFakeTabService();
    const enter = vi.fn(async () => ({ tabId: 'tab_1', pinsApplied: ['userAgent', 'visual'], enteredAt: 1 }));
    const isDeterministic = vi.fn(() => true);

    await openTabDeterministic(
      { url: 'https://example.com/', deterministic: { seed: 99, locale: 'fr-FR' } },
      service,
      { kernel: { enter, isDeterministic } },
    );

    expect(enter).toHaveBeenCalledWith('tab_1', { seed: 99, locale: 'fr-FR' });
  });

  it('throws OpenTabPostconditionError when kernel.isDeterministic returns false after enter', async () => {
    const service = createFakeTabService();
    const enter = vi.fn(async () => ({ tabId: 'tab_1', pinsApplied: [], enteredAt: 1 }));
    const isDeterministic = vi.fn(() => false);

    await expect(openTabDeterministic(
      { url: 'https://example.com/', deterministic: true },
      service,
      { kernel: { enter, isDeterministic } },
    )).rejects.toThrow(/kernel.*not.*deterministic/i);
  });

  it('does not call kernel when deterministic is omitted', async () => {
    const service = createFakeTabService();
    const enter = vi.fn();
    const isDeterministic = vi.fn();

    await openTabDeterministic(
      { url: 'https://example.com/' },
      service,
      { kernel: { enter, isDeterministic } },
    );

    expect(enter).not.toHaveBeenCalled();
    expect(isDeterministic).not.toHaveBeenCalled();
  });
});
```

Also update the test file imports to make `openTabDeterministic` async-aware:

```ts
// at the top, replace the existing import line if needed:
import {
  DeterministicTabService,
  DeterministicTabSnapshot,
  OpenTabPostconditionError,
  openTabDeterministic,
} from './openTabDeterministic';
```

Every existing test that calls `openTabDeterministic(...)` must now be awaited (add `async` to the arrow function and `await` the call). Update all six existing tests accordingly.

- [ ] **Step 2: Verify tests fail**

Run: `npx vitest run src/main/agent/tools/browser/openTabDeterministic.test.ts`
Expected: FAIL — either signature-mismatch errors or "kernel option not supported".

- [ ] **Step 3: Update `openTabDeterministic.ts`**

Replace the existing file with:

```ts
import type { DeterminismConfig, KernelResult } from '../../../browser/determinism/kernelTypes';

export type DeterministicTabSnapshot = {
  id: string;
  url: string;
};

export type DeterministicTabService = {
  createTab: (url?: string) => { id: string };
  activateTab: (tabId: string) => void;
  getTabs: () => DeterministicTabSnapshot[];
  getActiveTabId: () => string | null;
};

export type OpenTabKernelHook = {
  enter: (tabId: string, config: DeterminismConfig) => Promise<KernelResult>;
  isDeterministic: (tabId: string) => boolean;
};

export type OpenTabDependencies = {
  kernel?: OpenTabKernelHook;
};

export type OpenTabInput = {
  url?: string;
  reuseExisting?: boolean;
  deterministic?: DeterminismConfig | true;
};

export type OpenTabResult = {
  tabId: string;
  url: string;
  reused: boolean;
  tabCount: number;
  deterministic?: { pinsApplied: string[] };
};

export class OpenTabPostconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenTabPostconditionError';
  }
}

function canonicalizeUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${parsed.origin}${pathname}${parsed.search}`;
  } catch {
    return raw.trim().replace(/\/+$/, '');
  }
}

export async function openTabDeterministic(
  input: OpenTabInput,
  service: DeterministicTabService,
  deps: OpenTabDependencies = {},
): Promise<OpenTabResult> {
  if (input.url !== undefined && (typeof input.url !== 'string' || input.url.trim() === '')) {
    throw new TypeError('openTabDeterministic: url must be a non-empty string when provided');
  }
  if (input.deterministic !== undefined && !deps.kernel) {
    throw new TypeError('openTabDeterministic: deterministic option requires a kernel hook');
  }

  const normalizedUrl = input.url ? canonicalizeUrl(input.url) : undefined;

  let tabId: string;
  let reused: boolean;
  let url: string;

  if (input.reuseExisting && normalizedUrl) {
    const existing = service.getTabs().find(tab => canonicalizeUrl(tab.url) === normalizedUrl);
    if (existing) {
      service.activateTab(existing.id);
      const afterActivate = service.getActiveTabId();
      if (afterActivate !== existing.id) {
        throw new OpenTabPostconditionError(
          `expected active tab ${existing.id} after reuse, got ${afterActivate ?? 'null'}`,
        );
      }
      tabId = existing.id;
      url = existing.url;
      reused = true;
    } else {
      ({ tabId, url, reused } = createNew());
    }
  } else {
    ({ tabId, url, reused } = createNew());
  }

  const result: OpenTabResult = { tabId, url, reused, tabCount: service.getTabs().length };

  if (input.deterministic !== undefined) {
    const config: DeterminismConfig = input.deterministic === true ? {} : input.deterministic;
    const kernelResult = await deps.kernel!.enter(tabId, config);
    if (!deps.kernel!.isDeterministic(tabId)) {
      throw new OpenTabPostconditionError(
        `kernel reported tab ${tabId} is not deterministic after enter`,
      );
    }
    result.deterministic = { pinsApplied: kernelResult.pinsApplied };
  }

  return result;

  function createNew(): { tabId: string; url: string; reused: boolean } {
    const created = service.createTab(input.url);
    if (!created || typeof created.id !== 'string' || created.id.trim() === '') {
      throw new OpenTabPostconditionError('createTab did not return a tab id');
    }
    const tabs = service.getTabs();
    const match = tabs.find(tab => tab.id === created.id);
    if (!match) {
      throw new OpenTabPostconditionError(
        `created tab ${created.id} not present in tab list (got ${tabs.length} tabs)`,
      );
    }
    const activeId = service.getActiveTabId();
    if (activeId !== created.id) {
      throw new OpenTabPostconditionError(
        `expected active tab ${created.id}, got ${activeId ?? 'null'}`,
      );
    }
    return { tabId: created.id, url: match.url, reused: false };
  }
}
```

- [ ] **Step 4: Update every existing test to await the now-async function**

Change every `openTabDeterministic(...)` call to `await openTabDeterministic(...)` and mark the arrow functions as `async`. For `expect(() => openTabDeterministic(...)).toThrow(...)`, convert to `await expect(openTabDeterministic(...)).rejects.toThrow(...)`. Full rewrite of an example existing test:

```ts
it('rejects an empty url string at the precondition stage', async () => {
  const service = createFakeTabService();
  await expect(openTabDeterministic({ url: '   ' }, service)).rejects.toThrow(TypeError);
  expect(service.createTab).not.toHaveBeenCalled();
});
```

- [ ] **Step 5: Run all tests in the file**

Run: `npx vitest run src/main/agent/tools/browser/openTabDeterministic.test.ts`
Expected: PASS (all original tests + 4 new integration tests).

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/tools/browser/openTabDeterministic.ts src/main/agent/tools/browser/openTabDeterministic.test.ts
git commit -m "feat(determinism): wire openTabDeterministic to the kernel via optional hook"
```

---

## Task 8: Wire the kernel singleton into the tool layer

**Files:**
- Modify: `src/main/agent/tools/browser/index.ts`

- [ ] **Step 1: Read the current `browser.open_tab` tool definition to locate the exact insertion site**

Run: `npx rg -n "name: 'browser.open_tab'" -A 45 src/main/agent/tools/browser/index.ts`
Record the line range you'll modify.

- [ ] **Step 2: Add kernel singleton construction near the top of `tools/browser/index.ts`**

Add these imports below the existing imports:

```ts
import { DeterministicKernel } from '../../../browser/determinism/DeterministicKernel';
import { createElectronKernelCapabilities } from '../../../browser/determinism/adapters/electronKernelCapabilities';
import { userAgentPin } from '../../../browser/determinism/pins/userAgentPin';
import { visualPin } from '../../../browser/determinism/pins/visualPin';
import { networkBlocklistPin } from '../../../browser/determinism/pins/networkBlocklistPin';
import { viewportPin } from '../../../browser/determinism/pins/viewportPin';
import { localeTimezonePin } from '../../../browser/determinism/pins/localeTimezonePin';
import { seedAndClockPin } from '../../../browser/determinism/pins/seedAndClockPin';
```

Below those imports, construct the kernel lazily (must be lazy — `browserService` is a module singleton and may not be ready at import time):

```ts
let determinismKernel: DeterministicKernel | null = null;

function getKernel(): DeterministicKernel {
  if (!determinismKernel) {
    determinismKernel = new DeterministicKernel({
      capabilities: createElectronKernelCapabilities({ browserService }),
      pins: [
        userAgentPin,
        visualPin,
        viewportPin,
        localeTimezonePin,
        seedAndClockPin,
        networkBlocklistPin,
      ],
    });
  }
  return determinismKernel;
}
```

- [ ] **Step 3: Update the `browser.open_tab` tool definition**

Replace the existing `browser.open_tab` `execute` body with one that plumbs the kernel through:

```ts
{
  name: 'browser.open_tab',
  description: 'Deterministic tab opener: creates a new tab (optionally at a URL) and verifies the tab exists and is active before returning. With reuseExisting=true, activates an existing tab matching the URL instead of creating a duplicate. With deterministic=true (or a DeterminismConfig object), the new tab is entered into deterministic mode (pinned clock, seed, viewport, locale, UA, animations off) before returning.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string' },
      reuseExisting: { type: 'boolean' },
      deterministic: {
        oneOf: [
          { type: 'boolean' },
          {
            type: 'object',
            properties: {
              seed: { type: 'number' },
              clock: { oneOf: [{ type: 'number' }, { type: 'string', enum: ['frozen'] }] },
              viewport: {
                type: 'object',
                properties: {
                  width: { type: 'number' },
                  height: { type: 'number' },
                  deviceScaleFactor: { type: 'number' },
                },
              },
              locale: { type: 'string' },
              timezone: { type: 'string' },
              userAgent: { type: 'string' },
              disableAnimations: { type: 'boolean' },
              reduceMotion: { type: 'boolean' },
              blockNetworkPatterns: { type: 'array', items: { type: 'string' } },
            },
          },
        ],
      },
    },
  },
  async execute(input) {
    requireBrowserCreated();
    const obj = objectInput(input);
    const url = optionalString(obj, 'url');
    const reuseExisting = obj.reuseExisting === true;
    const deterministic = normalizeDeterministicInput(obj.deterministic);

    const service: DeterministicTabService = {
      createTab: (targetUrl?: string) => {
        const tab = browserService.createTab(targetUrl);
        return { id: tab.id };
      },
      activateTab: (tabId: string) => { browserService.activateTab(tabId); },
      getTabs: () => browserService.getTabs().map(tab => ({
        id: tab.id,
        url: tab.navigation.url,
      })),
      getActiveTabId: () => browserService.getState().activeTabId,
    };

    const kernel = deterministic !== undefined ? getKernel() : undefined;
    const result = await openTabDeterministic(
      { url, reuseExisting, deterministic },
      service,
      kernel ? { kernel: { enter: (t, c) => kernel.enter(t, c), isDeterministic: (t) => kernel.isDeterministic(t) } } : {},
    );
    invalidateBrowserCaches();
    await waitForBrowserSettled();

    return {
      summary: result.reused
        ? `Reused existing tab ${result.tabId}${url ? ` for ${url}` : ''}${result.deterministic ? ' (deterministic)' : ''}`
        : `Opened tab ${result.tabId}${url ? ` at ${url}` : ''}${result.deterministic ? ' (deterministic)' : ''}`,
      data: {
        ...result,
        activeTabId: browserService.getState().activeTabId,
        tabs: compactTabInventory(),
      },
    };
  },
},
```

- [ ] **Step 4: Add the `normalizeDeterministicInput` helper**

Inside the same file, below `objectInput` / `optionalString` helpers, add:

```ts
function normalizeDeterministicInput(raw: unknown): true | Record<string, unknown> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (raw === true) return true;
  if (raw === false) return undefined;
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  throw new TypeError('browser.open_tab: deterministic must be boolean or an object');
}
```

- [ ] **Step 5: Typecheck and run all tests**

Run: `npx tsc -p tsconfig.main.json --noEmit && npx vitest run`
Expected: PASS (everything green, 0 TypeScript errors).

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/tools/browser/index.ts
git commit -m "feat(determinism): wire DeterministicKernel singleton into browser.open_tab"
```

---

## Task 9: Manual verification and skill doc update

**Files:**
- Modify: `skills/browser-operation/SKILL.md`
- Optional: tiny fixture page in `src/main/browser/__fixtures__/web-intent/` for in-app verification

Manual tests confirm what unit tests cannot — that the Electron adapter, CDP attach, and preload injection actually work end-to-end.

- [ ] **Step 1: Manual smoke test — start the app**

Run: `npm run dev` (or whatever the current dev launch command is — check `package.json` scripts).

Once running, from a task in the agent, invoke:

```
browser.open_tab { "url": "https://example.com/", "deterministic": { "seed": 42, "userAgent": "goldenboy-determinism/1.0" } }
```

Then from the agent, `browser.evaluate_js { "code": "Math.random() + ' | ' + Math.random() + ' | ' + new Date().toISOString() + ' | ' + navigator.userAgent" }` twice in a row on fresh reloads of that tab. Record the output.

**Expected:** identical `Math.random()` sequence across reloads; identical `Date` (if `clock: 'frozen'`) or monotonically-increasing (if `clock` is a number); UA exactly `goldenboy-determinism/1.0`.

- [ ] **Step 2: Manual smoke test — animations and network blocklist**

Open a page with visible animations (e.g., a CSS demo). Verify no motion. Then repeat with `deterministic: { blockNetworkPatterns: ["https://www.google-analytics.com/*"] }` on a page that loads GA — verify the request is blocked in DevTools Network tab (`ERR_BLOCKED_BY_CLIENT`).

- [ ] **Step 3: Update `skills/browser-operation/SKILL.md`**

Find the `browser.open_tab` entry in the Preferred Tools / workflow guidance section, and append:

```markdown
- `browser.open_tab` accepts an optional `deterministic` field. Pass `true` for default pinning (seed=1, clock frozen, viewport 1280×800, locale en-US, timezone UTC, animations off) or a config object to override specific pins. Use this whenever the next steps depend on stable clocks, seeded randomness, pinned viewport, or blocked analytics — particularly for non-reasoning tasks where reproducibility matters more than realism.
```

- [ ] **Step 4: Commit the skill update**

```bash
git add skills/browser-operation/SKILL.md
git commit -m "docs(skill): document browser.open_tab deterministic option"
```

- [ ] **Step 5: Final verification**

Run: `npx tsc -p tsconfig.main.json --noEmit && npx vitest run`
Expected: 0 type errors, all tests green.

Then confirm the full pin set exercised manually (clock, seed, UA, animations, network blocklist).

---

## Notes for the engineer

- **Kernel has zero Electron imports.** If you find yourself reaching for `webContents` or `session` inside `DeterministicKernel.ts` or any `pins/*.ts` file, stop — that logic belongs in `electronKernelCapabilities.ts`. This separation is what makes the kernel unit-testable without Electron, and it will save you hours of mocking.
- **Every pin is a `{ apply, revert }` pair.** The revert closure captures everything needed to undo the apply. This is why pins receive `capabilities` as an argument to `apply` — the revert keeps a reference to whatever handle the apply returned.
- **Rollback on partial failure is non-negotiable.** If any pin fails, every already-applied pin must be reverted before `enter` throws. The test `"partial failure rolls back already-applied pins and throws KernelError"` in Task 2 guards this; don't relax it.
- **Idempotent `enter` is non-negotiable.** Calling `kernel.enter(tabId, sameConfig)` twice in a row must be a no-op the second time, not a double-apply. The test `"enter is idempotent for identical config"` guards this.
- **`purgeTab` vs `exit`.** `exit` runs reverts; `purgeTab` just drops the registry entry. Use `purgeTab` only for "the tab is already gone" scenarios (tab-close events in v2). In v1, no one calls `purgeTab` — the test exists so the API is there when we need it.
- **`deterministic: true` means "all v1 pins with defaults".** The defaults in `DEFAULT_CONFIG` are deliberately conservative (UA unchanged, UTC, en-US, 1280×800, frozen clock at enter time, seed=1, animations off, reduce-motion on, empty blocklist).
- **CDP attach is ref-counted in the adapter.** Once per tab; subsequent pins reuse the cached handle. `detach` only happens when the tab closes or something external calls it.
- **Known v1 limitation: network blocklist is session-scoped, not tab-scoped.** `session.webRequest.onBeforeRequest` applies to every tab sharing that session. The adapter multiplexes multiple `registerRequestBlocker` callers through a single listener so they don't clobber each other, but if two deterministic tabs share a session and have different blocklists, each tab will see the union. Future work: switch this pin to CDP `Fetch.enable` for true per-tab scoping. Not required for v1 because the validation target (`browser.open_tab`) typically opens one deterministic tab per run.

---

## Self-Review Notes

Verified against the spec:
- All v1 pins (spec §Pin plan rows 1–8) have tasks (3, 4, 5) with tests.
- Public API (spec §Public API) matches Task 2 exactly.
- Rollback on partial failure (spec §Error semantics) guarded by Task 2 test.
- Integration with `openTabDeterministic` (spec §Integration) is Task 7; strict opt-in preserved when `deterministic` is omitted.
- File layout (spec §File layout) matches the File Structure section above.
- Non-goals (HAR replay, AX tree primitive, CPU throttling, partitions, tool collapse) have no tasks — as intended.

Placeholder scan: none found. All code blocks are complete; no "TODO" or "implement later" left behind.

Type consistency: `DeterminismConfig`, `ResolvedDeterminismConfig`, `KernelResult`, `KernelError`, `PinContext`, `Pin`, `KernelCapabilities`, `CdpHandle` are consistent across all tasks. `openTabDeterministic` is made `async` in Task 7 — the existing tests are updated in the same task.
