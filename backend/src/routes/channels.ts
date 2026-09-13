import { Router } from 'express';
import type { MinidspClient } from '../minidspClient.js';
import type { ConfigStore } from '../store.js';
import { asyncHandler } from '../asyncHandler.js';
import {
  buildCompressorWire,
  buildCrossoverWire,
  buildFirWire,
  buildInputPatchWire,
  buildOutputPatchWire,
  buildPeqWire,
  buildRoutingWire,
  wireInput,
  wireOutput,
} from '../wire.js';
import type { Biquad, Compressor, CrossoverBasicParams, Fir, PeqBasicParams } from '../types.js';

async function applyAndRespond(
  client: MinidspClient,
  res: import('express').Response,
  wire: ReturnType<typeof buildInputPatchWire>,
  result: unknown,
): Promise<void> {
  try {
    await client.postConfig(wire);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: 'minidspd_unreachable', message: (err as Error).message });
  }
}

export function channelsRouter(client: MinidspClient, store: ConfigStore): Router {
  const router = Router();

  router.get('/state', (_req, res) => {
    res.json(store.getState());
  });

  // ---- Inputs ----

  router.put('/inputs/:i', asyncHandler(async (req, res) => {
    const index = Number(req.params.i);
    const { label, gain, mute } = req.body as { label?: string; gain?: number; mute?: boolean };
    const updated = await store.updateInput(index, {
      ...(label !== undefined ? { label: label.slice(0, 12) } : {}),
      ...(gain !== undefined ? { gain } : {}),
      ...(mute !== undefined ? { mute } : {}),
    });
    await applyAndRespond(client, res, buildInputPatchWire(index, { gain: updated.gain, mute: updated.mute }), updated);
  }));

  router.put('/inputs/:i/peq/:p', asyncHandler(async (req, res) => {
    const index = Number(req.params.i);
    const peqIndex = Number(req.params.p);
    const { bypass, coeff, basic } = req.body as { bypass?: boolean; coeff?: Biquad; basic?: PeqBasicParams };
    const state = store.getState();
    const input = state.inputs[index];
    const slot = {
      ...input.peq[peqIndex],
      ...(bypass !== undefined ? { bypass } : {}),
      ...(coeff ? { coeff } : {}),
      ...(basic ? { basic } : {}),
    };
    input.peq[peqIndex] = slot;
    await store.persistActive();
    await applyAndRespond(client, res, buildPeqWire('input', index, peqIndex, { bypass: slot.bypass, coeff: slot.coeff }), slot);
  }));

  router.put('/inputs/:i/routing/:o', asyncHandler(async (req, res) => {
    const inputIndex = Number(req.params.i);
    const outputIndex = Number(req.params.o);
    const { gain, mute } = req.body as { gain?: number; mute?: boolean };
    const state = store.getState();
    const input = state.inputs[inputIndex];
    const existing = input.routing.find((r) => r.index === outputIndex);
    if (existing) {
      Object.assign(existing, gain !== undefined ? { gain } : {}, mute !== undefined ? { mute } : {});
    } else {
      input.routing.push({ index: outputIndex, gain: gain ?? 0, mute: mute ?? false });
    }
    await store.persistActive();
    const entry = input.routing.find((r) => r.index === outputIndex)!;
    await applyAndRespond(client, res, buildRoutingWire(inputIndex, outputIndex, { gain: entry.gain, mute: entry.mute }), entry);
  }));

  // ---- Outputs ----

  router.put('/outputs/:i', asyncHandler(async (req, res) => {
    const index = Number(req.params.i);
    const { label, gain, mute, invert, delayMs } = req.body as {
      label?: string;
      gain?: number;
      mute?: boolean;
      invert?: boolean;
      delayMs?: number;
    };
    const updated = await store.updateOutput(index, {
      ...(label !== undefined ? { label: label.slice(0, 12) } : {}),
      ...(gain !== undefined ? { gain } : {}),
      ...(mute !== undefined ? { mute } : {}),
      ...(invert !== undefined ? { invert } : {}),
      ...(delayMs !== undefined ? { delayMs } : {}),
    });
    await applyAndRespond(
      client,
      res,
      buildOutputPatchWire(index, {
        gain: updated.gain,
        mute: updated.mute,
        invert: updated.invert,
        delay: { secs: Math.floor(updated.delayMs / 1000), nanos: Math.round((updated.delayMs % 1000) * 1_000_000) },
      }),
      updated,
    );
  }));

  router.put('/outputs/:i/peq/:p', asyncHandler(async (req, res) => {
    const index = Number(req.params.i);
    const peqIndex = Number(req.params.p);
    const { bypass, coeff, basic } = req.body as { bypass?: boolean; coeff?: Biquad; basic?: PeqBasicParams };
    const state = store.getState();
    const output = state.outputs[index];
    const slot = {
      ...output.peq[peqIndex],
      ...(bypass !== undefined ? { bypass } : {}),
      ...(coeff ? { coeff } : {}),
      ...(basic ? { basic } : {}),
    };
    output.peq[peqIndex] = slot;
    await store.persistActive();
    await applyAndRespond(client, res, buildPeqWire('output', index, peqIndex, { bypass: slot.bypass, coeff: slot.coeff }), slot);
  }));

  router.put('/outputs/:i/crossover/:g', asyncHandler(async (req, res) => {
    const index = Number(req.params.i);
    const group = Number(req.params.g) as 0 | 1;
    const { bypass, coeff, basic } = req.body as { bypass?: boolean; coeff?: Biquad[]; basic?: CrossoverBasicParams };
    const state = store.getState();
    const output = state.outputs[index];
    const g = output.crossover.find((c) => c.index === group)!;
    if (bypass !== undefined) g.bypass = bypass;
    if (coeff !== undefined) g.coeff = coeff;
    if (basic !== undefined) g.basic = basic;
    await store.persistActive();
    await applyAndRespond(client, res, buildCrossoverWire(index, group, { bypass: g.bypass, coeff: g.coeff }), g);
  }));

  router.put('/outputs/:i/compressor', asyncHandler(async (req, res) => {
    const index = Number(req.params.i);
    const patch = req.body as Partial<Compressor>;
    const state = store.getState();
    const output = state.outputs[index];
    output.compressor = { ...output.compressor, ...patch };
    await store.persistActive();
    await applyAndRespond(client, res, buildCompressorWire(index, patch), output.compressor);
  }));

  router.put('/outputs/:i/fir', asyncHandler(async (req, res) => {
    const index = Number(req.params.i);
    const patch = req.body as Partial<Fir>;
    const state = store.getState();
    const output = state.outputs[index];
    output.fir = { ...output.fir, ...patch };
    await store.persistActive();
    await applyAndRespond(client, res, buildFirWire(index, patch), output.fir);
  }));

  return router;
}

// re-exported for tests that want to build a full wire snapshot of a channel
export { wireInput, wireOutput };
