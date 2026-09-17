import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import { createApp } from '../server.js';
import { ConfigStore } from '../store.js';
import { MockMinidspClient } from '../mock/mockMinidspServer.js';
import { findCard, parseAmixerSwitch, parseAmixerVolume, type HostVolume, type HostVolumeReader } from '../hostVolume.js';

// Captured verbatim from a Pi 4 with the 2x4 HD on USB (moOde, 2026-09-17).
const PROC_ASOUND_CARDS = ` 0 [m2x4HD         ]: USB-Audio - miniDSP 2x4HD
                      miniDSP miniDSP 2x4HD at usb-0000:01:00.0-1.1, high speed
 1 [vc4hdmi0       ]: vc4-hdmi - vc4-hdmi-0
                      vc4-hdmi-0
 2 [vc4hdmi1       ]: vc4-hdmi - vc4-hdmi-1
                      vc4-hdmi-1
`;

const AMIXER_VOLUME = `numid=5,iface=MIXER,name='miniDSP 2x4HD Playback Volume'
  ; type=INTEGER,access=rw---R--,values=2,min=0,max=127,step=0
  : values=106,106
  | dBminmax-min=-127.00dB,max=0.00dB
`;

const AMIXER_SWITCH = `numid=3,iface=MIXER,name='miniDSP 2x4HD Playback Switch'
  ; type=BOOLEAN,access=rw------,values=2
  : values=on,on
`;

describe('host volume parsing', () => {
  it('finds the miniDSP card number in /proc/asound/cards', () => {
    expect(findCard(PROC_ASOUND_CARDS, 'm2x4HD')).toBe(0);
    expect(findCard(PROC_ASOUND_CARDS, 'vc4hdmi1')).toBe(2);
    expect(findCard(PROC_ASOUND_CARDS, 'nope')).toBeNull();
  });

  it('converts the 2x4 HD USB volume (dBminmax TLV) to dB', () => {
    // 106/127 on a -127..0 dB linear range = -21 dB; the value the udev hook
    // in deploy/moode writes for a 44 % moOde knob.
    expect(parseAmixerVolume(AMIXER_VOLUME)).toEqual({ raw: 106, rawMin: 0, rawMax: 127, dB: -21 });
    expect(parseAmixerVolume(AMIXER_VOLUME.replace('values=106,106', 'values=127,127'))?.dB).toBe(0);
    expect(parseAmixerVolume(AMIXER_VOLUME.replace('values=106,106', 'values=0,0'))?.dB).toBe(-127);
  });

  it('handles the dBscale TLV form other cards report', () => {
    const out = `numid=1,iface=MIXER,name='PCM Playback Volume'
  ; type=INTEGER,access=rw---R--,values=2,min=0,max=255,step=0
  : values=200,200
  | dBscale-min=-127.50dB,step=0.50dB,mute=1
`;
    expect(parseAmixerVolume(out)).toEqual({ raw: 200, rawMin: 0, rawMax: 255, dB: -27.5 });
  });

  it('returns null for output without a dB scale or without values', () => {
    expect(parseAmixerVolume('numid=1,iface=MIXER\n  ; type=INTEGER,min=0,max=10\n')).toBeNull();
    expect(parseAmixerVolume('')).toBeNull();
  });

  it('reads the playback switch', () => {
    expect(parseAmixerSwitch(AMIXER_SWITCH)).toBe(true);
    expect(parseAmixerSwitch(AMIXER_SWITCH.replace('on,on', 'off,off'))).toBe(false);
    expect(parseAmixerSwitch(AMIXER_VOLUME)).toBeNull();
  });
});

describe('GET /api/host-volume', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'minidsp-webui-hostvol-'));
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function appWith(reader: HostVolumeReader): Promise<Express> {
    const store = new ConfigStore(path.join(tmpDir, 'presets'), path.join(tmpDir, 'backups'));
    const { app } = await createApp(new MockMinidspClient(), store, undefined, reader);
    return app;
  }

  it('reports the USB volume stage when the host exposes one', async () => {
    const value: HostVolume = { card: 0, control: 'miniDSP 2x4HD Playback Volume', raw: 106, rawMin: 0, rawMax: 127, dB: -21, mute: false };
    const app = await appWith({ read: async () => value });
    const res = await request(app).get('/api/host-volume');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: true, ...value });
  });

  it('is simply unavailable on hosts without it - never an error', async () => {
    const app = await appWith({ read: async () => null });
    const res = await request(app).get('/api/host-volume');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: false });
  });
});
