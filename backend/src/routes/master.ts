import { Router } from 'express';
import type { MinidspClient } from '../minidspClient.js';
import type { ConfigStore } from '../store.js';
import { buildMasterStatusWire } from '../wire.js';
import type { Source } from '../types.js';

export function masterRouter(client: MinidspClient, store: ConfigStore): Router {
  const router = Router();

  router.get('/master', async (_req, res) => {
    try {
      const status = await client.getStatus();
      res.json(status);
    } catch (err) {
      res.status(502).json({ error: 'minidspd_unreachable', message: (err as Error).message });
    }
  });

  router.post('/master', async (req, res) => {
    const { preset, source, volume, mute } = req.body as {
      preset?: number;
      source?: Source;
      volume?: number;
      mute?: boolean;
    };
    try {
      await client.postConfig(buildMasterStatusWire({ preset, source, volume, mute }));
      if (typeof preset === 'number') {
        store.setActivePresetIndex(preset);
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(502).json({ error: 'minidspd_unreachable', message: (err as Error).message });
    }
  });

  return router;
}
