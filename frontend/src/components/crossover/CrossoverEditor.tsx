import { useState } from 'react';
import type { Biquad, CrossoverBasicParams, CrossoverFamily, CrossoverGroup, CrossoverVerifyResult, OutputChannelState } from '../../types';
import { SAMPLE_RATE } from '../../types';
import { buildCrossoverBiquads } from '../../lib/biquad';
import { CrossoverChart, type ChannelCurve, type CrossoverHandle, type MeasuredCurve } from './CrossoverChart';
import { api } from '../../api/client';

const CHANNEL_COLORS = ['#4a9eff', '#3ecf6e', '#c66bff', '#e8c547'];

const SLOPES_BY_FAMILY: Record<CrossoverFamily, number[]> = {
  BUTTERWORTH: [6, 12, 18, 24, 30, 36, 42, 48],
  LINKWITZ_RILEY: [12, 24, 48],
  BESSEL: [12],
};

function defaultBasic(kind: 'highpass' | 'lowpass'): CrossoverBasicParams {
  return { family: 'BUTTERWORTH', slopeDbPerOct: 24, freq: kind === 'highpass' ? 80 : 2500 };
}

function groupOf(output: OutputChannelState, index: 0 | 1): CrossoverGroup {
  return output.crossover.find((c) => c.index === index)!;
}

export function CrossoverEditor({
  outputs,
  currentIndex,
  onChange,
}: {
  outputs: OutputChannelState[];
  currentIndex: number;
  onChange: (group: 0 | 1, patch: { bypass?: boolean; coeff?: Biquad[]; basic?: CrossoverBasicParams }) => void;
}) {
  const [visible, setVisible] = useState<boolean[]>(outputs.map(() => true));
  const [verifyState, setVerifyState] = useState<
    { status: 'idle' } | { status: 'running' } | { status: 'done'; result: CrossoverVerifyResult } | { status: 'error'; message: string }
  >({ status: 'idle' });

  async function runVerify() {
    setVerifyState({ status: 'running' });
    try {
      const result = await api.verifyOutputCrossover(currentIndex);
      setVerifyState({ status: 'done', result });
    } catch (err) {
      setVerifyState({ status: 'error', message: (err as Error).message });
    }
  }

  const measuredCurves: MeasuredCurve[] | undefined =
    verifyState.status === 'done'
      ? [
          { frequencies: verifyState.result.frequencies, measuredDeltaDb: verifyState.result.highpass.measuredDeltaDb, color: '#5ec8ff', width: 1.75 },
          { frequencies: verifyState.result.frequencies, measuredDeltaDb: verifyState.result.lowpass.measuredDeltaDb, color: '#ff6ec7', width: 1.75 },
          {
            frequencies: verifyState.result.frequencies,
            measuredDeltaDb: verifyState.result.combined.measuredDeltaDb,
            color: '#3ecf6e',
            width: 2.5,
            showDots: true,
          },
        ]
      : undefined;

  const curves: ChannelCurve[] = outputs.map((output, i) => {
    const hp = groupOf(output, 0);
    const lp = groupOf(output, 1);
    return {
      outputIndex: i,
      color: i === currentIndex ? '#ff8c42' : CHANNEL_COLORS[i % CHANNEL_COLORS.length],
      hpBiquads: hp.bypass ? [] : hp.coeff,
      lpBiquads: lp.bypass ? [] : lp.coeff,
      visible: visible[i],
    };
  });

  function updateGroup(kind: 'highpass' | 'lowpass', patch: Partial<CrossoverBasicParams> & { bypass?: boolean }) {
    const groupIndex: 0 | 1 = kind === 'highpass' ? 0 : 1;
    const output = outputs[currentIndex];
    const group = groupOf(output, groupIndex);
    const basic = { ...(group.basic ?? defaultBasic(kind)), ...patch };
    const coeff = buildCrossoverBiquads(basic.family, kind, basic.slopeDbPerOct, basic.freq, SAMPLE_RATE);
    onChange(groupIndex, { basic, bypass: patch.bypass ?? group.bypass, coeff });
  }

  const output = outputs[currentIndex];
  const hp = groupOf(output, 0);
  const lp = groupOf(output, 1);
  const hpBasic = hp.basic ?? defaultBasic('highpass');
  const lpBasic = lp.basic ?? defaultBasic('lowpass');

  const handles: CrossoverHandle[] = [
    { kind: 'highpass', freq: hpBasic.freq, biquads: hp.bypass ? [] : hp.coeff, enabled: !hp.bypass },
    { kind: 'lowpass', freq: lpBasic.freq, biquads: lp.bypass ? [] : lp.coeff, enabled: !lp.bypass },
  ];

  return (
    <div>
      <CrossoverChart
        curves={curves}
        handles={handles}
        sampleRate={SAMPLE_RATE}
        onDragHandle={(kind, freq) => updateGroup(kind, { freq })}
        measuredCurves={measuredCurves}
      />
      <div className="toolbar">
        {outputs.map((o, i) => (
          <label key={i} style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            <input type="checkbox" checked={visible[i]} onChange={(e) => setVisible((v) => v.map((x, j) => (j === i ? e.target.checked : x)))} />{' '}
            {o.label}
          </label>
        ))}
        <button className="small-btn" onClick={runVerify} disabled={verifyState.status === 'running'}>
          {verifyState.status === 'running' ? 'Measuring… (~30-40s, please stay quiet)' : 'Verify against hardware'}
        </button>
      </div>
      {verifyState.status === 'error' && (
        <div style={{ color: 'var(--accent-red)', fontSize: 12, marginBottom: 6 }}>Verification failed: {verifyState.message}</div>
      )}
      {verifyState.status === 'done' && (
        <div style={{ color: '#3ecf6e', fontSize: 12, marginBottom: 6 }}>
          ✓ Measured with a real continuous sine sweep (20Hz–20kHz) through the DSP chip itself for {output.label}:
          high-pass alone (<span style={{ color: '#5ec8ff' }}>light blue</span>), low-pass alone (
          <span style={{ color: '#ff6ec7' }}>pink</span>), and both together as actually configured (
          <span style={{ color: '#3ecf6e' }}>bold green</span>).
        </div>
      )}

      <div className="strip-row">
        <CrossoverGroupPanel
          title="High-Pass"
          bypass={hp.bypass}
          basic={hpBasic}
          onEnableChange={(enabled) => updateGroup('highpass', { bypass: !enabled })}
          onBasicChange={(patch) => updateGroup('highpass', patch)}
        />
        <CrossoverGroupPanel
          title="Low-Pass"
          bypass={lp.bypass}
          basic={lpBasic}
          onEnableChange={(enabled) => updateGroup('lowpass', { bypass: !enabled })}
          onBasicChange={(patch) => updateGroup('lowpass', patch)}
        />
      </div>
    </div>
  );
}

