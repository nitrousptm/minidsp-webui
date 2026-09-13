import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import { createApp } from '../server.js';
import { ConfigStore } from '../store.js';
import { MockMinidspClient } from '../mock/mockMinidspServer.js';
import type { MinidspClient, DeviceInfo } from '../minidspClient.js';
import type { StatusSummary, WireConfig } from '../types.js';

/** A client whose device writes always fail, to exercise error handling
 * without crashing the process (regression: a rejected postConfig during a
 * preset reset used to be an unhandled promise rejection that killed the
 * whole server). */
class AlwaysFailingClient implements MinidspClient {
  async listDevices(): Promise<DeviceInfo[]> {
    return [];
  }
  async getStatus(): Promise<StatusSummary> {
    throw new Error('device unreachable');
  }
  async postConfig(_cfg: WireConfig): Promise<void> {
    throw new Error('device unreachable');
  }
  onStatus(): () => void {
    return () => {};
  }
  connect(): void {}
  close(): void {}
}

let app: Express;
let client: MockMinidspClient;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), 'minidsp-webui-test-'));
  client = new MockMinidspClient();
  const store = new ConfigStore(path.join(tmpDir, 'presets'), path.join(tmpDir, 'backups'));
  ({ app } = await createApp(client, store));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('GET /api/device', () => {
  it('reports the connected 2x4HD and its channel layout', async () => {
    const res = await request(app).get('/api/device');
    expect(res.status).toBe(200);
    expect(res.body.device.product_name).toBe('2x4HD');
    expect(res.body.layout).toEqual({
      numInputs: 2,
      numOutputs: 4,
      numPeqSlots: 10,
      numPresets: 4,
      availableSources: ['Analog', 'Toslink', 'Usb'],
    });
  });
});

describe('GET/POST /api/master', () => {
  it('reads master status', async () => {
    const res = await request(app).get('/api/master');
    expect(res.status).toBe(200);
    expect(res.body.master.source).toBe('Usb');
  });

  it('applies a volume change to the device', async () => {
    const res = await request(app).post('/api/master').send({ volume: -12.5 });
    expect(res.status).toBe(200);
    expect(client.lastAppliedConfig).toEqual({ master_status: { volume: -12.5 } });
  });
});

describe('PEQ routes', () => {
  it('sets a peak filter on output 0 slot 3 and forwards it to the device', async () => {
    const coeff = { b0: 1.1, b1: -1.9, b2: 0.8, a1: 1.9, a2: -0.9 };
    const res = await request(app).put('/api/outputs/0/peq/3').send({ bypass: false, coeff });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ index: 3, bypass: false, coeff });
    expect(client.lastAppliedConfig).toEqual({
      outputs: [{ index: 0, peq: [{ index: 3, bypass: false, coeff }] }],
    });
  });

  it('persists the change so GET /api/state reflects it', async () => {
    const coeff = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
    await request(app).put('/api/inputs/1/peq/0').send({ bypass: true, coeff });
    const res = await request(app).get('/api/state');
    expect(res.body.inputs[1].peq[0]).toEqual({ index: 0, bypass: true, coeff });
  });

  it('persists the Basic-mode metadata (type/freq/gain/Q) alongside the coefficients', async () => {
    // Regression test: the frontend sends `basic` so the editor can be
    // reopened later without losing the human-friendly representation - this
    // must survive a PUT + GET/state round trip, not just live in memory.
    const coeff = { b0: 1.02, b1: -1.95, b2: 0.93, a1: 1.95, a2: -0.95 };
    const basic = { type: 'PEAK', freq: 200, gainDb: 8, q: 1 };
    await request(app).put('/api/outputs/0/peq/0').send({ bypass: false, coeff, basic });
    const res = await request(app).get('/api/state');
    expect(res.body.outputs[0].peq[0].basic).toEqual(basic);
  });
});

describe('Routing routes', () => {
  it('enables routing from input 0 to output 1 with a mix gain', async () => {
    const res = await request(app).put('/api/inputs/0/routing/1').send({ gain: -6, mute: false });
    expect(res.status).toBe(200);
    expect(client.lastAppliedConfig).toEqual({
      inputs: [{ index: 0, routing: [{ index: 1, gain: -6, mute: false }] }],
    });
  });
});

