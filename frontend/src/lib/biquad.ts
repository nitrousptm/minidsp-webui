import type { Biquad, PeqFilterType } from '../types';

/**
 * Biquad coefficients are generated using the RBJ "Audio EQ Cookbook" formulas,
 * then converted to the sign/normalization convention minidsp-rs expects:
 *   y[n] = b0*x[n] + b1*x[n-1] + b2*x[n-2] + a1*y[n-1] + a2*y[n-2]
 * (i.e. a1/a2 are the *negated*, a0-normalized RBJ feedback coefficients).
 * This convention was reverse-engineered from the example biquad file in the
 * miniDSP 2x4 HD manual and cross-checked against the live minidsp-rs schema.
 */
function toMinidspConvention(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): Biquad {
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: -(a1 / a0), a2: -(a2 / a0) };
}

export interface PeqParams {
  type: PeqFilterType;
  freq: number; // Hz
  gainDb: number; // dB, ignored for ALL_PASS
  q: number;
}

export function computePeqBiquad(params: PeqParams, sampleRate: number): Biquad {
  const { type, freq, gainDb, q } = params;
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * q);
  const A = Math.pow(10, gainDb / 40);

  switch (type) {
    case 'PEAK': {
      const b0 = 1 + alpha * A;
      const b1 = -2 * cosw0;
      const b2 = 1 - alpha * A;
      const a0 = 1 + alpha / A;
      const a1 = -2 * cosw0;
      const a2 = 1 - alpha / A;
      return toMinidspConvention(b0, b1, b2, a0, a1, a2);
    }
    case 'LOW_SHELF': {
      const sqrtA = Math.sqrt(A);
      const b0 = A * (A + 1 - (A - 1) * cosw0 + 2 * sqrtA * alpha);
      const b1 = 2 * A * (A - 1 - (A + 1) * cosw0);
      const b2 = A * (A + 1 - (A - 1) * cosw0 - 2 * sqrtA * alpha);
      const a0 = A + 1 + (A - 1) * cosw0 + 2 * sqrtA * alpha;
      const a1 = -2 * (A - 1 + (A + 1) * cosw0);
      const a2 = A + 1 + (A - 1) * cosw0 - 2 * sqrtA * alpha;
      return toMinidspConvention(b0, b1, b2, a0, a1, a2);
    }
    case 'HIGH_SHELF': {
      const sqrtA = Math.sqrt(A);
      const b0 = A * (A + 1 + (A - 1) * cosw0 + 2 * sqrtA * alpha);
      const b1 = -2 * A * (A - 1 + (A + 1) * cosw0);
      const b2 = A * (A + 1 + (A - 1) * cosw0 - 2 * sqrtA * alpha);
      const a0 = A + 1 - (A - 1) * cosw0 + 2 * sqrtA * alpha;
      const a1 = 2 * (A - 1 - (A + 1) * cosw0);
      const a2 = A + 1 - (A - 1) * cosw0 - 2 * sqrtA * alpha;
      return toMinidspConvention(b0, b1, b2, a0, a1, a2);
    }
    case 'ALL_PASS': {
      const b0 = 1 - alpha;
      const b1 = -2 * cosw0;
      const b2 = 1 + alpha;
      const a0 = 1 + alpha;
      const a1 = -2 * cosw0;
      const a2 = 1 - alpha;
      return toMinidspConvention(b0, b1, b2, a0, a1, a2);
    }
  }
}

function secondOrderHpfLpf(kind: 'highpass' | 'lowpass', freq: number, q: number, sampleRate: number): Biquad {
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * q);
  const a0 = 1 + alpha;
  const a1 = -2 * cosw0;
  const a2 = 1 - alpha;
  if (kind === 'lowpass') {
    const b0 = (1 - cosw0) / 2;
    const b1 = 1 - cosw0;
    const b2 = (1 - cosw0) / 2;
    return toMinidspConvention(b0, b1, b2, a0, a1, a2);
  }
  const b0 = (1 + cosw0) / 2;
  const b1 = -(1 + cosw0);
  const b2 = (1 + cosw0) / 2;
  return toMinidspConvention(b0, b1, b2, a0, a1, a2);
}

