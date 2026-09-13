import type { MinidspClient } from '../minidspClient.js';
import type { ConfigStore } from '../store.js';
import type { TonePlayer } from './tonePlayer.js';
import { freqAtElapsed, sweepTimeConstant } from './tonePlayer.js';
import { buildCompressorWire, buildCrossoverWire, buildPeqWire } from '../wire.js';
import type { CrossoverGroup, PeqSlot } from '../types.js';
import { config } from '../config.js';

function logSpace(min: number, max: number, count: number): number[] {
  const logMin = Math.log10(min);
  const logMax = Math.log10(max);
  return Array.from({ length: count }, (_, i) => Math.pow(10, logMin + ((logMax - logMin) * i) / (count - 1)));
}

const FREQ_MIN = 20;
const FREQ_MAX = 20000;
// Matched to the ~100-150 raw samples a production sweep actually collects
// (6s at a 40ms poll interval) - a coarser grid would throw away real
// resolution the sweep already gathered, a much finer one would just be
// interpolating between the same underlying points.
const DEFAULT_GRID = logSpace(FREQ_MIN, FREQ_MAX, 150);

export interface SweepOptions {
  /** Frequencies the final result is resampled onto. Defaults to 150
   * log-spaced points 20Hz-20kHz - this is independent of how many raw
   * samples the sweep itself collects. */
  grid?: number[];
  /** How long one continuous sweep takes, start to finish. Production
   * default is a "few seconds" sweep as requested; tests override this to
   * keep runs fast. */
  durationSec?: number;
  /** How often the output level is sampled while a sweep plays. */
  pollIntervalMs?: number;
  amplitude?: number;
}

export interface SweepResult {
  frequencies: number[];
  measuredDeltaDb: number[];
}

interface RawSample {
  freq: number;
  levelDb: number;
}

/**
 * Plays one continuous log sweep and samples the output level throughout,
 * pairing each reading with the frequency that was actually playing at that
 * moment (derived from elapsed time via the sweep's own exponential shape,
 * not from a list of discrete tones).
 */
