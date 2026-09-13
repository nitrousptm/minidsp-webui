import type { Biquad, PeqBasicParams, PeqFilterType } from '../types';

/**
 * Parses text exported by REW ("Export Filter Settings as text" / "Equaliser:
 * Generic" in the EQ tab). Only filter types the 2x4 HD's PEQ block actually
 * supports (PEAK, LOW_SHELF, HIGH_SHELF, ALL_PASS) are converted; anything
 * else (notch, variable-Q high/low pass, modal filters, ...) is reported as
 * a warning and skipped rather than silently approximated.
 */

const REW_TYPE_MAP: Record<string, PeqFilterType> = {
  PK: 'PEAK',
  LS: 'LOW_SHELF',
  LSC: 'LOW_SHELF',
  HS: 'HIGH_SHELF',
  HSC: 'HIGH_SHELF',
  AP: 'ALL_PASS',
};

const DEFAULT_SHELF_Q = 0.707;

export interface ParsedPeqFilter {
  filterNumber: number; // 1-based, as printed by REW
  bypass: boolean;
  basic: PeqBasicParams;
}

export interface RewImportResult {
  format: 'filter-settings' | 'biquad' | 'unknown';
  filters: ParsedPeqFilter[]; // populated for 'filter-settings'
  coeffs: Biquad[]; // populated for 'biquad'
  warnings: string[];
}

const FILTER_LINE =
  /^Filter\s+(\d+):\s*(ON|OFF)\s+([A-Za-z]+)\s+Fc\s+([\d.]+)\s*Hz\s+Gain\s+(-?[\d.]+)\s*dB(?:\s+Q\s+([\d.]+))?/i;

export function detectRewFormat(text: string): 'filter-settings' | 'biquad' | 'unknown' {
  if (/^\s*Filter\s+\d+:/m.test(text)) return 'filter-settings';
  if (/biquad\s*\d*/i.test(text) && /\bb0\s*=/.test(text) && /\ba1\s*=/.test(text)) return 'biquad';
  return 'unknown';
}

export function parseRewFilterSettings(text: string): { filters: ParsedPeqFilter[]; warnings: string[] } {
  const filters: ParsedPeqFilter[] = [];
  const warnings: string[] = [];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    const match = line.match(FILTER_LINE);
    if (!match) continue;

    const [, numStr, state, typeCode, fcStr, gainStr, qStr] = match;
    const filterNumber = Number(numStr);
    const rewType = typeCode.toUpperCase();
    const mappedType = REW_TYPE_MAP[rewType];

    if (!mappedType) {
      warnings.push(
        `Filter ${filterNumber}: type "${rewType}" is not supported by the 2x4 HD's PEQ (only Peaking, Low/High Shelf, All-Pass) — skipped.`,
      );
      continue;
    }

    const freq = Number(fcStr);
    const gainDb = mappedType === 'ALL_PASS' ? 0 : Number(gainStr);
    const q = qStr !== undefined ? Number(qStr) : mappedType === 'PEAK' || mappedType === 'ALL_PASS' ? 1 : DEFAULT_SHELF_Q;

    filters.push({
      filterNumber,
      bypass: state.toUpperCase() === 'OFF',
      basic: { type: mappedType, freq, gainDb, q },
    });
  }

  if (filters.length === 0) {
    warnings.push('No "Filter N: ON/OFF ..." lines found — is this a REW "Filter Settings" export?');
  }

  return { filters, warnings };
}

export function parseRewBiquadBlocks(text: string): { coeffs: Biquad[]; warnings: string[] } {
  const warnings: string[] = [];
  const coeffs: Biquad[] = [];

  // Split on "biquadN" markers; fall back to treating the whole text as one block.
  const blocks = text.split(/biquad\s*\d*\s*,?/i).filter((b) => b.trim().length > 0);
  const source = blocks.length > 0 ? blocks : [text];

  for (const block of source) {
    const values: Partial<Record<'b0' | 'b1' | 'b2' | 'a1' | 'a2', number>> = {};
    for (const m of block.matchAll(/\b(b0|b1|b2|a1|a2)\s*=\s*(-?[\d.eE+-]+)/g)) {
      values[m[1] as 'b0' | 'b1' | 'b2' | 'a1' | 'a2'] = Number(m[2]);
    }
    const keys: Array<'b0' | 'b1' | 'b2' | 'a1' | 'a2'> = ['b0', 'b1', 'b2', 'a1', 'a2'];
    if (keys.every((k) => values[k] !== undefined)) {
      coeffs.push({ b0: values.b0!, b1: values.b1!, b2: values.b2!, a1: values.a1!, a2: values.a2! });
    } else if (keys.some((k) => values[k] !== undefined)) {
      warnings.push('A biquad block was missing one or more coefficients (b0, b1, b2, a1, a2) and was skipped.');
    }
  }

  if (coeffs.length === 0) {
    warnings.push('No complete biquad coefficient blocks were found.');
  }

  return { coeffs, warnings };
}

export function importRewText(text: string): RewImportResult {
  const format = detectRewFormat(text);
  if (format === 'filter-settings') {
    const { filters, warnings } = parseRewFilterSettings(text);
    return { format, filters, coeffs: [], warnings };
  }
  if (format === 'biquad') {
    const { coeffs, warnings } = parseRewBiquadBlocks(text);
    return { format, filters: [], coeffs, warnings };
  }
  return {
    format: 'unknown',
    filters: [],
    coeffs: [],
    warnings: [
      'Could not recognize this as a REW "Filter Settings" export or a REW/biquad coefficients export.',
    ],
  };
}
