import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * The 2x4 HD's USB audio interface exposes a UAC feature-unit volume
 * ('miniDSP 2x4HD Playback Volume', -127..0 dB) that sits *in front of* the
 * DSP master volume and adds to it. A player on the same host (e.g. moOde
 * with volume type "Hardware") may drive it through ALSA, in which case the
 * master slider in this UI is only half the story. This reads that control
 * so the UI can show it; it never writes it - whoever owns the ALSA mixer
 * (MPD, moOde's knob tracking) would silently disagree with us otherwise.
 *
 * Entirely optional: no ALSA card, no amixer, not Linux, or HOST_VOLUME=off
 * all just mean "unavailable" and the UI hides the readout.
 */
export interface HostVolume {
  card: number;
  control: string;
  raw: number;
  rawMin: number;
  rawMax: number;
  dB: number;
  mute: boolean | null;
}

export interface HostVolumeReader {
  read(): Promise<HostVolume | null>;
}

export const HOST_VOLUME_DEFAULTS = {
  cardMatch: process.env.HOST_VOLUME_CARD_MATCH ?? 'm2x4HD',
  control: process.env.HOST_VOLUME_CONTROL ?? 'miniDSP 2x4HD Playback Volume',
  switchControl: process.env.HOST_VOLUME_SWITCH ?? 'miniDSP 2x4HD Playback Switch',
  enabled: (process.env.HOST_VOLUME ?? 'auto') !== 'off',
};

// A handful of clients polling every couple of seconds must not turn into a
// handful of amixer processes per second.
const CACHE_TTL_MS = 1000;
const AMIXER_TIMEOUT_MS = 2000;

/** Card number of the first entry in /proc/asound/cards whose id matches, or null. */
export function findCard(procAsoundCards: string, match: string): number | null {
  for (const line of procAsoundCards.split('\n')) {
    // " 0 [m2x4HD         ]: USB-Audio - miniDSP 2x4HD"
    const m = /^\s*(\d+)\s+\[([^\]]+)\]/.exec(line);
    if (m && m[2].trim() === match) return Number(m[1]);
  }
  return null;
}

/**
 * Parses `amixer cget` output for an INTEGER control into raw value + dB.
 * Handles both TLV forms ALSA reports: `dBminmax` (linear between two
 * endpoints, what the 2x4 HD uses) and `dBscale` (min + step per raw unit).
 */
export function parseAmixerVolume(output: string): Pick<HostVolume, 'raw' | 'rawMin' | 'rawMax' | 'dB'> | null {
  const range = /type=INTEGER[^\n]*min=(-?\d+),max=(-?\d+)/.exec(output);
  const values = /:\s*values=(-?\d+)/.exec(output);
  if (!range || !values) return null;
  const rawMin = Number(range[1]);
  const rawMax = Number(range[2]);
  const raw = Number(values[1]);

  let dB: number;
  const minmax = /dBminmax-min=(-?[\d.]+)dB,max=(-?[\d.]+)dB/.exec(output);
  const scale = /dBscale-min=(-?[\d.]+)dB,step=(-?[\d.]+)dB/.exec(output);
  if (minmax) {
    const minDb = Number(minmax[1]);
    const maxDb = Number(minmax[2]);
    dB = rawMax === rawMin ? maxDb : minDb + ((raw - rawMin) / (rawMax - rawMin)) * (maxDb - minDb);
  } else if (scale) {
    dB = Number(scale[1]) + (raw - rawMin) * Number(scale[2]);
  } else {
    return null;
  }
  return { raw, rawMin, rawMax, dB: Math.round(dB * 10) / 10 };
}

/** Parses `amixer cget` output for a BOOLEAN control; null when absent. */
export function parseAmixerSwitch(output: string): boolean | null {
  const m = /type=BOOLEAN[\s\S]*?:\s*values=(on|off)/.exec(output);
  return m ? m[1] === 'on' : null;
}

class AmixerHostVolumeReader implements HostVolumeReader {
  private cached: { at: number; value: HostVolume | null } | null = null;
  private inflight: Promise<HostVolume | null> | null = null;

  async read(): Promise<HostVolume | null> {
    if (!HOST_VOLUME_DEFAULTS.enabled || process.platform !== 'linux') return null;
    if (this.cached && Date.now() - this.cached.at < CACHE_TTL_MS) return this.cached.value;
    if (this.inflight) return this.inflight;
    this.inflight = this.readUncached()
      .catch(() => null)
      .then((value) => {
        this.cached = { at: Date.now(), value };
        this.inflight = null;
        return value;
      });
    return this.inflight;
  }

  private async readUncached(): Promise<HostVolume | null> {
    const cards = await readFile('/proc/asound/cards', 'utf8');
    const card = findCard(cards, HOST_VOLUME_DEFAULTS.cardMatch);
    if (card === null) return null;

    const volume = parseAmixerVolume(await this.cget(card, HOST_VOLUME_DEFAULTS.control));
    if (!volume) return null;
    const mute = await this.cget(card, HOST_VOLUME_DEFAULTS.switchControl)
      .then((out) => {
        const on = parseAmixerSwitch(out);
        return on === null ? null : !on;
      })
      .catch(() => null);

    return { card, control: HOST_VOLUME_DEFAULTS.control, ...volume, mute };
  }

  private async cget(card: number, control: string): Promise<string> {
    // amixer's control-id parser accepts the quotes itself; no shell involved.
    const { stdout } = await execFileAsync('amixer', ['-c', String(card), 'cget', `name='${control}'`], {
      timeout: AMIXER_TIMEOUT_MS,
    });
    return stdout;
  }
}

export function createHostVolumeReader(): HostVolumeReader {
  return new AmixerHostVolumeReader();
}
