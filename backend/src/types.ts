// Types mirror the *confirmed* minidsp-rs 0.1.12 OpenAPI schema
// (fetched live from a running minidspd instance, see plan doc for details).

export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export const UNITY_BIQUAD: Biquad = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };

export type PeqFilterType = 'PEAK' | 'LOW_SHELF' | 'HIGH_SHELF' | 'ALL_PASS';

/** UI-only "Basic mode" parameters. Not sent over the wire (minidsp-rs only
 * ever receives the derived `coeff`), but persisted so the editor can be
 * reopened later without losing the human-friendly representation - mirrors
 * the console's documented behavior that basic and advanced mode parameters
 * are stored independently of each other. */
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

export interface Duration {
  secs: number;
  nanos: number;
}

export interface RoutingEntry {
  index: number; // target output index
  gain: number;
  mute: boolean; // true = not routed
}

export type Source =
  | 'NotInstalled'
  | 'Analog'
  | 'Toslink'
  | 'Spdif'
  | 'Usb'
  | 'Aesebu'
  | 'Rca'
  | 'Xlr'
  | 'Lan'
  | 'I2S'
  | 'Bluetooth'
  | 'Hdmi';

// Only the sources physically wired on the 2x4 HD
export const MINIDSP_2X4HD_SOURCES: Source[] = ['Analog', 'Toslink', 'Usb'];

export interface MasterStatus {
  preset: number;
  source: Source;
  volume: number; // dB, [-127, 0]
  mute: boolean;
}

export interface InputChannelState {
  label: string;
  gain: number; // dB, [-72, 12]
  mute: boolean;
  peq: PeqSlot[]; // 10 slots
  routing: RoutingEntry[]; // one entry per output this input feeds
  linkedTo: number | null; // index of the other input this one mirrors, if any
}

export interface OutputChannelState {
  label: string;
  gain: number; // dB, [-72, 12]
  mute: boolean;
  invert: boolean;
  delayMs: number; // 0..80, converted to/from {secs,nanos} at the wire boundary
  peq: PeqSlot[]; // 10 slots
  crossover: CrossoverGroup[]; // exactly 2 groups (0=HP, 1=LP by UI convention)
  compressor: Compressor;
  fir: Fir;
  peqLinkedTo: number | null;
  crossoverLinkedTo: number | null;
}

export interface DeviceConfigState {
  presetIndex: number;
  presetName: string;
  inputs: InputChannelState[]; // length 2
  outputs: OutputChannelState[]; // length 4
}

export interface StatusSummary {
  master: MasterStatus;
  input_levels: number[];
  output_levels: number[];
}

export const NUM_INPUTS = 2;
export const NUM_OUTPUTS = 4;
export const NUM_PEQ_SLOTS = 10;
export const NUM_PRESETS = 4;
export const MAX_FIR_TAPS_TOTAL = 4096;
export const MAX_FIR_TAPS_PER_CHANNEL = 2048;
export const MIN_FIR_TAPS_PER_CHANNEL = 6;

export function defaultPeqSlots(): PeqSlot[] {
  return Array.from({ length: NUM_PEQ_SLOTS }, (_, index) => ({
    index,
    bypass: false,
    coeff: { ...UNITY_BIQUAD },
  }));
}

export function defaultCrossover(): CrossoverGroup[] {
  return [
    { index: 0, bypass: true, coeff: [] },
    { index: 1, bypass: true, coeff: [] },
  ];
}

export function defaultCompressor(): Compressor {
  return { bypass: true, threshold: -20, ratio: 2, attack: 1, release: 50 };
}

export function defaultFir(): Fir {
  return { bypass: true, coefficients: [] };
}

export function defaultInput(index: number): InputChannelState {
  return {
    label: `Input ${index + 1}`,
    gain: 0,
    mute: false,
    peq: defaultPeqSlots(),
    routing:
      // matches the documented factory default routing: In1->Out1/Out3, In2->Out2/Out4
      index === 0
        ? [
            { index: 0, gain: 0, mute: false },
            { index: 2, gain: 0, mute: false },
          ]
        : [
            { index: 1, gain: 0, mute: false },
            { index: 3, gain: 0, mute: false },
          ],
    linkedTo: null,
  };
}

export function defaultOutput(index: number): OutputChannelState {
  return {
    label: `Output ${index + 1}`,
    gain: 0,
    mute: false,
    invert: false,
    delayMs: 0,
    peq: defaultPeqSlots(),
    crossover: defaultCrossover(),
    compressor: defaultCompressor(),
    fir: defaultFir(),
    peqLinkedTo: null,
    crossoverLinkedTo: null,
  };
}

export function defaultDeviceConfigState(presetIndex: number): DeviceConfigState {
  return {
    presetIndex,
    presetName: `Config ${presetIndex + 1}`,
    inputs: Array.from({ length: NUM_INPUTS }, (_, i) => defaultInput(i)),
    outputs: Array.from({ length: NUM_OUTPUTS }, (_, i) => defaultOutput(i)),
  };
}

// ---- Wire-format types sent to POST /devices/{i}/config ----

export interface WireConfig {
  master_status?: Partial<{
    preset: number;
    source: Source;
    volume: number;
    mute: boolean;
  }>;
  inputs?: WireInput[];
  outputs?: WireOutput[];
}

export interface WireInput {
  index: number;
  gain?: number;
  mute?: boolean;
  peq?: { index: number; bypass?: boolean; coeff?: Biquad }[];
  routing?: { index: number; gain?: number; mute?: boolean }[];
}

export interface WireOutput {
  index: number;
  gain?: number;
  mute?: boolean;
  invert?: boolean;
  delay?: Duration;
  peq?: { index: number; bypass?: boolean; coeff?: Biquad }[];
  // minidspd rejects a crossover biquad that doesn't carry its own `index`
  // ("Internal error: biquad index not specified") - array position alone
  // is not enough, unlike PEQ/routing entries.
  crossover?: { index: number; bypass?: boolean; coeff?: (Biquad & { index: number })[] }[];
  compressor?: Partial<Compressor>;
  fir?: Partial<Fir>;
}
