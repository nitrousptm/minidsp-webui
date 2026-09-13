import { describe, expect, it } from 'vitest';
import { durationToMs, msToDuration, buildPeqWire, buildRoutingWire, buildCrossoverWire } from '../wire.js';

describe('duration conversion', () => {
  it('converts whole milliseconds to secs/nanos and back', () => {
    expect(msToDuration(1500)).toEqual({ secs: 1, nanos: 500_000_000 });
    expect(durationToMs({ secs: 1, nanos: 500_000_000 })).toBeCloseTo(1500);
  });

  it('handles sub-millisecond precision (0.01ms steps)', () => {
    const d = msToDuration(0.01);
    expect(durationToMs(d)).toBeCloseTo(0.01, 5);
  });

  it('handles the maximum 80ms delay', () => {
    const d = msToDuration(80);
    expect(d).toEqual({ secs: 0, nanos: 80_000_000 });
    expect(durationToMs(d)).toBeCloseTo(80);
  });

  it('round-trips zero', () => {
    expect(durationToMs(msToDuration(0))).toBe(0);
  });
});

describe('wire builders', () => {
  it('builds a PEQ wire fragment addressed at the right channel/index', () => {
    const wire = buildPeqWire('output', 2, 4, { bypass: false, coeff: { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 } });
    expect(wire).toEqual({
      outputs: [{ index: 2, peq: [{ index: 4, bypass: false, coeff: { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 } }] }],
    });
  });

  it('builds a routing wire fragment on the input side', () => {
    const wire = buildRoutingWire(0, 2, { gain: -6, mute: false });
    expect(wire).toEqual({ inputs: [{ index: 0, routing: [{ index: 2, gain: -6, mute: false }] }] });
  });

  it('builds a crossover wire fragment for a given group', () => {
    const wire = buildCrossoverWire(1, 0, { bypass: false, coeff: [] });
    expect(wire).toEqual({ outputs: [{ index: 1, crossover: [{ index: 0, bypass: false, coeff: [] }] }] });
  });

  it('stamps each crossover biquad with its own index within the group (required by minidspd)', () => {
    // Regression test: minidspd rejects a crossover coeff array whose
    // biquads don't each carry an `index` with "Internal error: biquad index
    // not specified" - the array position alone is not enough.
    const b = { b0: 1, b1: -2, b2: 1, a1: 1.9, a2: -0.9 };
    const wire = buildCrossoverWire(0, 1, { bypass: false, coeff: [b, b, b] });
    expect(wire).toEqual({
      outputs: [
        {
          index: 0,
          crossover: [
            {
              index: 1,
              bypass: false,
              coeff: [
                { ...b, index: 0 },
                { ...b, index: 1 },
                { ...b, index: 2 },
              ],
            },
          ],
        },
      ],
    });
  });
});
