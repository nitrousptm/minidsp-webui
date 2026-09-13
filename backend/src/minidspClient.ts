import WebSocket from 'ws';
import { config, minidspHttpBase, minidspWsUrl } from './config.js';
import type { StatusSummary, WireConfig } from './types.js';
import { MockMinidspClient } from './mock/mockMinidspServer.js';

export interface DeviceInfo {
  url: string;
  product_name: string | null;
  version: { hw_id: number; fw_major: number; fw_minor: number; dsp_version: number; serial: number } | null;
}

export interface MinidspClient {
  listDevices(): Promise<DeviceInfo[]>;
  getStatus(): Promise<StatusSummary>;
  postConfig(cfg: WireConfig): Promise<void>;
  onStatus(listener: (status: StatusSummary) => void): () => void;
  connect(): void;
  close(): void;
}

class HttpMinidspClient implements MinidspClient {
  private listeners = new Set<(status: StatusSummary) => void>();
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  async listDevices(): Promise<DeviceInfo[]> {
    const res = await fetch(`${minidspHttpBase()}/devices`);
    if (!res.ok) throw new Error(`minidspd /devices returned ${res.status}`);
    return (await res.json()) as DeviceInfo[];
  }

  async getStatus(): Promise<StatusSummary> {
    const res = await fetch(`${minidspHttpBase()}/devices/${config.deviceIndex}`);
    if (!res.ok) throw new Error(`minidspd /devices/${config.deviceIndex} returned ${res.status}`);
    return (await res.json()) as StatusSummary;
  }

  async postConfig(cfg: WireConfig): Promise<void> {
    const res = await fetch(`${minidspHttpBase()}/devices/${config.deviceIndex}/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`minidspd config POST failed (${res.status}): ${text}`);
    }
  }

  onStatus(listener: (status: StatusSummary) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  connect(): void {
    this.openSocket();
  }

  private openSocket(): void {
    const ws = new WebSocket(minidspWsUrl());
    this.ws = ws;
    ws.on('message', (raw) => {
      try {
        const parsed = JSON.parse(raw.toString());
        if (parsed && parsed.master) {
          for (const listener of this.listeners) listener(parsed as StatusSummary);
        }
      } catch {
        // ignore malformed frames
      }
    });
    ws.on('close', () => {
      this.reconnectTimer = setTimeout(() => this.openSocket(), 2000);
    });
    ws.on('error', () => {
      ws.close();
    });
  }

  close(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}

export function createMinidspClient(): MinidspClient {
  return config.useMock ? new MockMinidspClient() : new HttpMinidspClient();
}
