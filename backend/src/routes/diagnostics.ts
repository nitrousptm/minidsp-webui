import { Router } from 'express';
import type { MinidspClient } from '../minidspClient.js';
import type { ConfigStore } from '../store.js';
import type { TonePlayer } from '../diagnostics/tonePlayer.js';
import { verifyCrossover, verifyPeq } from '../diagnostics/verify.js';
import { asyncHandler } from '../asyncHandler.js';

/**
 * A sweep plays audio into the shared ALSA device and reads levels for the
 * output under test over the better part of a minute (or more, once every
 * PEQ slot and both crossover groups are tested individually) - running two
 * concurrently would have them fight over the same physical device and
 * corrupt each other's readings. One global lock across all outputs/filter
 * types is intentional, not just per-output.
 */
export function diagnosticsRouter(client: MinidspClient, store: ConfigStore, tonePlayer: TonePlayer): Router {
  const router = Router();
  let busy = false;

  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    if (busy) {
      const err = new Error('A hardware verification is already running');
      (err as Error & { status?: number }).status = 409;
      return Promise.reject(err);
    }
    busy = true;
    return fn().finally(() => {
      busy = false;
    });
  }

  async function respondOrBusy<T>(res: import('express').Response, run: () => Promise<T>): Promise<void> {
    try {
      res.json(await withLock(run));
    } catch (err) {
      if ((err as Error & { status?: number }).status === 409) {
        res.status(409).json({ error: 'verify_busy', message: (err as Error).message });
        return;
      }
      throw err;
    }
  }

  router.post(
    '/outputs/:i/peq/verify',
    asyncHandler(async (req, res) => {
      const index = Number(req.params.i);
      await respondOrBusy(res, () => verifyPeq(client, store, tonePlayer, index));
    }),
  );

  router.post(
    '/outputs/:i/crossover/verify',
    asyncHandler(async (req, res) => {
      const index = Number(req.params.i);
      await respondOrBusy(res, () => verifyCrossover(client, store, tonePlayer, index));
    }),
  );

  return router;
}