function CrossoverGroupPanel({
  title,
  bypass,
  basic,
  onEnableChange,
  onBasicChange,
}: {
  title: string;
  bypass: boolean;
  basic: CrossoverBasicParams;
  onEnableChange: (enabled: boolean) => void;
  onBasicChange: (patch: Partial<CrossoverBasicParams>) => void;
}) {
  const slopes = SLOPES_BY_FAMILY[basic.family];
  return (
    <div className="panel" style={{ flex: 1, minWidth: 260 }}>
      <div className="toolbar" style={{ justifyContent: 'space-between' }}>
        <strong style={{ fontSize: 13 }}>{title}</strong>
        <label style={{ fontSize: 12 }}>
          <input type="checkbox" checked={!bypass} onChange={(e) => onEnableChange(e.target.checked)} /> Enable
        </label>
      </div>
      <div className="field-grid">
        <div className="field">
          <label>Cut-off frequency (Hz)</label>
          <input
            type="number"
            min={10}
            max={22000}
            value={Math.round(basic.freq)}
            disabled={bypass}
            onChange={(e) => onBasicChange({ freq: Number(e.target.value) })}
          />
        </div>
        <div className="field">
          <label>Filter family</label>
          <select
            value={basic.family}
            disabled={bypass}
            onChange={(e) => {
              const family = e.target.value as CrossoverFamily;
              const allowed = SLOPES_BY_FAMILY[family];
              const slopeDbPerOct = allowed.includes(basic.slopeDbPerOct) ? basic.slopeDbPerOct : allowed[0];
              onBasicChange({ family, slopeDbPerOct });
            }}
          >
            <option value="BUTTERWORTH">Butterworth (BW)</option>
            <option value="LINKWITZ_RILEY">Linkwitz-Riley (LR)</option>
            <option value="BESSEL">Bessel</option>
          </select>
        </div>
        <div className="field">
          <label>Slope (dB/oct)</label>
          <select
            value={basic.slopeDbPerOct}
            disabled={bypass}
            onChange={(e) => onBasicChange({ slopeDbPerOct: Number(e.target.value) })}
          >
            {slopes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
