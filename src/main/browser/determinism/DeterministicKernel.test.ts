import { describe, expect, it, vi } from 'vitest';
import { DeterministicKernel } from './DeterministicKernel';
import type { Pin } from './DeterministicKernel';
import type { KernelCapabilities } from './kernelCapabilities';
import { KernelError } from './kernelTypes';

function makeCaps(overrides: Partial<KernelCapabilities> = {}): KernelCapabilities {
  return {
    attachCdp: vi.fn(async () => ({
      send: vi.fn(async () => ({})),
      on: vi.fn(),
      off: vi.fn(),
      detach: vi.fn(async () => {}),
    })),
    setUserAgent: vi.fn(async () => 'prev-ua'),
    restoreUserAgent: vi.fn(async () => {}),
    insertCss: vi.fn(async () => 'css-key'),
    removeInsertedCss: vi.fn(async () => {}),
    setViewport: vi.fn(async () => {}),
    clearViewport: vi.fn(async () => {}),
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
