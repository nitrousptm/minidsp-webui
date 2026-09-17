import { Router } from 'express';
import type { HostVolumeReader } from '../hostVolume.js';

export function hostVolumeRouter(reader: HostVolumeReader): Router {
  const router = Router();

  // Read-only by design - see hostVolume.ts. `available: false` is the normal
  // answer on any host where nothing drives the 2x4 HD's USB volume.
  router.get('/host-volume', async (_req, res) => {
    const value = await reader.read();
    res.json(value ? { available: true, ...value } : { available: false });
  });

  return router;
}
