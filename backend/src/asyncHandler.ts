import type { Request, RequestHandler, Response } from 'express';

/**
 * Express 4 does not catch rejected promises returned from async route
 * handlers - an unawaited rejection becomes an unhandled promise rejection
 * at the process level, which crashes the whole server (Node's default
 * since v15). This happened for real: a transient minidspd timeout during a
 * preset reset took down the entire backend, killing every client's live
 * WebSocket connection over a single failed request. Wrapping every async
 * handler here ensures a failure only fails *that* request.
 */
export function asyncHandler(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    return fn(req, res).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(`Unhandled error in ${req.method} ${req.path}:`, err);
      if (!res.headersSent) {
        res.status(502).json({ error: 'minidspd_unreachable', message: (err as Error).message ?? String(err) });
      } else {
        next(err);
      }
    });
  };
}
