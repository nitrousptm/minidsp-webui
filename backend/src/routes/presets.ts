import { Router } from 'express';
import type { MinidspClient } from '../minidspClient.js';
import type { ConfigStore } from '../store.js';
import { asyncHandler } from '../asyncHandler.js';
import {
  buildCompressorWire,
  buildCrossoverWire,
  buildFirWire,
  buildInputPatchWire,
  buildMasterStatusWire,
  buildOutputPatchWire,
  buildPeqWire,
  buildRoutingWire,
  msToDuration,
} from '../wire.js';
import type { DeviceConfigState } from '../types.js';

async function pushFullConfigToDevice(client: MinidspClient, state: DeviceConfigState): Promise<void> {
  // Presets/backups are applied by pushing every channel's full config to
  // the device (not diffs) so it matches our stored one. This has been
  // debugged through several rounds, all driven by "A device request timed
  // out" errors from minidspd against the real 2x4HD:
  //
  // 1. Originally sent as a single request covering every input and output
  //    at once - reliably timed out. Fixed by chunking to one channel per
  //    request (10 PEQ + up to 8 crossover biquads + compressor + FIR
  //    bundled together per channel).
  // 2. That still reliably timed out on a *freshly installed* minidspd, even
  //    though the whole payload was tiny (~1KB). Chunked further down to one
  //    filter/group per request (matching the granularity the individual PUT
  //    routes already use) - necessary, but still not sufficient.
  // 3. Root cause, found by instrumenting every individual request: it's
  //    neither size nor request count - sending a FIR (or crossover) write
  //    with an *empty* coefficients array (`{bypass: true, coefficients:
  //    []}`, the default/unconfigured state) reliably wedges minidspd's
  //    entire HTTP/USB handling until minidspd-watchdog restarts it. A FIR
  //    or crossover group that's bypassed with no real coefficients has
  //    nothing to write anyway (device state is irrelevant while bypassed),
  //    so skipping the push entirely avoids the bug at its actual source
  //    instead of working around it.
  for (let index = 0; index < state.inputs.length; index++) {
    const input = state.inputs[index];
    await client.postConfig(buildInputPatchWire(index, { gain: input.gain, mute: input.mute }));
    for (const slot of input.peq) {
      await client.postConfig(buildPeqWire('input', index, slot.index, { bypass: slot.bypass, coeff: slot.coeff }));
    }
    for (const entry of input.routing) {
      await client.postConfig(buildRoutingWire(index, entry.index, { gain: entry.gain, mute: entry.mute }));
    }
  }
  for (let index = 0; index < state.outputs.length; index++) {
    const output = state.outputs[index];
    await client.postConfig(
      buildOutputPatchWire(index, {
        gain: output.gain,
        mute: output.mute,
        invert: output.invert,
        delay: msToDuration(output.delayMs),
      }),
    );
    for (const slot of output.peq) {
      await client.postConfig(buildPeqWire('output', index, slot.index, { bypass: slot.bypass, coeff: slot.coeff }));
    }
    for (const group of output.crossover) {
      if (group.coeff.length === 0) continue; // see note above: empty-array writes wedge minidspd
      await client.postConfig(buildCrossoverWire(index, group.index, { bypass: group.bypass, coeff: group.coeff }));
    }
    await client.postConfig(buildCompressorWire(index, output.compressor));
    if (output.fir.coefficients.length > 0) {
      await client.postConfig(buildFirWire(index, output.fir));
    }
  }
}

export function presetsRouter(client: MinidspClient, store: ConfigStore): Router {
  const router = Router();

  router.get('/presets', (_req, res) => {
    res.json(
      store.getAllPresets().map((p, i) => ({ index: i, name: p.presetName, active: i === store.getActivePresetIndex() })),
    );
  });

  router.post(
    '/presets/:i/activate',
    asyncHandler(async (req, res) => {
      const index = Number(req.params.i);
      await client.postConfig(buildMasterStatusWire({ preset: index }));
      store.setActivePresetIndex(index);
      await pushFullConfigToDevice(client, store.getState(index));
      res.json({ ok: true, activeIndex: index });
    }),
  );

  router.post(
    '/presets/:i/rename',
    asyncHandler(async (req, res) => {
      const index = Number(req.params.i);
      const { name } = req.body as { name: string };
      await store.renamePreset(index, name);
      res.json({ ok: true });
    }),
  );

  router.post(
    '/presets/:i/reset',
    asyncHandler(async (req, res) => {
      const index = Number(req.params.i);
      await store.resetPreset(index);
      if (index === store.getActivePresetIndex()) {
        await pushFullConfigToDevice(client, store.getState(index));
      }
      res.json({ ok: true });
    }),
  );

  router.post(
    '/presets/reset-all',
    asyncHandler(async (_req, res) => {
      await store.resetAllPresets();
      await pushFullConfigToDevice(client, store.getState(store.getActivePresetIndex()));
      res.json({ ok: true });
    }),
  );

  router.get('/presets/:i/export', (req, res) => {
    const index = Number(req.params.i);
    const state = store.getState(index);
    res.setHeader('Content-Disposition', `attachment; filename="preset-${index}-${state.presetName}.json"`);
    res.json(state);
  });

  router.post(
    '/presets/:i/import',
    asyncHandler(async (req, res) => {
      const index = Number(req.params.i);
      const incoming = req.body as DeviceConfigState;
      store.getAllPresets()[index] = incoming;
      await store.persistActive();
      if (index === store.getActivePresetIndex()) {
        await pushFullConfigToDevice(client, incoming);
      }
      res.json({ ok: true });
    }),
  );

  // ---- Named backups beyond the 4 device slots ----

  router.get(
    '/backups',
    asyncHandler(async (_req, res) => {
      res.json(await store.listBackups());
    }),
  );

  router.post(
    '/backups',
    asyncHandler(async (req, res) => {
      const { name } = req.body as { name: string };
      await store.saveBackup(name, store.getState());
      res.json({ ok: true });
    }),
  );

  router.get(
    '/backups/:name',
    asyncHandler(async (req, res) => {
      res.json(await store.loadBackup(req.params.name));
    }),
  );

  router.post(
    '/backups/:name/restore',
    asyncHandler(async (req, res) => {
      const state = await store.loadBackup(req.params.name);
      store.getAllPresets()[store.getActivePresetIndex()] = state;
      await store.persistActive();
      await pushFullConfigToDevice(client, state);
      res.json({ ok: true });
    }),
  );

  return router;
}
