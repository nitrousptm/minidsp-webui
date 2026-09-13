import type { MinidspClient, DeviceInfo } from '../minidspClient.js';
import type { StatusSummary, WireConfig, Source } from '../types.js';

/**
 * In-memory stand-in for a running minidspd + physical 2x4HD, used for local
 * development and automated tests. Mirrors the real device's read/write
 * asymmetry: only master status + levels are readable, everything else is
 * accepted write-only (recorded here purely for test assertions).
 */
export class MockMinidspClient implements MinidspClient {
  private master = { preset: 0, source: 'Usb' as Source, volume: -20, mute: false };
  private listeners = new Set<(status: StatusSummary) => void>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  lastAppliedConfig: WireConfig | null = null;
  appliedConfigs: WireConfig[] = [];

  async listDevices(): Promise<DeviceInfo[]> {
    return [
      {
        url: 'mock://2x4hd',
        product_name: '2x4HD',
        version: { hw_id: 10, fw_major: 1, fw_minor: 81, dsp_version: 100, serial: 925858 },
      },
    ];
  }

  async getStatus(): Promise<StatusSummary> {
    return {
      master: { ...this.master },
      input_levels: [-30, -31],
      output_levels: [-30, -31, -120, -120],
    };
  }

  async postConfig(cfg: WireConfig): Promise<void> {
    validateWireConfig(cfg);
    if (cfg.master_status) {
      Object.assign(this.master, cfg.master_status);
    }
    this.lastAppliedConfig = cfg;
    this.appliedConfigs.push(cfg);
    for (const listener of this.listeners) {
      listener({ master: { ...this.master }, input_levels: [-30, -31], output_levels: [-30, -31, -120, -120] });
    }
  }

  onStatus(listener: (status: StatusSummary) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  connect(): void {
    // Mirrors minidspd's real `poll=true` WebSocket behavior: most ticks are
    // level-meter-only frames carrying an *empty* `master: {}` (present, not
    // null - confirmed against the live device), with a full master status
    // only included roughly every 10th tick. Sending a fully-populated
    // master on every tick (as this used to) would hide bugs in consumers
    // that don't handle the empty-master frames minidspd actually sends.
    if (this.pollTimer) return;
    let tick = 0;
    this.pollTimer = setInterval(() => {
      tick++;
      const status: StatusSummary = {
        master: tick % 10 === 0 ? { ...this.master } : ({} as StatusSummary['master']),
        input_levels: [-30, -31],
        output_levels: [-30, -31, -120, -120],
      };
      for (const listener of this.listeners) listener(status);
    }, 100);
  }

  close(): void {
    this.listeners.clear();
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}

/**
 * Mirrors validation the *real* minidspd performs, discovered the hard way:
 * it rejects a crossover group's coeff array with "Internal error: biquad
 * index not specified" if each biquad doesn't carry its own `index`. Our
 * mock used to accept anything, which is exactly how that bug reached
 * production - the fast test suite never had a chance to catch it. Extend
 * this whenever another wire-format requirement is found against the real
 * device, so it fails fast here instead of only in production.
 */
function validateWireConfig(cfg: WireConfig): void {
  for (const output of cfg.outputs ?? []) {
    for (const group of output.crossover ?? []) {
      for (const biquad of group.coeff ?? []) {
        if (!('index' in biquad) || (biquad as { index?: number }).index === undefined) {
          throw new Error(
            `minidspd would reject this: crossover biquad missing "index" (output ${output.index}, group ${group.index})`,
          );
        }
      }
    }
  }
}