describe('Crossover routes', () => {
  it('sets a high-pass biquad group (group 0) on output 2, stamping each biquad with its index', async () => {
    const coeff = [{ b0: 1, b1: -2, b2: 1, a1: 1.9, a2: -0.9 }];
    const res = await request(app).put('/api/outputs/2/crossover/0').send({ bypass: false, coeff });
    expect(res.status).toBe(200);
    expect(client.lastAppliedConfig).toEqual({
      outputs: [{ index: 2, crossover: [{ index: 0, bypass: false, coeff: [{ ...coeff[0], index: 0 }] }] }],
    });
  });

  it('persists the Basic-mode metadata (family/slope/freq) alongside the coefficients', async () => {
    const coeff = [{ b0: 1, b1: -2, b2: 1, a1: 1.9, a2: -0.9 }];
    const basic = { family: 'BUTTERWORTH', slopeDbPerOct: 24, freq: 100 };
    await request(app).put('/api/outputs/0/crossover/0').send({ bypass: false, coeff, basic });
    const res = await request(app).get('/api/state');
    expect(res.body.outputs[0].crossover[0].basic).toEqual(basic);
  });
});

describe('Compressor routes', () => {
  it('updates threshold and ratio', async () => {
    const res = await request(app).put('/api/outputs/0/compressor').send({ threshold: -18, ratio: 3 });
    expect(res.status).toBe(200);
    expect(res.body.threshold).toBe(-18);
    expect(res.body.ratio).toBe(3);
  });
});

describe('FIR routes', () => {
  it('uploads coefficients and enables the filter', async () => {
    const coefficients = [1, -0.5, 0.25];
    const res = await request(app).put('/api/outputs/3/fir').send({ bypass: false, coefficients });
    expect(res.status).toBe(200);
    expect(res.body.coefficients).toEqual(coefficients);
  });
});

describe('Preset routes', () => {
  it('renames a preset', async () => {
    const res = await request(app).post('/api/presets/1/rename').send({ name: 'Movie Mode' });
    expect(res.status).toBe(200);
    const list = await request(app).get('/api/presets');
    expect(list.body[1].name).toBe('Movie Mode');
  });

  it('activates a preset and pushes its full config one filter/group per request, never bundled', async () => {
    // Regression: bundling multiple PEQ slots (or both crossover groups)
    // into a single request reliably made the real minidspd time out - even
    // though the whole payload was tiny (~1KB). A single-entry request
    // consistently succeeded in well under a second. So every array-bearing
    // field must go out with exactly one entry per request; chunking by
    // channel alone (a prior fix) was not sufficient.
    const before = client.appliedConfigs.length;
    const res = await request(app).post('/api/presets/2/activate');
    expect(res.status).toBe(200);

    const pushed = client.appliedConfigs.slice(before);
    expect(pushed.some((c) => c.master_status?.preset === 2)).toBe(true);

    const channels = pushed.flatMap((c) => [...(c.inputs ?? []), ...(c.outputs ?? [])]);
    const peqWrites = channels.filter((ch) => ch.peq);
    expect(peqWrites.every((ch) => ch.peq!.length === 1)).toBe(true);
    expect(peqWrites).toHaveLength(2 * 10 + 4 * 10); // 2 inputs + 4 outputs, 10 PEQ slots each
  });

  it('never pushes a crossover group or FIR filter with an empty coefficients array', async () => {
    // Root-cause regression: confirmed against the real 2x4HD that a write
    // with an empty coefficients array (`{bypass: true, coefficients: []}`,
    // the untouched default) reliably wedges minidspd's entire HTTP/USB
    // handling until minidspd-watchdog restarts it - even in complete
    // isolation, as the very first request. A bypassed group/filter with no
    // real coefficients has nothing worth writing anyway.
    const before = client.appliedConfigs.length;
    const res = await request(app).post('/api/presets/3/activate'); // never customized - all defaults
    expect(res.status).toBe(200);

    const pushed = client.appliedConfigs.slice(before);
    const outputs = pushed.flatMap((c) => c.outputs ?? []);
    expect(outputs.some((o) => o.crossover)).toBe(false);
    expect(outputs.some((o) => o.fir)).toBe(false);
  });

  it('still pushes a crossover group once it actually has coefficients, even while bypassed', async () => {
    await request(app)
      .put('/api/outputs/0/crossover/0')
      .send({ bypass: true, coeff: [{ b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 }] });

    const before = client.appliedConfigs.length;
    const res = await request(app).post('/api/presets/0/activate');
    expect(res.status).toBe(200);

    const pushed = client.appliedConfigs.slice(before);
    const group0Writes = pushed.flatMap((c) => c.outputs ?? []).filter((o) => o.crossover?.some((g) => g.index === 0));
    expect(group0Writes.length).toBeGreaterThan(0);
  });

  it('resets a single preset back to defaults', async () => {
    await request(app).put('/api/outputs/0/compressor').send({ threshold: -5 });
    await request(app).post('/api/presets/0/reset');
    const state = await request(app).get('/api/state');
    expect(state.body.outputs[0].compressor.threshold).toBe(-20);
  });
});

