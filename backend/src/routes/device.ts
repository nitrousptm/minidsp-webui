import { Router } from 'express';
import type { MinidspClient } from '../minidspClient.js';
import { MINIDSP_2X4HD_SOURCES, NUM_INPUTS, NUM_OUTPUTS, NUM_PEQ_SLOTS, NUM_PRESETS } from '../types.js';

export function deviceRouter(client: MinidspClient): Router {
  const router = Router();

  router.get('/device', async (_req, res) => {
    try {
      const devices = await client.listDevices();
      res.json({
        device: devices[0] ?? null,
        layout: {
          numInputs: NUM_INPUTS,
          numOutputs: NUM_OUTPUTS,
          numPeqSlots: NUM_PEQ_SLOTS,
          numPresets: NUM_PRESETS,
          availableSources: MINIDSP_2X4HD_SOURCES,
        },
      });
    } catch (err) {
      res.status(502).json({ error: 'minidspd_unreachable', message: (err as Error).message });
    }
  });

  return router;
}
