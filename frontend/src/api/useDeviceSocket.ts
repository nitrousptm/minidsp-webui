import { useEffect, useRef, useState } from 'react';
import type { StatusSummary } from '../types';

/**
 * minidspd's poll stream interleaves two kinds of frames: frequent
 * level-meter-only ticks (which still carry a `master` key, but as an empty
 * object `{}` - present, not null/undefined) and much rarer full status
 * ticks with the real master fields populated. `{} ?? fallback` does NOT
 * fall through (an empty object isn't nullish), so naively replacing state
 * with each raw frame blanks out source/volume/mute on every level tick.
 * This carries the last known-good `master` forward across empty frames.
 */
export function mergeStatusFrame(prev: StatusSummary | null, incoming: Partial<StatusSummary>): StatusSummary {
  const hasMaster = !!incoming.master && Object.keys(incoming.master).length > 0;
  return {
    master: hasMaster ? incoming.master! : (prev?.master ?? incoming.master!),
    input_levels: incoming.input_levels ?? prev?.input_levels ?? [],
    output_levels: incoming.output_levels ?? prev?.output_levels ?? [],
  };
}

// minidspd streams level ticks roughly every 250ms when healthy, so going
// this long without a single frame - while the socket itself is still
// reported "open" - means the underlying minidspd process has wedged
// (a known minidsp-rs 0.1.12 failure mode - see minidspd-watchdog). A plain
// `ws.onclose` reconnect doesn't catch this, since the socket doesn't
// actually close when minidspd hangs; it just stops sending.
const STALE_AFTER_MS = 5000;

/** Pure so it's trivially testable without faking timers/WebSocket. */
export function isStale(lastMessageAt: number, now: number): boolean {
  return now - lastMessageAt > STALE_AFTER_MS;
}

export interface DeviceSocketState {
  status: StatusSummary | null;
  /** True once the live stream has gone quiet for longer than is normal.
   * Consumers should show levels/master as "possibly out of date" rather
   * than silently displaying a frozen last-known value as if it were live. */
  stale: boolean;
}

export function useDeviceSocket(): DeviceSocketState {
  const [status, setStatus] = useState<StatusSummary | null>(null);
  const [stale, setStale] = useState(false);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMessageAtRef = useRef<number>(Date.now());

  useEffect(() => {
    let closedByEffect = false;
    let ws: WebSocket | null = null;

    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data?.type === 'status') {
            lastMessageAtRef.current = Date.now();
            setStale(false);
            setStatus((prev) => mergeStatusFrame(prev, data));
          }
        } catch {
          // ignore malformed frames
        }
      };
      ws.onclose = () => {
        setStale(true);
        if (!closedByEffect) retryRef.current = setTimeout(connect, 2000);
      };
    }

    connect();
    const staleCheckInterval = setInterval(() => {
      setStale(isStale(lastMessageAtRef.current, Date.now()));
    }, 1000);

    return () => {
      closedByEffect = true;
      clearInterval(staleCheckInterval);
      if (retryRef.current) clearTimeout(retryRef.current);
      ws?.close();
    };
  }, []);

  return { status, stale };
}
