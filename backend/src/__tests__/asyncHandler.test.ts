import { describe, expect, it, vi } from 'vitest';
import { asyncHandler } from '../asyncHandler.js';
import type { Request, Response } from 'express';

function fakeRes() {
  const res = {
    headersSent: false,
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

describe('asyncHandler', () => {
  it('passes through a successful handler untouched', async () => {
    const res = fakeRes();
    const handler = asyncHandler(async (_req, r) => {
      r.json({ ok: true });
    });
    await handler({} as Request, res, vi.fn());
    expect(res.json).toHaveBeenCalledWith({ ok: true });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('catches a rejected handler and responds 502 instead of throwing', async () => {
    const res = fakeRes();
    const handler = asyncHandler(async () => {
      throw new Error('device unreachable');
    });
    const next = vi.fn();

    // The whole point: this must NOT throw / reject up to the caller.
    await expect(handler({ method: 'POST', path: '/x' } as Request, res, next)).resolves.toBeUndefined();

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({ error: 'minidspd_unreachable', message: 'device unreachable' });
    expect(next).not.toHaveBeenCalled();
  });

  it('defers to next() if headers were already sent when the handler fails', async () => {
    const res = fakeRes();
    res.headersSent = true;
    const next = vi.fn();
    const handler = asyncHandler(async () => {
      throw new Error('too late');
    });

    await handler({ method: 'GET', path: '/x' } as Request, res, next);
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});
