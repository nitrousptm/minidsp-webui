import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { config } from '../config.js';
import { MockTonePlayer } from './mockTonePlayer.js';

const execFileP = promisify(execFile);

export interface TonePlayer {
  /**
   * Starts playing a continuous logarithmic sine sweep from f0 to f1 Hz over
   * durationSec seconds and returns as soon as playback has started. The
   * returned `stop()` must be awaited once the sweep is done (or should be
   * cut short) - it only resolves once the ALSA device has actually been
   * released, which matters for starting the next sweep cleanly (see
   * AlsaSweepPlayer for why).
   */
  startLogSweep(f0: number, f1: number, durationSec: number, amplitude: number): Promise<() => Promise<void>>;
  /** Best-effort pause of local music playback (moOde's MPD) so the ALSA
   * device isn't held exclusively. Returns a function that restores it. */
  pausePlaybackForTest(): Promise<() => Promise<void>>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tryRun(cmd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileP(cmd, args, { timeout: 3000 });
    return stdout;
  } catch {
    return ''; // best-effort only (e.g. mpc not installed, or nothing was playing)
  }
}

const SWEEP_SAMPLE_RATE = 48000;
const FADE_SEC = 0.02;

function buildWavHeader(dataLength: number, sampleRate: number, numChannels: number): Buffer {
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const buf = Buffer.alloc(44);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataLength, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataLength, 40);
  return buf;
}

/**
 * Exponential ("log") sine sweep: instantaneous frequency at time t is
 * f0 * (f1/f0)^(t/durationSec), the standard shape for acoustic sweep
 * measurements (equal time per octave, not per Hz). `sweepTimeConstant`
 * (K in the phase formula) is also what verify.ts needs to invert the
 * sweep - i.e. to recover "what frequency was playing at this timestamp" -
 * so it's exported rather than kept private to this module.
 */
export function sweepTimeConstant(f0: number, f1: number, durationSec: number): number {
  return durationSec / Math.log(f1 / f0);
}

export function freqAtElapsed(f0: number, elapsedSec: number, K: number): number {
  return f0 * Math.exp(elapsedSec / K);
}

// The 2x4HD's ALSA hardware device doesn't accept mono PCM directly ("hw:"
// gives raw hardware access with no automatic channel conversion, unlike
// "plughw:") - confirmed empirically ("Channels count non available" from
// aplay). Both channels carry an identical signal.
const NUM_CHANNELS = 2;

function generateLogSweepWav(f0: number, f1: number, durationSec: number, amplitude: number): Buffer {
  const numSamples = Math.floor(durationSec * SWEEP_SAMPLE_RATE);
  const K = sweepTimeConstant(f0, f1, durationSec);
  const fadeSamples = Math.floor(FADE_SEC * SWEEP_SAMPLE_RATE);
  const data = Buffer.alloc(numSamples * 2 * NUM_CHANNELS);
  for (let n = 0; n < numSamples; n++) {
    const t = n / SWEEP_SAMPLE_RATE;
    const phase = 2 * Math.PI * f0 * K * (Math.exp(t / K) - 1);
    let env = 1;
    if (n < fadeSamples) env = 0.5 * (1 - Math.cos((Math.PI * n) / fadeSamples));
    else if (n > numSamples - fadeSamples) env = 0.5 * (1 - Math.cos((Math.PI * (numSamples - n)) / fadeSamples));
    const sample = Math.sin(phase) * amplitude * env;
    const intSample = Math.max(-32767, Math.min(32767, Math.round(sample * 32767)));
    for (let ch = 0; ch < NUM_CHANNELS; ch++) {
      data.writeInt16LE(intSample, (n * NUM_CHANNELS + ch) * 2);
    }
  }
  return Buffer.concat([buildWavHeader(data.length, SWEEP_SAMPLE_RATE, NUM_CHANNELS), data]);
}

export class AlsaSweepPlayer implements TonePlayer {
  async startLogSweep(f0: number, f1: number, durationSec: number, amplitude: number): Promise<() => Promise<void>> {
    const wav = generateLogSweepWav(f0, f1, durationSec, amplitude);
    const filePath = path.join(tmpdir(), `minidsp-hil-sweep-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
    await writeFile(filePath, wav);

    const proc = spawn('aplay', ['-D', config.alsaDevice, '-q', filePath], { stdio: 'ignore' });
    proc.on('error', () => {
      /* surfaced naturally: the level readings afterwards will just show silence */
    });
    // Same fix as before (single-tone version): must wait for the process to
    // actually exit and release the ALSA device before the next sweep starts,
    // or the following measurement can silently read the noise floor instead
    // of the real signal.
    const exited = new Promise<void>((resolve) => {
      proc.once('exit', () => resolve());
      proc.once('error', () => resolve());
    });
    return async () => {
      if (proc.exitCode === null) proc.kill('SIGTERM');
      await Promise.race([exited, sleep(1000)]);
      await unlink(filePath).catch(() => {});
    };
  }

  async pausePlaybackForTest(): Promise<() => Promise<void>> {
    const status = await tryRun('mpc', ['status']);
    const wasPlaying = status.includes('[playing]');
    await tryRun('mpc', ['pause']);
    return async () => {
      if (wasPlaying) await tryRun('mpc', ['play']);
    };
  }
}

export function createTonePlayer(): TonePlayer {
  return config.useMock ? new MockTonePlayer() : new AlsaSweepPlayer();
}
