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
