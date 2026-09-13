import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConfigStore } from '../store.js';
import { verifyCrossover, verifyPeq } from './verify.js';
import type { TonePlayer } from './tonePlayer.js';
import type { MinidspClient, DeviceInfo } from '../minidspClient.js';
import type { StatusSummary, WireConfig } from '../types.js';

// Fast enough that a 12-sweep PEQ verify (1 reference + 10 slots + 1
// combined) still completes in well under a second.
const FAST_OPTIONS = { durationSec: 0.03, pollIntervalMs: 5 };

/**
 * Doesn't model real DSP math - just tracks which PEQ slots/crossover
 * groups/compressor are currently bypassed and reports a level built from
 * fixed, independent per-slot/per-group "if active" contributions. That's
 * enough to prove per-slot isolation, combined summation, and restore
 * behavior without needing real audio.
 */
class FakeVerifyClient implements MinidspClient {
  peqBypassed = new Array(10).fill(true);
  peqSlotGainDb = new Array(10).fill(0);
  crossoverBypassed = [true, true];
  crossoverGainDb = [0, 0]; // [highpass, lowpass]
  compressorBypassed = true;
  statusCallCount = 0;
  failStatusOnCall: number | null = null;

  async listDevices(): Promise<DeviceInfo[]> {
    return [];
  }

  async getStatus(): Promise<StatusSummary> {
    this.statusCallCount++;
    if (this.failStatusOnCall === this.statusCallCount) {
      throw new Error('simulated transient minidspd failure');
    }
    let level = -20;
    this.peqBypassed.forEach((bypassed, i) => {
      if (!bypassed) level += this.peqSlotGainDb[i];
    });
    if (!this.crossoverBypassed[0]) level += this.crossoverGainDb[0];
    if (!this.crossoverBypassed[1]) level += this.crossoverGainDb[1];
    return { master: { preset: 0, source: 'Usb', volume: -20, mute: false }, input_levels: [-30, -30], output_levels: [level, level, level, level] };
  }

  async postConfig(cfg: WireConfig): Promise<void> {
    for (const output of cfg.outputs ?? []) {
      for (const p of output.peq ?? []) {
        if (p.bypass !== undefined) this.peqBypassed[p.index] = p.bypass;
      }
      for (const g of output.crossover ?? []) {
        if (g.bypass !== undefined) this.crossoverBypassed[g.index] = g.bypass;
      }
      if (output.compressor?.bypass !== undefined) this.compressorBypassed = output.compressor.bypass;
    }
  }

  onStatus(): () => void {
    return () => {};
  }
  connect(): void {}
  close(): void {}
}

class FakeTonePlayer implements TonePlayer {
  sweepsStarted: { f0: number; f1: number; durationSec: number; amplitude: number }[] = [];
  pauseCalls = 0;
  resumeCalls = 0;

  async startLogSweep(f0: number, f1: number, durationSec: number, amplitude: number): Promise<() => Promise<void>> {
    this.sweepsStarted.push({ f0, f1, durationSec, amplitude });
    return async () => {};
  }

  async pausePlaybackForTest(): Promise<() => Promise<void>> {
    this.pauseCalls++;
    return async () => {
      this.resumeCalls++;
    };
  }
}