async function sweepAndCollect(
  client: MinidspClient,
  tonePlayer: TonePlayer,
  outputIndex: number,
  f0: number,
  f1: number,
  durationSec: number,
  pollIntervalMs: number,
  amplitude: number,
): Promise<RawSample[]> {
  const K = sweepTimeConstant(f0, f1, durationSec);
  const stop = await tonePlayer.startLogSweep(f0, f1, durationSec, amplitude);
  const samples: RawSample[] = [];
  const startedAt = Date.now();
  // Give playback a moment to actually reach the DAC before the first
  // reading, mirroring the settle window the discrete-tone version used.
  const initialDelayMs = Math.min(150, (durationSec * 1000) / 4);
  await new Promise((resolve) => setTimeout(resolve, initialDelayMs));
  for (;;) {
    const elapsedSec = (Date.now() - startedAt) / 1000;
    if (elapsedSec >= durationSec) break;
    const status = await client.getStatus();
    samples.push({ freq: freqAtElapsed(f0, elapsedSec, K), levelDb: status.output_levels[outputIndex] ?? -150 });
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  await stop();
  if (samples.length === 0) {
    // Degenerate case (e.g. a test-only near-zero duration): fall back to a
    // single reading so resampling still has something to interpolate from.
    const status = await client.getStatus();
    samples.push({ freq: (f0 + f1) / 2, levelDb: status.output_levels[outputIndex] ?? -150 });
  }
  return samples;
}

/** Linear interpolation in log-frequency space onto an arbitrary target grid.
 * Samples are assumed sorted ascending by frequency, true for our sweep
 * since frequency only increases over time. */
function resampleToGrid(samples: RawSample[], grid: number[]): number[] {
  const xs = samples.map((s) => Math.log10(s.freq));
  const ys = samples.map((s) => s.levelDb);
  return grid.map((f) => {
    const x = Math.log10(f);
    if (x <= xs[0]) return ys[0];
    if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
    let i = 0;
    while (i < xs.length - 2 && xs[i + 1] < x) i++;
    const x0 = xs[i], x1 = xs[i + 1], y0 = ys[i], y1 = ys[i + 1];
    const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
    return y0 + t * (y1 - y0);
  });
}

function delta(measured: number[], reference: number[]): number[] {
  return measured.map((m, i) => m - reference[i]);
}

/**
 * The compressor is the only *nonlinear* block in the signal path - its
 * gain reduction depends on signal level, which changes as the filter under
 * test is toggled on/off. Bypassing it for the duration of a sweep keeps
 * the reference/measurement comparison attributable to the filter alone.
 */
async function withCompressorBypassed(
  client: MinidspClient,
  store: ConfigStore,
  outputIndex: number,
  fn: () => Promise<void>,
): Promise<void> {
  const output = store.getState().outputs[outputIndex];
  const originalBypass = output.compressor.bypass;

  async function setBypass(bypass: boolean): Promise<void> {
    output.compressor = { ...output.compressor, bypass };
    await store.persistActive();
    await client.postConfig(buildCompressorWire(outputIndex, { bypass }));
  }

  if (!originalBypass) await setBypass(true);
  try {
    await fn();
  } finally {
    if (!originalBypass) await setBypass(false);
  }
}

function resolveOptions(options: SweepOptions) {
  return {
    grid: options.grid ?? DEFAULT_GRID,
    durationSec: options.durationSec ?? config.hilSweepDurationSec,
    pollIntervalMs: options.pollIntervalMs ?? config.hilSweepPollIntervalMs,
    amplitude: options.amplitude ?? 0.4,
  };
}

async function runSweep(
  client: MinidspClient,
  tonePlayer: TonePlayer,
  outputIndex: number,
  grid: number[],
  durationSec: number,
  pollIntervalMs: number,
  amplitude: number,
): Promise<number[]> {
  const raw = await sweepAndCollect(client, tonePlayer, outputIndex, FREQ_MIN, FREQ_MAX, durationSec, pollIntervalMs, amplitude);
  return resampleToGrid(raw, grid);
}

export interface PeqVerifyResult {
  frequencies: number[];
  /** Each of the 10 PEQ slots tested in isolation (all other 9 held bypassed) -
   * pinpoints exactly which slot is responsible for a given effect. */
  perSlot: { index: number; measuredDeltaDb: number[] }[];
  /** All 10 slots active together, exactly as configured - what actually
   * plays in normal use. */
  combined: SweepResult;
}

export async function verifyPeq(
  client: MinidspClient,
  store: ConfigStore,
  tonePlayer: TonePlayer,
  outputIndex: number,
  options: SweepOptions = {},
): Promise<PeqVerifyResult> {
  const { grid, durationSec, pollIntervalMs, amplitude } = resolveOptions(options);

  const restorePlayback = await tonePlayer.pausePlaybackForTest();
  try {
    const perSlot: { index: number; measuredDeltaDb: number[] }[] = [];
    let combined: SweepResult = { frequencies: grid, measuredDeltaDb: grid.map(() => 0) };

    await withCompressorBypassed(client, store, outputIndex, async () => {
      const output = store.getState().outputs[outputIndex];
      const originalPeq: PeqSlot[] = output.peq.map((slot) => ({ ...slot }));

      async function applyPeqState(slots: PeqSlot[]): Promise<void> {
        output.peq = slots.map((s) => ({ ...s }));
        await store.persistActive();
        for (const slot of slots) {
          await client.postConfig(
            buildPeqWire('output', outputIndex, slot.index, { bypass: slot.bypass, coeff: slot.coeff }),
          );
        }
      }

      try {
        const allBypassed = originalPeq.map((s) => ({ ...s, bypass: true }));
        await applyPeqState(allBypassed);
        const referenceLevels = await runSweep(client, tonePlayer, outputIndex, grid, durationSec, pollIntervalMs, amplitude);

        for (const slot of originalPeq) {
          const onlyThisSlot = allBypassed.map((s) => (s.index === slot.index ? { ...slot } : s));
          await applyPeqState(onlyThisSlot);
          const levels = await runSweep(client, tonePlayer, outputIndex, grid, durationSec, pollIntervalMs, amplitude);
          perSlot.push({ index: slot.index, measuredDeltaDb: delta(levels, referenceLevels) });
        }

        await applyPeqState(originalPeq);
        const combinedLevels = await runSweep(client, tonePlayer, outputIndex, grid, durationSec, pollIntervalMs, amplitude);
        combined = { frequencies: grid, measuredDeltaDb: delta(combinedLevels, referenceLevels) };
      } finally {
        await applyPeqState(originalPeq);
      }
    });

    return { frequencies: grid, perSlot, combined };
  } finally {
    await restorePlayback();
  }
}

export interface CrossoverVerifyResult {
  frequencies: number[];
  highpass: SweepResult;
  lowpass: SweepResult;
  combined: SweepResult;
}

export async function verifyCrossover(
  client: MinidspClient,
  store: ConfigStore,
  tonePlayer: TonePlayer,
  outputIndex: number,
  options: SweepOptions = {},
): Promise<CrossoverVerifyResult> {
  const { grid, durationSec, pollIntervalMs, amplitude } = resolveOptions(options);

  const restorePlayback = await tonePlayer.pausePlaybackForTest();
  try {
    let highpass: SweepResult = { frequencies: grid, measuredDeltaDb: grid.map(() => 0) };
    let lowpass: SweepResult = { frequencies: grid, measuredDeltaDb: grid.map(() => 0) };
    let combined: SweepResult = { frequencies: grid, measuredDeltaDb: grid.map(() => 0) };

    await withCompressorBypassed(client, store, outputIndex, async () => {
      const output = store.getState().outputs[outputIndex];
      const originalCrossover: CrossoverGroup[] = output.crossover.map((g) => ({ ...g, coeff: [...g.coeff] }));
      const hpGroup = originalCrossover.find((g) => g.index === 0)!;
      const lpGroup = originalCrossover.find((g) => g.index === 1)!;

      async function applyCrossoverState(groups: CrossoverGroup[]): Promise<void> {
        output.crossover = groups.map((g) => ({ ...g, coeff: [...g.coeff] }));
        await store.persistActive();
        for (const g of groups) {
          await client.postConfig(buildCrossoverWire(outputIndex, g.index, { bypass: g.bypass, coeff: g.coeff }));
        }
      }

      try {
        const bothBypassed = originalCrossover.map((g) => ({ ...g, bypass: true }));
        await applyCrossoverState(bothBypassed);
        const referenceLevels = await runSweep(client, tonePlayer, outputIndex, grid, durationSec, pollIntervalMs, amplitude);

        await applyCrossoverState(bothBypassed.map((g) => (g.index === 0 ? { ...hpGroup } : g)));
        const hpLevels = await runSweep(client, tonePlayer, outputIndex, grid, durationSec, pollIntervalMs, amplitude);
        highpass = { frequencies: grid, measuredDeltaDb: delta(hpLevels, referenceLevels) };

        await applyCrossoverState(bothBypassed.map((g) => (g.index === 1 ? { ...lpGroup } : g)));
        const lpLevels = await runSweep(client, tonePlayer, outputIndex, grid, durationSec, pollIntervalMs, amplitude);
        lowpass = { frequencies: grid, measuredDeltaDb: delta(lpLevels, referenceLevels) };

        await applyCrossoverState(originalCrossover);
        const combinedLevels = await runSweep(client, tonePlayer, outputIndex, grid, durationSec, pollIntervalMs, amplitude);
        combined = { frequencies: grid, measuredDeltaDb: delta(combinedLevels, referenceLevels) };
      } finally {
        await applyCrossoverState(originalCrossover);
      }
    });

    return { frequencies: grid, highpass, lowpass, combined };
  } finally {
    await restorePlayback();
  }
}