function firstOrderHpfLpf(kind: 'highpass' | 'lowpass', freq: number, sampleRate: number): Biquad {
  const k = Math.tan((Math.PI * freq) / sampleRate);
  const a0 = k + 1;
  const a1 = k - 1;
  if (kind === 'lowpass') {
    const b0 = k;
    const b1 = k;
    return toMinidspConvention(b0, b1, 0, a0, a1, 0);
  }
  const b0 = 1;
  const b1 = -1;
  return toMinidspConvention(b0, b1, 0, a0, a1, 0);
}

/** Standard cascaded-2nd-order-section Q values for an N-th order Butterworth filter. */
export function butterworthQs(order: number): number[] {
  const pairs = Math.floor(order / 2);
  const qs: number[] = [];
  for (let k = 1; k <= pairs; k++) {
    const theta = (Math.PI * (2 * k - 1)) / (2 * order);
    qs.push(1 / (2 * Math.cos(theta)));
  }
  return qs;
}

const BESSEL_2ND_ORDER_Q = 1 / Math.sqrt(3);

export type CrossoverFamily = 'BUTTERWORTH' | 'LINKWITZ_RILEY' | 'BESSEL';

function butterworthSections(order: number, kind: 'highpass' | 'lowpass', freq: number, sampleRate: number): Biquad[] {
  const sections = butterworthQs(order).map((q) => secondOrderHpfLpf(kind, freq, q, sampleRate));
  if (order % 2 === 1) sections.push(firstOrderHpfLpf(kind, freq, sampleRate));
  return sections;
}

/**
 * Builds the (up to 4) cascaded biquads for one crossover group (high-pass or
 * low-pass), matching the slopes documented for the 2x4 HD: Butterworth
 * 6-48 dB/oct in 6 dB steps, Linkwitz-Riley 12/24/48 dB/oct, Bessel 12 dB/oct.
 */
export function buildCrossoverBiquads(
  family: CrossoverFamily,
  kind: 'highpass' | 'lowpass',
  slopeDbPerOct: number,
  freq: number,
  sampleRate: number,
): Biquad[] {
  if (family === 'BESSEL') {
    if (slopeDbPerOct !== 12) throw new Error('Bessel crossovers are only available at 12 dB/octave');
    return [secondOrderHpfLpf(kind, freq, BESSEL_2ND_ORDER_Q, sampleRate)];
  }
  if (family === 'BUTTERWORTH') {
    const order = slopeDbPerOct / 6;
    return butterworthSections(order, kind, freq, sampleRate);
  }
  // Linkwitz-Riley of total order N = two cascaded Butterworth filters of order N/2
  const totalOrder = slopeDbPerOct / 6;
  const halfOrder = totalOrder / 2;
  const half = butterworthSections(halfOrder, kind, freq, sampleRate);
  return [...half, ...half];
}

/** Magnitude response in dB of a single biquad (minidsp sign convention) at freq. */
export function biquadMagnitudeDb(coeff: Biquad, freq: number, sampleRate: number): number {
  const w = (2 * Math.PI * freq) / sampleRate;
  const cos1 = Math.cos(w);
  const sin1 = Math.sin(w);
  const cos2 = Math.cos(2 * w);
  const sin2 = Math.sin(2 * w);

  const br = coeff.b0 + coeff.b1 * cos1 + coeff.b2 * cos2;
  const bi = -(coeff.b1 * sin1 + coeff.b2 * sin2);
  const ar = 1 - coeff.a1 * cos1 - coeff.a2 * cos2;
  const ai = coeff.a1 * sin1 + coeff.a2 * sin2;

  const magB = Math.sqrt(br * br + bi * bi);
  const magA = Math.sqrt(ar * ar + ai * ai);
  if (magA === 0) return 0;
  return 20 * Math.log10(magB / magA);
}

/** Combined (series-cascaded) magnitude response in dB of a list of biquads. */
export function combinedMagnitudeDb(coeffs: Biquad[], freq: number, sampleRate: number): number {
  return coeffs.reduce((sum, c) => sum + biquadMagnitudeDb(c, freq, sampleRate), 0);
}

export function logSpace(min: number, max: number, count: number): number[] {
  const logMin = Math.log10(min);
  const logMax = Math.log10(max);
  return Array.from({ length: count }, (_, i) => Math.pow(10, logMin + ((logMax - logMin) * i) / (count - 1)));
}
