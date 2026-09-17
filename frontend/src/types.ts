export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export type PeqFilterType = 'PEAK' | 'LOW_SHELF' | 'HIGH_SHELF' | 'ALL_PASS';

export interface PeqBasicParams {
  type: PeqFilterType;
  freq: number;
  gainDb: number;
  q: number;
}

export interface PeqSlot {
  index: number;
  bypass: boolean;
  coeff: Biquad;
  basic?: PeqBasicParams;
}

export type CrossoverFamily = 'BUTTERWORTH' | 'LINKWITZ_RILEY' | 'BESSEL';

export interface CrossoverBasicParams {
  family: CrossoverFamily;
  slopeDbPerOct: number;
  freq: number;
}

export interface CrossoverGroup {
  index: 0 | 1;
  bypass: boolean;
  coeff: Biquad[];
  basic?: CrossoverBasicParams;
}

export interface Compressor {
  bypass: boolean;
  threshold: number;
  ratio: number;
  attack: number;
  release: number;
}

export interface Fir {
  bypass: boolean;
  coefficients: number[];
}

export interface RoutingEntry {
  index: number;
  gain: number;
  mute: boolean;
}

export type Source = 'Analog' | 'Toslink' | 'Usb';

export interface MasterStatus {
  preset: number;
  source: Source;
  volume: number;
  mute: boolean;
}

export interface InputChannelState {
  label: string;
  gain: number;
  mute: boolean;
  peq: PeqSlot[];
  routing: RoutingEntry[];
  linkedTo: number | null;
}

export interface OutputChannelState {
  label: string;
  gain: number;
  mute: boolean;
  invert: boolean;
  delayMs: number;
  peq: PeqSlot[];
  crossover: CrossoverGroup[];
  compressor: Compressor;
  fir: Fir;
  peqLinkedTo: number | null;
  crossoverLinkedTo: number | null;
}

export interface DeviceConfigState {
  presetIndex: number;
  presetName: string;
  inputs: InputChannelState[];
  outputs: OutputChannelState[];
}

export interface StatusSummary {
  master: MasterStatus;
  input_levels: number[];
  output_levels: number[];
}

/**
 * The 2x4 HD's USB volume control as seen by the backend host (read-only).
 * Sits in front of the DSP master volume and adds to it; only present when
 * something on the host - e.g. moOde with hardware volume - can drive it.
 */
export interface HostVolume {
  available: true;
  card: number;
  control: string;
  raw: number;
  rawMin: number;
  rawMax: number;
  dB: number;
  mute: boolean | null;
}
export type HostVolumeResponse = HostVolume | { available: false };

export interface DeviceInfoResponse {
  device: { product_name: string | null; version: { serial: number; fw_major: number; fw_minor: number } | null } | null;
  layout: {
    numInputs: number;
    numOutputs: number;
    numPeqSlots: number;
    numPresets: number;
    availableSources: Source[];
  };
}

export interface PresetSummary {
  index: number;
  name: string;
  active: boolean;
}

/** Result of a hardware-in-the-loop sweep: at each frequency, the level
 * measured with the filter under test active minus the level measured with
 * it bypassed - directly comparable to the theoretical combined-magnitude
 * curve already drawn on the PEQ/crossover charts. */
export interface SweepResult {
  frequencies: number[];
  measuredDeltaDb: number[];
}

export interface PeqVerifyResult {
  frequencies: number[];
  /** Each of the 10 PEQ slots measured in isolation (all other 9 held
   * bypassed for that pass), so a discrepancy can be pinned on one slot. */
  perSlot: { index: number; measuredDeltaDb: number[] }[];
  /** All 10 slots active together, exactly as configured. */
  combined: SweepResult;
}

export interface CrossoverVerifyResult {
  frequencies: number[];
  highpass: SweepResult;
  lowpass: SweepResult;
  combined: SweepResult;
}

export const GAIN_RANGE = { min: -72, max: 12, step: 0.1 };
export const PEQ_GAIN_RANGE = { min: -16, max: 16, step: 0.1 };
export const MASTER_VOLUME_RANGE = { min: -127, max: 0, step: 0.5 };
export const DELAY_RANGE_MS = { min: 0, max: 80, step: 0.01 };
export const LEVEL_METER_RANGE = { min: -72, max: 12 };
export const SAMPLE_RATE = 96000;
export const MAX_FIR_TAPS_TOTAL = 4096;
export const MAX_FIR_TAPS_PER_CHANNEL = 2048;
export const MIN_FIR_TAPS_PER_CHANNEL = 6;
