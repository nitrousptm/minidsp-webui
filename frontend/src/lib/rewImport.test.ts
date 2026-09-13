import { describe, expect, it } from 'vitest';
import { detectRewFormat, importRewText, parseRewBiquadBlocks, parseRewFilterSettings } from './rewImport';

const FILTER_SETTINGS_EXPORT = `Filter Settings file

Room EQ V5.20
Dated: 27/07/2026 15:00:00

Notes:

Equaliser: Generic

Filter  1: ON  PK       Fc    100.0 Hz  Gain   3.00 dB  Q  4.318
Filter  2: ON  PK       Fc    500.0 Hz  Gain  -2.50 dB  Q  2.000
Filter  3: ON  LS       Fc     50.0 Hz  Gain   2.00 dB
Filter  4: ON  HS       Fc  10000.0 Hz  Gain  -1.00 dB  Q  0.707
Filter  5: OFF PK       Fc   1000.0 Hz  Gain   0.00 dB  Q  1.000
Filter  6: ON  AP       Fc    200.0 Hz  Gain   0.00 dB  Q  0.700
Filter  7: ON  NO       Fc    60.0 Hz  Gain -12.00 dB  Q  10.000
`;

const BIQUAD_EXPORT = `
biquad1,
b0=1.000850526425243,
b1=-1.9974894004215842,
b2=0.9966390543291246,
a1=1.9974894004215842,
a2=-0.9975295807543676,

biquad2,
b0=0.998191200483864,
b1=-1.9950521500467384,
b2=0.996920046761057,
a1=1.9950521500467384,
a2=-0.9951112472449212,
`;

describe('detectRewFormat', () => {
  it('detects a Filter Settings export', () => {
    expect(detectRewFormat(FILTER_SETTINGS_EXPORT)).toBe('filter-settings');
  });
  it('detects a biquad coefficients export', () => {
    expect(detectRewFormat(BIQUAD_EXPORT)).toBe('biquad');
  });
  it('falls back to unknown for unrelated text', () => {
    expect(detectRewFormat('hello world')).toBe('unknown');
  });
});

describe('parseRewFilterSettings', () => {
  it('parses PK/LS/HS/AP filters with correct type mapping, on/off state, and values', () => {
    const { filters, warnings } = parseRewFilterSettings(FILTER_SETTINGS_EXPORT);

    expect(filters).toHaveLength(6); // 7 lines minus the unsupported "NO" notch
    expect(filters[0]).toEqual({
      filterNumber: 1,
      bypass: false,
      basic: { type: 'PEAK', freq: 100, gainDb: 3, q: 4.318 },
    });
    expect(filters[2].basic).toEqual({ type: 'LOW_SHELF', freq: 50, gainDb: 2, q: 0.707 }); // default shelf Q
    expect(filters[4].bypass).toBe(true); // Filter 5 is OFF
    expect(filters[5].basic.type).toBe('ALL_PASS');

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Filter 7.*NO.*not supported/i);
  });

  it('warns when no filter lines are found at all', () => {
    const { filters, warnings } = parseRewFilterSettings('not a REW export');
    expect(filters).toHaveLength(0);
    expect(warnings[0]).toMatch(/No "Filter N/);
  });
});

describe('parseRewBiquadBlocks', () => {
  it('parses each biquad block into a Biquad in order', () => {
    const { coeffs, warnings } = parseRewBiquadBlocks(BIQUAD_EXPORT);
    expect(warnings).toHaveLength(0);
    expect(coeffs).toHaveLength(2);
    expect(coeffs[0]).toEqual({
      b0: 1.000850526425243,
      b1: -1.9974894004215842,
      b2: 0.9966390543291246,
      a1: 1.9974894004215842,
      a2: -0.9975295807543676,
    });
    expect(coeffs[1].b0).toBeCloseTo(0.998191200483864);
  });
});

describe('importRewText', () => {
  it('routes to the filter-settings parser', () => {
    const result = importRewText(FILTER_SETTINGS_EXPORT);
    expect(result.format).toBe('filter-settings');
    expect(result.filters.length).toBeGreaterThan(0);
  });

  it('routes to the biquad parser', () => {
    const result = importRewText(BIQUAD_EXPORT);
    expect(result.format).toBe('biquad');
    expect(result.coeffs.length).toBeGreaterThan(0);
  });

  it('reports unknown formats without throwing', () => {
    const result = importRewText('garbage input');
    expect(result.format).toBe('unknown');
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
