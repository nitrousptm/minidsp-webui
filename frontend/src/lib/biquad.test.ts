import { describe, expect, it } from 'vitest';
import {
  biquadMagnitudeDb,
  buildCrossoverBiquads,
  butterworthQs,
  combinedMagnitudeDb,
  computePeqBiquad,
  logSpace,
} from './biquad';

const SR = 96000;

describe('computePeqBiquad', () => {
  it('produces a unity (flat) response for a PEAK filter with 0 dB gain', () => {
    const coeff = computePeqBiquad({ type: 'PEAK', freq: 1000, gainDb: 0, q: 1 }, SR);
    for (const f of [50, 200, 1000, 5000, 15000]) {
      expect(biquadMagnitudeDb(coeff, f, SR)).toBeCloseTo(0, 1);
    }
  });

  it('boosts by approximately the configured gain at the center frequency of a PEAK filter', () => {
    const coeff = computePeqBiquad({ type: 'PEAK', freq: 1000, gainDb: 6, q: 1.5 }, SR);
    expect(biquadMagnitudeDb(coeff, 1000, SR)).toBeCloseTo(6, 1);
    // far from the center frequency the filter should have little effect
    expect(Math.abs(biquadMagnitudeDb(coeff, 50, SR))).toBeLessThan(0.5);
  });

  it('reaches half the shelf gain at the LOW_SHELF corner frequency', () => {
    const coeff = computePeqBiquad({ type: 'LOW_SHELF', freq: 200, gainDb: 12, q: 0.7 }, SR);
    expect(biquadMagnitudeDb(coeff, 200, SR)).toBeCloseTo(6, 0);
    expect(biquadMagnitudeDb(coeff, 5000, SR)).toBeCloseTo(0, 0);
    expect(biquadMagnitudeDb(coeff, 20, SR)).toBeCloseTo(12, 0);
  });

  it('reaches half the shelf gain at the HIGH_SHELF corner frequency', () => {
    const coeff = computePeqBiquad({ type: 'HIGH_SHELF', freq: 4000, gainDb: -8, q: 0.7 }, SR);
    expect(biquadMagnitudeDb(coeff, 4000, SR)).toBeCloseTo(-4, 0);
    expect(biquadMagnitudeDb(coeff, 100, SR)).toBeCloseTo(0, 0);
  });

  it('has no gain parameter and stays flat in magnitude for ALL_PASS', () => {
    const coeff = computePeqBiquad({ type: 'ALL_PASS', freq: 500, gainDb: 0, q: 0.7 }, SR);
    for (const f of [20, 100, 500, 2000, 10000]) {
      expect(biquadMagnitudeDb(coeff, f, SR)).toBeCloseTo(0, 1);
    }
  });
});

describe('butterworthQs', () => {
  it('matches the well-known standard pole Q table', () => {
    expect(butterworthQs(2)[0]).toBeCloseTo(0.70711, 4);
    const q4 = butterworthQs(4);
    expect(q4[0]).toBeCloseTo(0.54120, 4);
    expect(q4[1]).toBeCloseTo(1.30656, 4);
    const q8 = butterworthQs(8);
    expect(q8[3]).toBeCloseTo(2.5629, 3);
  });
});

describe('buildCrossoverBiquads', () => {
  it('a Butterworth low-pass is ~3dB down at the cutoff frequency, regardless of slope', () => {
    for (const slope of [6, 12, 24, 48]) {
      const biquads = buildCrossoverBiquads('BUTTERWORTH', 'lowpass', slope, 1000, SR);
      expect(combinedMagnitudeDb(biquads, 1000, SR)).toBeCloseTo(-3, 0);
    }
  });

  it('a Linkwitz-Riley low-pass is ~6dB down at the cutoff frequency', () => {
    for (const slope of [12, 24, 48]) {
      const biquads = buildCrossoverBiquads('LINKWITZ_RILEY', 'lowpass', slope, 1000, SR);
      expect(combinedMagnitudeDb(biquads, 1000, SR)).toBeCloseTo(-6, 0);
    }
  });

  it('never allocates more than the 4 biquads available per crossover group', () => {
    for (const slope of [6, 12, 18, 24, 30, 36, 42, 48]) {
      expect(buildCrossoverBiquads('BUTTERWORTH', 'highpass', slope, 1000, SR).length).toBeLessThanOrEqual(4);
    }
    for (const slope of [12, 24, 48]) {
      expect(buildCrossoverBiquads('LINKWITZ_RILEY', 'highpass', slope, 1000, SR).length).toBeLessThanOrEqual(4);
    }
  });

  it('rejects unsupported Bessel slopes', () => {
    expect(() => buildCrossoverBiquads('BESSEL', 'lowpass', 24, 1000, SR)).toThrow();
  });
});

describe('logSpace', () => {
  it('generates a logarithmically spaced range from min to max inclusive', () => {
    const points = logSpace(20, 20000, 5);
    expect(points).toHaveLength(5);
    expect(points[0]).toBeCloseTo(20);
    expect(points[4]).toBeCloseTo(20000);
  });
});
