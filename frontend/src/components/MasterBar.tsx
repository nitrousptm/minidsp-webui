import { useEffect, useRef, useState } from 'react';
import type { HostVolume, MasterStatus, PresetSummary, Source } from '../types';
import { MASTER_VOLUME_RANGE } from '../types';

const VOLUME_EPSILON = 0.05;
const PENDING_EDIT_TIMEOUT_MS = 4000;

export function MasterBar({
  master,
  hostVolume,
  presets,
  availableSources,
  onSourceChange,
  onVolumeChange,
  onMuteToggle,
  onPresetSelect,
  onOpenPresetManager,
}: {
  master: MasterStatus | null;
  hostVolume?: HostVolume | null;
  presets: PresetSummary[];
  availableSources: Source[];
  onSourceChange: (source: Source) => void;
  onVolumeChange: (volume: number) => void;
  onMuteToggle: () => void;
  onPresetSelect: (index: number) => void;
  onOpenPresetManager: () => void;
}) {
  // `master` is refreshed several times a second from the live status
  // WebSocket (level meters). Without a local buffer, that constant stream
  // of server-reported values snaps the slider/dropdown back to the
  // pre-edit state on every tick, making them feel unresponsive or "stuck".
  // These local overrides win until the server confirms the new value (or a
  // safety timeout elapses), then hand control back to the live prop.
  const propVolume = master?.volume ?? MASTER_VOLUME_RANGE.min;
  const propSource = master?.source;

  const [localVolume, setLocalVolume] = useState<number | null>(null);
  const [localSource, setLocalSource] = useState<Source | null>(null);

  const volumeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const volumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sourceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (localVolume !== null && Math.abs(propVolume - localVolume) < VOLUME_EPSILON) {
      setLocalVolume(null);
    }
  }, [propVolume, localVolume]);

  useEffect(() => {
    if (localSource !== null && propSource === localSource) {
      setLocalSource(null);
    }
  }, [propSource, localSource]);

  useEffect(
    () => () => {
      if (volumeDebounceRef.current) clearTimeout(volumeDebounceRef.current);
      if (volumeTimeoutRef.current) clearTimeout(volumeTimeoutRef.current);
      if (sourceTimeoutRef.current) clearTimeout(sourceTimeoutRef.current);
    },
    [],
  );

  const volume = localVolume ?? propVolume;
  const source = localSource ?? propSource ?? '';

  function commitVolume(next: number) {
    setLocalVolume(next);
    if (volumeDebounceRef.current) clearTimeout(volumeDebounceRef.current);
    if (volumeTimeoutRef.current) clearTimeout(volumeTimeoutRef.current);
    volumeTimeoutRef.current = setTimeout(() => setLocalVolume(null), PENDING_EDIT_TIMEOUT_MS);
    onVolumeChange(next);
  }

  function handleSliderInput(next: number) {
    setLocalVolume(next);
    if (volumeDebounceRef.current) clearTimeout(volumeDebounceRef.current);
    // debounce the actual write so dragging doesn't fire a device write per pixel
    volumeDebounceRef.current = setTimeout(() => commitVolume(next), 80);
  }

  function handleSourceChange(next: Source) {
    setLocalSource(next);
    if (sourceTimeoutRef.current) clearTimeout(sourceTimeoutRef.current);
    sourceTimeoutRef.current = setTimeout(() => setLocalSource(null), PENDING_EDIT_TIMEOUT_MS);
    onSourceChange(next);
  }

  return (
    <div className="master-bar">
      <div className="preset-tabs">
        {presets.map((p) => (
          <button
            key={p.index}
            className={`preset-tab${p.active ? ' active' : ''}`}
            onClick={() => onPresetSelect(p.index)}
          >
            {p.name}
          </button>
        ))}
        <button className="small-btn" onClick={onOpenPresetManager}>
          Manage Presets…
        </button>
      </div>

      <select value={source} onChange={(e) => handleSourceChange(e.target.value as Source)}>
        {availableSources.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <div className="slider-row" style={{ flex: 1, maxWidth: 360 }}>
        <button
          className="small-btn"
          onClick={() => commitVolume(Math.max(MASTER_VOLUME_RANGE.min, volume - 0.5))}
        >
          −
        </button>
        <input
          type="range"
          min={MASTER_VOLUME_RANGE.min}
          max={MASTER_VOLUME_RANGE.max}
          step={MASTER_VOLUME_RANGE.step}
          value={volume}
          onChange={(e) => handleSliderInput(Number(e.target.value))}
        />
        <button
          className="small-btn"
          onClick={() => commitVolume(Math.min(MASTER_VOLUME_RANGE.max, volume + 0.5))}
        >
          +
        </button>
        <span className="slider-value">{volume.toFixed(1)} dB</span>
      </div>

      {hostVolume && (
        // A second, host-driven attenuator in front of the DSP (the 2x4 HD's
        // USB volume, e.g. moOde's knob). Read-only here on purpose: the
        // player owns it. Shown so the master slider isn't mistaken for the
        // whole picture - the sum is what actually reaches the outputs.
        <span
          className="host-volume"
          title={`${hostVolume.control} on host ALSA card ${hostVolume.card} (${hostVolume.raw}/${hostVolume.rawMax}). Set by the player on the host, not by this console. Total = USB + master.`}
        >
          USB {hostVolume.mute ? 'muted' : `${hostVolume.dB.toFixed(0)} dB`} · total{' '}
          {hostVolume.mute || master?.mute ? 'muted' : `${(hostVolume.dB + volume).toFixed(1)} dB`}
        </span>
      )}

      <button className={`strip-button${master?.mute ? ' active-red' : ''}`} onClick={onMuteToggle}>
        {master?.mute ? 'MUTED' : 'MUTE'}
      </button>
    </div>
  );
}
