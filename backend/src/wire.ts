import type {
  Biquad,
  Compressor,
  CrossoverGroup,
  Duration,
  Fir,
  InputChannelState,
  OutputChannelState,
  PeqSlot,
  RoutingEntry,
  Source,
  WireConfig,
  WireInput,
  WireOutput,
} from './types.js';

export function msToDuration(ms: number): Duration {
  const totalNanos = Math.round(ms * 1_000_000);
  return { secs: Math.floor(totalNanos / 1_000_000_000), nanos: totalNanos % 1_000_000_000 };
}

export function durationToMs(d: Duration): number {
  return (d.secs * 1_000_000_000 + d.nanos) / 1_000_000;
}

export function wirePeq(slots: PeqSlot[]): { index: number; bypass: boolean; coeff: Biquad }[] {
  return slots.map((s) => ({ index: s.index, bypass: s.bypass, coeff: s.coeff }));
}

export function wireRouting(entries: RoutingEntry[]): { index: number; gain: number; mute: boolean }[] {
  return entries.map((e) => ({ index: e.index, gain: e.gain, mute: e.mute }));
}

/**
 * Unlike PEQ/routing entries, minidspd requires each biquad *within* a
 * crossover group's coefficient array to carry its own `index` (0..3) - the
 * position in the array alone is not enough (confirmed against the live
 * minidspd error "biquad index not specified" when omitted).
 */
function indexedCoeff(coeff: Biquad[]): (Biquad & { index: number })[] {
  return coeff.map((c, i) => ({ ...c, index: i }));
}

export function wireCrossover(groups: CrossoverGroup[]): { index: number; bypass: boolean; coeff: (Biquad & { index: number })[] }[] {
  return groups.map((g) => ({ index: g.index, bypass: g.bypass, coeff: indexedCoeff(g.coeff) }));
}

export function wireInput(index: number, input: InputChannelState): WireInput {
  return {
    index,
    gain: input.gain,
    mute: input.mute,
    peq: wirePeq(input.peq),
    routing: wireRouting(input.routing),
  };
}

export function wireOutput(index: number, output: OutputChannelState): WireOutput {
  return {
    index,
    gain: output.gain,
    mute: output.mute,
    invert: output.invert,
    delay: msToDuration(output.delayMs),
    peq: wirePeq(output.peq),
    crossover: wireCrossover(output.crossover),
    compressor: output.compressor,
    fir: output.fir,
  };
}

export function buildMasterStatusWire(patch: {
  preset?: number;
  source?: Source;
  volume?: number;
  mute?: boolean;
}): WireConfig {
  return { master_status: patch };
}

export function buildInputPatchWire(index: number, patch: Partial<WireInput>): WireConfig {
  return { inputs: [{ index, ...patch }] };
}

export function buildOutputPatchWire(index: number, patch: Partial<WireOutput>): WireConfig {
  return { outputs: [{ index, ...patch }] };
}

export function buildPeqWire(
  channel: 'input' | 'output',
  channelIndex: number,
  peqIndex: number,
  patch: { bypass?: boolean; coeff?: Biquad },
): WireConfig {
  const entry = { index: peqIndex, ...patch };
  return channel === 'input'
    ? { inputs: [{ index: channelIndex, peq: [entry] }] }
    : { outputs: [{ index: channelIndex, peq: [entry] }] };
}

export function buildRoutingWire(
  inputIndex: number,
  outputIndex: number,
  patch: { gain?: number; mute?: boolean },
): WireConfig {
  return { inputs: [{ index: inputIndex, routing: [{ index: outputIndex, ...patch }] }] };
}

export function buildCrossoverWire(
  outputIndex: number,
  groupIndex: 0 | 1,
  patch: { bypass?: boolean; coeff?: Biquad[] },
): WireConfig {
  const entry: { index: 0 | 1; bypass?: boolean; coeff?: (Biquad & { index: number })[] } = {
    index: groupIndex,
    bypass: patch.bypass,
  };
  if (patch.coeff) entry.coeff = indexedCoeff(patch.coeff);
  return { outputs: [{ index: outputIndex, crossover: [entry] }] };
}

export function buildCompressorWire(outputIndex: number, patch: Partial<Compressor>): WireConfig {
  return { outputs: [{ index: outputIndex, compressor: patch }] };
}

export function buildFirWire(outputIndex: number, patch: Partial<Fir>): WireConfig {
  return { outputs: [{ index: outputIndex, fir: patch }] };
}

export function buildDelayWire(outputIndex: number, ms: number): WireConfig {
  return { outputs: [{ index: outputIndex, delay: msToDuration(ms) }] };
}
