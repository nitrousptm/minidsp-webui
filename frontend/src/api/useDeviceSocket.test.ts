import { describe, expect, it } from 'vitest';
import { isStale, mergeStatusFrame } from './useDeviceSocket';

describe('mergeStatusFrame', () => {
  it('adopts a fully-populated master frame', () => {
    const result = mergeStatusFrame(null, {
      master: { preset: 0, source: 'Usb', volume: -20, mute: false },
      input_levels: [-30, -31],
      output_levels: [-30, -31, -120, -120],
    });
    expect(result.master).toEqual({ preset: 0, source: 'Usb', volume: -20, mute: false });
  });

  it('carries the previous master forward across an empty-master level tick', () => {
    // Regression test: minidspd sends level-meter-only frames with an empty
    // (but present) `master: {}` most of the time. Naively replacing state
    // with each frame blanks out source/volume/mute on every such tick,
    // which made the source dropdown and volume slider appear to "reset".
    const prev = mergeStatusFrame(null, {
      master: { preset: 0, source: 'Toslink', volume: -12, mute: false },
      input_levels: [-30, -31],
      output_levels: [-30, -31, -120, -120],
    });

    const next = mergeStatusFrame(prev, {
      master: {} as any,
      input_levels: [-25, -26],
      output_levels: [-25, -26, -120, -120],
    });

    expect(next.master).toEqual({ preset: 0, source: 'Toslink', volume: -12, mute: false });
    expect(next.input_levels).toEqual([-25, -26]); // levels still update every tick
  });

  it('updates master again once a subsequent full frame arrives', () => {
    const afterFirstChange = mergeStatusFrame(null, {
      master: { preset: 0, source: 'Analog', volume: -12, mute: false },
      input_levels: [-30, -31],
      output_levels: [],
    });
    const duringEmptyTicks = mergeStatusFrame(afterFirstChange, {
      master: {} as any,
      input_levels: [-30, -31],
      output_levels: [],
    });
    const afterSecondChange = mergeStatusFrame(duringEmptyTicks, {
      master: { preset: 0, source: 'Usb', volume: -12, mute: false },
      input_levels: [-30, -31],
      output_levels: [],
    });

    expect(afterSecondChange.master.source).toBe('Usb');
  });

  it('falls back to an empty master only when there is no previous value at all', () => {
    const result = mergeStatusFrame(null, { master: {} as any, input_levels: [], output_levels: [] });
    expect(result.master).toEqual({});
  });
});

describe('isStale', () => {
  // Regression test: minidspd 0.1.12 periodically wedges (the reason
  // minidspd-watchdog exists) - the WebSocket stays open but simply stops
  // sending frames, silently freezing level meters/master status while
  // looking like a live connection. This is what lets the UI detect that.
  it('is not stale immediately after a message', () => {
    const now = 1_000_000;
    expect(isStale(now, now)).toBe(false);
  });

  it('is not stale for small gaps between frames', () => {
    const lastMessageAt = 1_000_000;
    expect(isStale(lastMessageAt, lastMessageAt + 1000)).toBe(false);
  });

  it('becomes stale once the gap exceeds the threshold', () => {
    const lastMessageAt = 1_000_000;
    expect(isStale(lastMessageAt, lastMessageAt + 5001)).toBe(true);
  });
});