describe('Backup routes', () => {
  it('saves and restores a named backup', async () => {
    await request(app).put('/api/outputs/1/compressor').send({ threshold: -30 });
    await request(app).post('/api/backups').send({ name: 'my-backup' });

    const list = await request(app).get('/api/backups');
    expect(list.body).toContain('my-backup');

    await request(app).post('/api/presets/0/reset');
    await request(app).post('/api/backups/my-backup/restore');

    const state = await request(app).get('/api/state');
    expect(state.body.outputs[1].compressor.threshold).toBe(-30);
  });
});

describe('Device failures do not crash the server', () => {
  // Regression: a rejected device write used to be an unhandled promise
  // rejection that killed the whole process on the very first real-world
  // minidspd hiccup. Every mutating route must fail *that one request* with
  // a clean error, not the entire server. Table-driven so a newly added
  // route is expected to be added here too rather than silently skipped.
  const mutatingRoutes: { name: string; method: 'put' | 'post'; path: string; body?: object }[] = [
    { name: 'update input', method: 'put', path: '/api/inputs/0', body: { gain: 1 } },
    { name: 'update input PEQ', method: 'put', path: '/api/inputs/0/peq/0', body: { bypass: false } },
    { name: 'update routing', method: 'put', path: '/api/inputs/0/routing/1', body: { gain: 0 } },
    { name: 'update output', method: 'put', path: '/api/outputs/0', body: { gain: 1 } },
    { name: 'update output PEQ', method: 'put', path: '/api/outputs/0/peq/0', body: { bypass: false } },
    { name: 'update crossover', method: 'put', path: '/api/outputs/0/crossover/0', body: { bypass: false } },
    { name: 'update compressor', method: 'put', path: '/api/outputs/0/compressor', body: { threshold: -10 } },
    { name: 'update FIR', method: 'put', path: '/api/outputs/0/fir', body: { bypass: false } },
    { name: 'update master', method: 'post', path: '/api/master', body: { volume: -10 } },
    { name: 'activate preset', method: 'post', path: '/api/presets/1/activate' },
    { name: 'reset preset', method: 'post', path: '/api/presets/0/reset' },
    { name: 'reset all presets', method: 'post', path: '/api/presets/reset-all' },
    { name: 'restore backup', method: 'post', path: '/api/backups/nonexistent/restore' },
  ];

  for (const route of mutatingRoutes) {
    it(`${route.name}: returns an error response instead of crashing when the device is unreachable`, async () => {
      const failDir = await mkdtemp(path.join(tmpdir(), 'minidsp-webui-fail-test-'));
      try {
        const failStore = new ConfigStore(path.join(failDir, 'presets'), path.join(failDir, 'backups'));
        const { app: failApp } = await createApp(new AlwaysFailingClient(), failStore);

        const req = request(failApp)[route.method](route.path);
        const res = route.body ? await req.send(route.body) : await req;
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(600);

        // the process (and this Express app) must still be responsive afterwards
        const followUp = await request(failApp).get('/api/presets');
        expect(followUp.status).toBe(200);
      } finally {
        await rm(failDir, { recursive: true, force: true });
      }
    });
  }
});