let tmpDir: string;
let store: ConfigStore;
let client: FakeVerifyClient;
let tonePlayer: FakeTonePlayer;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), 'minidsp-webui-verify-test-'));
  store = new ConfigStore(path.join(tmpDir, 'presets'), path.join(tmpDir, 'backups'));
  await store.whenReady();
  client = new FakeVerifyClient();
  tonePlayer = new FakeTonePlayer();

  const output = store.getState().outputs[0];
  // Three active PEQ slots with distinct, individually identifiable gains;
  // the rest bypassed. Proves per-slot isolation actually isolates, rather
  // than just reporting the combined total for every slot.
  output.peq = output.peq.map((s, i) => ({ ...s, bypass: ![0, 3, 9].includes(i) }));
  client.peqSlotGainDb = [6, 0, 0, 3, 0, 0, 0, 0, 0, 2];
  output.crossover[0].bypass = false; // highpass active
  output.crossover[1].bypass = false; // lowpass also active, with a different gain - proves HP/LP isolation
  client.crossoverGainDb = [4, 7];
  output.compressor = { ...output.compressor, bypass: false };
  await store.persistActive();
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('verifyPeq', () => {
  it('isolates each PEQ slot\'s own contribution regardless of the other slots\' state', async () => {
    const result = await verifyPeq(client, store, tonePlayer, 0, FAST_OPTIONS);

    const bySlot = new Map(result.perSlot.map((s) => [s.index, s.measuredDeltaDb]));
    expect(bySlot.get(0)!.every((d) => Math.abs(d - 6) < 1e-6)).toBe(true);
    expect(bySlot.get(3)!.every((d) => Math.abs(d - 3) < 1e-6)).toBe(true);
    expect(bySlot.get(9)!.every((d) => Math.abs(d - 2) < 1e-6)).toBe(true);
    // slots that are bypassed in the real config still get tested in
    // isolation (their bypass flag is temporarily overridden to "active" one
    // at a time) - with 0 gain configured here, their isolated delta is 0.
    expect(bySlot.get(1)!.every((d) => Math.abs(d) < 1e-6)).toBe(true);
    expect(result.perSlot).toHaveLength(10);
  });

  it('combined result matches the sum of the slots that are actually active in the real config', async () => {
    const result = await verifyPeq(client, store, tonePlayer, 0, FAST_OPTIONS);
    // slots 0, 3, 9 are non-bypassed in the real config: 6 + 3 + 2 = 11
    expect(result.combined.measuredDeltaDb.every((d) => Math.abs(d - 11) < 1e-6)).toBe(true);
  });

  it('runs exactly 12 sweeps (1 reference + 10 isolated slots + 1 combined) and one pause/resume pair', async () => {
    await verifyPeq(client, store, tonePlayer, 0, FAST_OPTIONS);
    expect(tonePlayer.sweepsStarted).toHaveLength(12);
    expect(tonePlayer.pauseCalls).toBe(1);
    expect(tonePlayer.resumeCalls).toBe(1);
  });

  it('restores PEQ bypass state and compressor bypass afterward', async () => {
    await verifyPeq(client, store, tonePlayer, 0, FAST_OPTIONS);

    const output = store.getState().outputs[0];
    expect(output.peq.map((s) => s.bypass)).toEqual([false, true, true, false, true, true, true, true, true, false]);
    expect(output.compressor.bypass).toBe(false);
    expect(client.compressorBypassed).toBe(false);
    expect(client.peqBypassed).toEqual([false, true, true, false, true, true, true, true, true, false]);
  });

  it('still restores state if a status read fails mid-run', async () => {
    client.failStatusOnCall = 5; // fails partway through the per-slot sweeps
    await expect(verifyPeq(client, store, tonePlayer, 0, FAST_OPTIONS)).rejects.toThrow('simulated transient minidspd failure');

    const output = store.getState().outputs[0];
    expect(output.peq.map((s) => s.bypass)).toEqual([false, true, true, false, true, true, true, true, true, false]);
    expect(output.compressor.bypass).toBe(false);
    expect(tonePlayer.resumeCalls).toBe(1);
  });
});

describe('verifyCrossover', () => {
  it('isolates highpass and lowpass independently even though both are active simultaneously', async () => {
    const result = await verifyCrossover(client, store, tonePlayer, 0, FAST_OPTIONS);
    expect(result.highpass.measuredDeltaDb.every((d) => Math.abs(d - 4) < 1e-6)).toBe(true);
    expect(result.lowpass.measuredDeltaDb.every((d) => Math.abs(d - 7) < 1e-6)).toBe(true);
  });

  it('combined result matches the sum of both active groups', async () => {
    const result = await verifyCrossover(client, store, tonePlayer, 0, FAST_OPTIONS);
    expect(result.combined.measuredDeltaDb.every((d) => Math.abs(d - 11) < 1e-6)).toBe(true);
  });

  it('a bypassed group correctly measures as having no effect when isolated', async () => {
    const output = store.getState().outputs[0];
    output.crossover[1].bypass = true; // lowpass now off
    await store.persistActive();

    const result = await verifyCrossover(client, store, tonePlayer, 0, FAST_OPTIONS);
    expect(result.highpass.measuredDeltaDb.every((d) => Math.abs(d - 4) < 1e-6)).toBe(true);
    expect(result.lowpass.measuredDeltaDb.every((d) => Math.abs(d) < 1e-6)).toBe(true);
    expect(result.combined.measuredDeltaDb.every((d) => Math.abs(d - 4) < 1e-6)).toBe(true);
  });

  it('runs exactly 4 sweeps (reference + highpass + lowpass + combined)', async () => {
    await verifyCrossover(client, store, tonePlayer, 0, FAST_OPTIONS);
    expect(tonePlayer.sweepsStarted).toHaveLength(4);
  });

  it('restores crossover group bypass state afterward', async () => {
    await verifyCrossover(client, store, tonePlayer, 0, FAST_OPTIONS);

    const output = store.getState().outputs[0];
    expect(output.crossover.map((g) => g.bypass)).toEqual([false, false]);
    expect(client.crossoverBypassed).toEqual([false, false]);
  });
});
