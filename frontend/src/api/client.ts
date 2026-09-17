import type {
  Biquad,
  Compressor,
  CrossoverBasicParams,
  CrossoverGroup,
  CrossoverVerifyResult,
  DeviceConfigState,
  DeviceInfoResponse,
  Fir,
  HostVolumeResponse,
  PeqBasicParams,
  PeqVerifyResult,
  PresetSummary,
  Source,
  StatusSummary,
} from '../types';

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${method} ${url} failed (${res.status}): ${text}`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  return (contentType.includes('application/json') ? await res.json() : (undefined as unknown)) as T;
}

export const api = {
  getDevice: () => request<DeviceInfoResponse>('GET', '/api/device'),
  getMaster: () => request<StatusSummary>('GET', '/api/master'),
  setMaster: (patch: { preset?: number; source?: Source; volume?: number; mute?: boolean }) =>
    request<{ ok: true }>('POST', '/api/master', patch),

  getState: () => request<DeviceConfigState>('GET', '/api/state'),

  updateInput: (index: number, patch: { label?: string; gain?: number; mute?: boolean }) =>
    request('PUT', `/api/inputs/${index}`, patch),
  updateInputPeq: (index: number, peqIndex: number, patch: { bypass?: boolean; coeff?: Biquad; basic?: PeqBasicParams }) =>
    request('PUT', `/api/inputs/${index}/peq/${peqIndex}`, patch),
  updateRouting: (inputIndex: number, outputIndex: number, patch: { gain?: number; mute?: boolean }) =>
    request('PUT', `/api/inputs/${inputIndex}/routing/${outputIndex}`, patch),

  updateOutput: (
    index: number,
    patch: { label?: string; gain?: number; mute?: boolean; invert?: boolean; delayMs?: number },
  ) => request('PUT', `/api/outputs/${index}`, patch),
  updateOutputPeq: (index: number, peqIndex: number, patch: { bypass?: boolean; coeff?: Biquad; basic?: PeqBasicParams }) =>
    request('PUT', `/api/outputs/${index}/peq/${peqIndex}`, patch),
  updateCrossover: (
    index: number,
    group: 0 | 1,
    patch: { bypass?: boolean; coeff?: Biquad[]; basic?: CrossoverBasicParams },
  ) => request<CrossoverGroup>('PUT', `/api/outputs/${index}/crossover/${group}`, patch),
  updateCompressor: (index: number, patch: Partial<Compressor>) =>
    request<Compressor>('PUT', `/api/outputs/${index}/compressor`, patch),
  updateFir: (index: number, patch: Partial<Fir>) => request<Fir>('PUT', `/api/outputs/${index}/fir`, patch),

  getPresets: () => request<PresetSummary[]>('GET', '/api/presets'),
  getHostVolume: () => request<HostVolumeResponse>('GET', '/api/host-volume'),
  activatePreset: (index: number) => request('POST', `/api/presets/${index}/activate`),
  renamePreset: (index: number, name: string) => request('POST', `/api/presets/${index}/rename`, { name }),
  resetPreset: (index: number) => request('POST', `/api/presets/${index}/reset`),
  resetAllPresets: () => request('POST', '/api/presets/reset-all'),
  exportPresetUrl: (index: number) => `/api/presets/${index}/export`,
  importPreset: (index: number, state: DeviceConfigState) => request('POST', `/api/presets/${index}/import`, state),

  getBackups: () => request<string[]>('GET', '/api/backups'),
  saveBackup: (name: string) => request('POST', '/api/backups', { name }),
  restoreBackup: (name: string) => request('POST', `/api/backups/${encodeURIComponent(name)}/restore`),

  verifyOutputPeq: (index: number) => request<PeqVerifyResult>('POST', `/api/outputs/${index}/peq/verify`),
  verifyOutputCrossover: (index: number) => request<CrossoverVerifyResult>('POST', `/api/outputs/${index}/crossover/verify`),
};
