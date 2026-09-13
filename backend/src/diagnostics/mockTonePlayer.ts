import type { TonePlayer } from './tonePlayer.js';

/** No-op stand-in used in mock/test mode - there is no real ALSA device to
 * play into, so this just satisfies the interface without touching audio. */
export class MockTonePlayer implements TonePlayer {
  async startLogSweep(): Promise<() => Promise<void>> {
    return async () => {};
  }

  async pausePlaybackForTest(): Promise<() => Promise<void>> {
    return async () => {};
  }
}
