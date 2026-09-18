import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useDeviceSocket } from '../api/useDeviceSocket';
import type {
  Biquad,
  CrossoverBasicParams,
  DeviceConfigState,
  DeviceInfoResponse,
  HostVolume,
  PeqBasicParams,
  PresetSummary,
  Source,
} from '../types';
import { MasterBar } from '../components/MasterBar';
import { InputStrip } from '../components/InputStrip';
import { OutputStrip } from '../components/OutputStrip';
import { Modal } from '../components/Modal';
import { PeqEditor } from '../components/peq/PeqEditor';
import { CrossoverEditor } from '../components/crossover/CrossoverEditor';
import { CompressorEditor } from '../components/compressor/CompressorEditor';
import { FirEditor } from '../components/fir/FirEditor';
import { PresetManager } from '../components/presets/PresetManager';

type ModalState =
  | { kind: 'none' }
  | { kind: 'input-peq'; index: number }
  | { kind: 'output-peq'; index: number }
  | { kind: 'crossover'; index: number }
  | { kind: 'compressor'; index: number }
  | { kind: 'fir'; index: number }
  | { kind: 'presets' };

export function Dashboard() {
  const [device, setDevice] = useState<DeviceInfoResponse | null>(null);
  const [state, setState] = useState<DeviceConfigState | null>(null);
  const [presets, setPresets] = useState<PresetSummary[]>([]);
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });
  const { status: liveStatus, stale: liveStatusStale } = useDeviceSocket();
  const [masterFallback, setMasterFallback] = useState<Awaited<ReturnType<typeof api.getMaster>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hostVolume, setHostVolume] = useState<HostVolume | null>(null);

  async function refreshAll() {
    const [d, s, p, m] = await Promise.all([api.getDevice(), api.getState(), api.getPresets(), api.getMaster()]);
    setDevice(d);
    setState(s);
    setPresets(p);
    setMasterFallback(m);
  }

  useEffect(() => {
    refreshAll();
  }, []);

  // A preset switched by someone else - an IR remote hitting the API, a
  // second browser on the phone - only shows up as a changed master.preset
  // in minidspd's live status. Re-sync tabs and channel state from the
  // backend when that happens. Keyed on *changes* of the live value (not on
  // every mismatch), so a backend/device disagreement can't trigger an
  // endless refresh loop. Note the real minidspd sends master fields only
  // when something changed, not on a schedule: in steady state the very
  // first populated frame IS the change, so it must not be skipped as an
  // "initial" one - the comparison against the backend's active preset is
  // what decides whether a refresh is needed.
  const livePreset =
    liveStatus?.master && Object.keys(liveStatus.master).length > 0 ? liveStatus.master.preset : undefined;
  const lastLivePreset = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (livePreset === undefined || livePreset === lastLivePreset.current) return;
    lastLivePreset.current = livePreset;
    if (presets.find((p) => p.active)?.index !== livePreset) refreshAll();
  }, [livePreset]);

  // The host-side USB volume (if any) changes behind our back - a rotary
  // encoder, a player's knob - and isn't part of minidspd's status stream,
  // so poll it. Cheap: the backend caches the amixer read for a second.
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      if (document.hidden) return;
      try {
        const v = await api.getHostVolume();
        if (!cancelled) setHostVolume(v.available ? v : null);
      } catch {
        if (!cancelled) setHostVolume(null);
      }
    }
    poll();
    const timer = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!device || !state) {
    return <div style={{ padding: 24 }}>Connecting to minidsp-webui backend…</div>;
  }

  // liveStatus.master can be present-but-empty ({}) on the very first WS
  // frame - minidspd's level-only ticks always include a master key, just
  // without real fields, and `{} ?? x` doesn't fall through since {} isn't
  // nullish. Only trust it once it actually has something in it, otherwise
  // prefer the initial HTTP fetch over showing blank/default values.
  const liveMaster = liveStatus?.master;
  const hasLiveMaster = !!liveMaster && Object.keys(liveMaster).length > 0;
  const master = (hasLiveMaster ? liveMaster : null) ?? masterFallback?.master ?? null;
  const inputLevels = liveStatus?.input_levels ?? masterFallback?.input_levels ?? state.inputs.map(() => -120);
  const outputLevels = liveStatus?.output_levels ?? masterFallback?.output_levels ?? state.outputs.map(() => -120);

  function updateInputLocal(index: number, patch: Partial<DeviceConfigState['inputs'][number]>) {
    setState((s) => {
      if (!s) return s;
      const inputs = s.inputs.map((inp, i) => (i === index ? { ...inp, ...patch } : inp));
      return { ...s, inputs };
    });
  }

  function updateOutputLocal(index: number, patch: Partial<DeviceConfigState['outputs'][number]>) {
    setState((s) => {
      if (!s) return s;
      const outputs = s.outputs.map((out, i) => (i === index ? { ...out, ...patch } : out));
      return { ...s, outputs };
    });
  }

  // These compute the new nested array *inside* the functional setState updater
  // (using the freshest `s`, not the `state` closure) so that several calls
  // fired synchronously in a row - e.g. importing multiple REW filters at
  // once - don't clobber each other by each reading the same stale snapshot.
  function updateInputPeqLocal(inputIndex: number, peqIndex: number, patch: { bypass?: boolean; coeff?: Biquad; basic?: PeqBasicParams }) {
    setState((s) => {
      if (!s) return s;
      const inputs = s.inputs.map((inp, i) =>
        i === inputIndex ? { ...inp, peq: inp.peq.map((slot) => (slot.index === peqIndex ? { ...slot, ...patch } : slot)) } : inp,
      );
      return { ...s, inputs };
    });
  }

  function updateOutputPeqLocal(outputIndex: number, peqIndex: number, patch: { bypass?: boolean; coeff?: Biquad; basic?: PeqBasicParams }) {
    setState((s) => {
      if (!s) return s;
      const outputs = s.outputs.map((out, i) =>
        i === outputIndex ? { ...out, peq: out.peq.map((slot) => (slot.index === peqIndex ? { ...slot, ...patch } : slot)) } : out,
      );
      return { ...s, outputs };
    });
  }

  function updateCrossoverGroupLocal(
    outputIndex: number,
    group: 0 | 1,
    patch: { bypass?: boolean; coeff?: Biquad[]; basic?: CrossoverBasicParams },
  ) {
    setState((s) => {
      if (!s) return s;
      const outputs = s.outputs.map((out, i) =>
        i === outputIndex ? { ...out, crossover: out.crossover.map((g) => (g.index === group ? { ...g, ...patch } : g)) } : out,
      );
      return { ...s, outputs };
    });
  }

  function updateRoutingLocal(inputIndex: number, outputIndex: number, patch: { gain?: number; mute?: boolean }) {
    setState((s) => {
      if (!s) return s;
      const inputs = s.inputs.map((inp, i) => {
        if (i !== inputIndex) return inp;
        const exists = inp.routing.some((r) => r.index === outputIndex);
        const routing = exists
          ? inp.routing.map((r) => (r.index === outputIndex ? { ...r, ...patch } : r))
          : [...inp.routing, { index: outputIndex, gain: patch.gain ?? 0, mute: patch.mute ?? false }];
        return { ...inp, routing };
      });
      return { ...s, inputs };
    });
  }

  async function handleMasterVolume(volume: number) {
    await api.setMaster({ volume });
    setMasterFallback((m) => (m ? { ...m, master: { ...m.master, volume } } : m));
  }
  async function handleMasterMute() {
    const next = !(master?.mute ?? false);
    await api.setMaster({ mute: next });
    setMasterFallback((m) => (m ? { ...m, master: { ...m.master, mute: next } } : m));
  }
  async function handleMasterSource(source: Source) {
    await api.setMaster({ source });
    setMasterFallback((m) => (m ? { ...m, master: { ...m.master, source } } : m));
  }
  async function handlePresetSelect(index: number) {
    // minidspd is known to occasionally time out on the full-config push a
    // preset activation triggers (minidspd-watchdog restarts it when that
    // happens). Previously, that rejection here meant refreshAll() below
    // never ran - the preset tab stayed highlighted on the OLD preset and
    // the error vanished into an unhandled promise rejection, even though
    // the backend may have partially (or fully) applied the change. Always
    // re-sync from the backend's actual state, and surface the failure
    // instead of hiding it.
    try {
      await api.activatePreset(index);
      setError(null);
    } catch (err) {
      setError(`Preset konnte nicht vollständig aktiviert werden: ${(err as Error).message}`);
    } finally {
      await refreshAll();
      setModal({ kind: 'none' });
    }
  }

  return (
    <div className="app-shell">
      <div className="header-bar">
        <h1>miniDSP 2x4 HD Console</h1>
        <span className="device-badge">
          {device.device?.product_name ?? 'No device'}{' '}
          {device.device?.version ? `· S/N ${device.device.version.serial} · FW ${device.device.version.fw_major}.${device.device.version.fw_minor}` : ''}
        </span>
      </div>

      {liveStatusStale && (
        <div className="status-banner status-banner-warn">
          Live-Verbindung reagiert nicht (minidspd hängt evtl. gerade) — Pegelanzeigen können veraltet sein. Verbindung wird automatisch wiederhergestellt…
        </div>
      )}
      {error && (
        <div className="status-banner status-banner-error">
          {error}
          <button className="small-btn" onClick={() => setError(null)}>
            Ausblenden
          </button>
        </div>
      )}

      <div className="app-main">
        <div className="strip-row">
          {state.inputs.map((input, i) => (
            <InputStrip
              key={i}
              input={input}
              index={i}
              levelDb={inputLevels[i] ?? -120}
              onLabelChange={async (label) => {
                updateInputLocal(i, { label });
                await api.updateInput(i, { label });
              }}
              onGainChange={async (gain) => {
                updateInputLocal(i, { gain });
                await api.updateInput(i, { gain });
              }}
              onMuteToggle={async () => {
                const mute = !input.mute;
                updateInputLocal(i, { mute });
                await api.updateInput(i, { mute });
              }}
              onOpenPeq={() => setModal({ kind: 'input-peq', index: i })}
            />
          ))}
        </div>

        <div className="strip-row">
          {state.outputs.map((output, i) => (
            <OutputStrip
              key={i}
              output={output}
              index={i}
              inputs={state.inputs}
              levelDb={outputLevels[i] ?? -120}
              onLabelChange={async (label) => {
                updateOutputLocal(i, { label });
                await api.updateOutput(i, { label });
              }}
              onGainChange={async (gain) => {
                updateOutputLocal(i, { gain });
                await api.updateOutput(i, { gain });
              }}
              onMuteToggle={async () => {
                const mute = !output.mute;
                updateOutputLocal(i, { mute });
                await api.updateOutput(i, { mute });
              }}
              onInvertToggle={async () => {
                const invert = !output.invert;
                updateOutputLocal(i, { invert });
                await api.updateOutput(i, { invert });
              }}
              onDelayChange={async (delayMs) => {
                updateOutputLocal(i, { delayMs });
                await api.updateOutput(i, { delayMs });
              }}
              onRoutingToggle={async (inputIndex) => {
                const entry = state.inputs[inputIndex].routing.find((r) => r.index === i);
                const nextMute = entry ? !entry.mute : false;
                updateRoutingLocal(inputIndex, i, { mute: nextMute });
                await api.updateRouting(inputIndex, i, { mute: nextMute });
              }}
              onRoutingGainChange={async (inputIndex, gain) => {
                updateRoutingLocal(inputIndex, i, { gain });
                await api.updateRouting(inputIndex, i, { gain });
              }}
              onOpenCrossover={() => setModal({ kind: 'crossover', index: i })}
              onOpenPeq={() => setModal({ kind: 'output-peq', index: i })}
              onOpenFir={() => setModal({ kind: 'fir', index: i })}
              onOpenCompressor={() => setModal({ kind: 'compressor', index: i })}
            />
          ))}
        </div>
      </div>

      <MasterBar
        master={master}
        hostVolume={hostVolume}
        presets={presets}
        availableSources={device.layout.availableSources}
        onSourceChange={handleMasterSource}
        onVolumeChange={handleMasterVolume}
        onMuteToggle={handleMasterMute}
        onPresetSelect={handlePresetSelect}
        onOpenPresetManager={() => setModal({ kind: 'presets' })}
      />

      {modal.kind === 'input-peq' && (
        <Modal title={`${state.inputs[modal.index].label} — Parametric EQ`} onClose={() => setModal({ kind: 'none' })}>
          <PeqEditor
            channelLabel={state.inputs[modal.index].label}
            slots={state.inputs[modal.index].peq}
            onChange={async (peqIndex, patch) => {
              const index = modal.index;
              updateInputPeqLocal(index, peqIndex, patch);
              await api.updateInputPeq(index, peqIndex, patch);
            }}
          />
        </Modal>
      )}

      {modal.kind === 'output-peq' && (
        <Modal title={`${state.outputs[modal.index].label} — Parametric EQ`} onClose={() => setModal({ kind: 'none' })}>
          <PeqEditor
            channelLabel={state.outputs[modal.index].label}
            slots={state.outputs[modal.index].peq}
            outputIndex={modal.index}
            onChange={async (peqIndex, patch) => {
              const index = modal.index;
              updateOutputPeqLocal(index, peqIndex, patch);
              await api.updateOutputPeq(index, peqIndex, patch);
            }}
          />
        </Modal>
      )}

      {modal.kind === 'crossover' && (
        <Modal title={`${state.outputs[modal.index].label} — Crossover`} onClose={() => setModal({ kind: 'none' })}>
          <CrossoverEditor
            outputs={state.outputs}
            currentIndex={modal.index}
            onChange={async (group, patch) => {
              const index = modal.index;
              updateCrossoverGroupLocal(index, group, patch);
              await api.updateCrossover(index, group, patch);
            }}
          />
        </Modal>
      )}

      {modal.kind === 'compressor' && (
        <Modal title={`${state.outputs[modal.index].label} — Compressor`} onClose={() => setModal({ kind: 'none' })}>
          <CompressorEditor
            compressor={state.outputs[modal.index].compressor}
            onChange={async (patch) => {
              const index = modal.index;
              const compressor = { ...state.outputs[index].compressor, ...patch };
              updateOutputLocal(index, { compressor });
              await api.updateCompressor(index, patch);
            }}
          />
        </Modal>
      )}

      {modal.kind === 'fir' && (
        <Modal title={`${state.outputs[modal.index].label} — FIR Filter`} onClose={() => setModal({ kind: 'none' })}>
          <FirEditor
            outputs={state.outputs}
            outputIndex={modal.index}
            onChange={async (patch) => {
              const index = modal.index;
              const fir = { ...state.outputs[index].fir, ...patch };
              updateOutputLocal(index, { fir });
              await api.updateFir(index, patch);
            }}
          />
        </Modal>
      )}

      {modal.kind === 'presets' && (
        <Modal title="Preset Manager" onClose={() => setModal({ kind: 'none' })}>
          <PresetManager onActivated={refreshAll} />
        </Modal>
      )}
    </div>
  );
}
