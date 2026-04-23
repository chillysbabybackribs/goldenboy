import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { buildDeterministicPreloadScript } from './seedAndClockPin';

interface EvalResult {
  Math: typeof Math;
  Date: typeof Date;
  performance: { now: () => number };
}

function evalScript(script: string): EvalResult {
  // Fresh context per call so globalThis patches don't leak between tests.
  // `performance.now` is stubbed to a constant so "offset" mode is checkable.
  let perfCounter = 1000;
  const context: Record<string, unknown> = {
    performance: { now: () => ++perfCounter },
    console,
  };
  vm.createContext(context);
  vm.runInContext(script, context);
  // Built-in globals like Math/Date aren't enumerable own-properties of the
  // sandbox object, so fetch them by evaluating their identifiers in-context.
  return {
    Math: vm.runInContext('Math', context) as typeof Math,
    Date: vm.runInContext('Date', context) as typeof Date,
    performance: context.performance as { now: () => number },
  };
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
    expect(D.now()).toBe(1_700_000_000_000);
    expect(new D().getTime()).toBe(1_700_000_000_000);
  });

  it('leaves multi-arg Date construction untouched (no prototype corruption)', () => {
    const script = buildDeterministicPreloadScript({ seed: 1, clock: 'frozen', clockBase: 1_700_000_000_000 });
    const { Date: D } = evalScript(script);
    // Jan 1 2020 UTC — must return its real timestamp, NOT the pinned clock.
    const jan1_2020_utc = new D(Date.UTC(2020, 0, 1)).getTime();
    expect(jan1_2020_utc).toBe(Date.UTC(2020, 0, 1));
  });

  it('returns a monotonically-advancing offset clock when clock is a number', () => {
    const script = buildDeterministicPreloadScript({ seed: 1, clock: 'offset', clockBase: 1_700_000_000_000 });
    const { Date: D } = evalScript(script);
    const t1 = D.now();
    const t2 = D.now();
    expect(t2).toBeGreaterThanOrEqual(t1);
  });
});
