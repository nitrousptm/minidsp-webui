import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import {
  NUM_PRESETS,
  defaultDeviceConfigState,
  type DeviceConfigState,
  type InputChannelState,
  type OutputChannelState,
} from './types.js';

/**
 * Our backend is the sole source of truth for the full DSP configuration,
 * because the 2x4HD / minidsp-rs cannot be read back (see plan doc). Every
 * mutation here is persisted to disk immediately and mirrors what gets sent
 * to the device via minidspClient.postConfig.
 */
export class ConfigStore {
  private presets: DeviceConfigState[] = [];
  private activePreset = 0;
  private ready: Promise<void>;

  constructor(private presetsDir = config.presetsDir, private backupsDir = config.backupsDir) {
    this.ready = this.load();
  }

  async whenReady(): Promise<void> {
    return this.ready;
  }

  private presetPath(index: number): string {
    return path.join(this.presetsDir, `preset-${index}.json`);
  }

  private async load(): Promise<void> {
    await mkdir(this.presetsDir, { recursive: true });
    await mkdir(this.backupsDir, { recursive: true });
    for (let i = 0; i < NUM_PRESETS; i++) {
      try {
        const raw = await readFile(this.presetPath(i), 'utf-8');
        this.presets[i] = JSON.parse(raw) as DeviceConfigState;
      } catch {
        this.presets[i] = defaultDeviceConfigState(i);
      }
    }
  }

  private async persist(index: number): Promise<void> {
    await writeFile(this.presetPath(index), JSON.stringify(this.presets[index], null, 2), 'utf-8');
  }

  getActivePresetIndex(): number {
    return this.activePreset;
  }

  setActivePresetIndex(index: number): void {
    this.activePreset = index;
  }

  getState(presetIndex = this.activePreset): DeviceConfigState {
    return this.presets[presetIndex];
  }

  getAllPresets(): DeviceConfigState[] {
    return this.presets;
  }

  async renamePreset(index: number, name: string): Promise<void> {
    this.presets[index].presetName = name.slice(0, 12);
    await this.persist(index);
  }

  async resetPreset(index: number): Promise<void> {
    this.presets[index] = defaultDeviceConfigState(index);
    await this.persist(index);
  }

  async resetAllPresets(): Promise<void> {
    for (let i = 0; i < NUM_PRESETS; i++) {
      this.presets[i] = defaultDeviceConfigState(i);
      await this.persist(i);
    }
  }

  async updateInput(index: number, patch: Partial<InputChannelState>, presetIndex = this.activePreset): Promise<InputChannelState> {
    const state = this.presets[presetIndex];
    state.inputs[index] = { ...state.inputs[index], ...patch };
    await this.persist(presetIndex);
    return state.inputs[index];
  }

  async updateOutput(index: number, patch: Partial<OutputChannelState>, presetIndex = this.activePreset): Promise<OutputChannelState> {
    const state = this.presets[presetIndex];
    state.outputs[index] = { ...state.outputs[index], ...patch };
    await this.persist(presetIndex);
    return state.outputs[index];
  }

  async persistActive(): Promise<void> {
    await this.persist(this.activePreset);
  }

  // ---- Named backups (export/import beyond the 4 device slots) ----

  async saveBackup(name: string, state: DeviceConfigState): Promise<void> {
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
    await writeFile(path.join(this.backupsDir, `${safeName}.json`), JSON.stringify(state, null, 2), 'utf-8');
  }

  async listBackups(): Promise<string[]> {
    const files = await readdir(this.backupsDir);
    return files.filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  }

  async loadBackup(name: string): Promise<DeviceConfigState> {
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const raw = await readFile(path.join(this.backupsDir, `${safeName}.json`), 'utf-8');
    return JSON.parse(raw) as DeviceConfigState;
  }
}
