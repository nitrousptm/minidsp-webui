import { useState } from 'react';
import type { Biquad, PeqBasicParams, PeqFilterType, PeqSlot, PeqVerifyResult } from '../../types';
import { PEQ_GAIN_RANGE, SAMPLE_RATE } from '../../types';
import { computePeqBiquad } from '../../lib/biquad';
import { importRewText, type RewImportResult } from '../../lib/rewImport';
import { FrequencyResponseChart, type MeasuredCurve } from './FrequencyResponseChart';
import { api } from '../../api/client';

const FILTER_TYPES: PeqFilterType[] = ['PEAK', 'LOW_SHELF', 'HIGH_SHELF', 'ALL_PASS'];

function defaultBasic(index: number): PeqBasicParams {
  return { type: 'PEAK', freq: 1000, gainDb: 0, q: 1 };
}

export function PeqEditor({
  channelLabel,
  slots,
  onChange,
  outputIndex,
}: {
  channelLabel: string;
  slots: PeqSlot[];
  onChange: (peqIndex: number, patch: { bypass?: boolean; coeff?: Biquad; basic?: PeqBasicParams }) => void;
  /** Only set for output channels - hardware verification reads the output
   * level meters, so it isn't available for input-side PEQ. */
  outputIndex?: number;
}) {
  const [advancedIndex, setAdvancedIndex] = useState<number | null>(null);
  const [rewImportOpen, setRewImportOpen] = useState(false);
  const [verifyState, setVerifyState] = useState<
    { status: 'idle' } | { status: 'running' } | { status: 'done'; result: PeqVerifyResult } | { status: 'error'; message: string }
  >({ status: 'idle' });

  async function runVerify() {
    if (outputIndex === undefined) return;
    setVerifyState({ status: 'running' });
    try {
      const result = await api.verifyOutputPeq(outputIndex);
      setVerifyState({ status: 'done', result });
    } catch (err) {
      setVerifyState({ status: 'error', message: (err as Error).message });
    }
  }

  const measuredCurves: MeasuredCurve[] | undefined =
    verifyState.status === 'done'
      ? [
          ...verifyState.result.perSlot.map((s): MeasuredCurve => ({
            frequencies: verifyState.result.frequencies,
            measuredDeltaDb: s.measuredDeltaDb,
            color: 'rgba(62, 207, 110, 0.4)',
            width: 1,
          })),
          {
            frequencies: verifyState.result.frequencies,
            measuredDeltaDb: verifyState.result.combined.measuredDeltaDb,
            color: '#3ecf6e',
            width: 2.5,
            showDots: true,
          },
        ]
      : undefined;

  function basicOf(slot: PeqSlot): PeqBasicParams {
    return slot.basic ?? defaultBasic(slot.index);
  }

  function applyBasicChange(slot: PeqSlot, patch: Partial<PeqBasicParams>) {
    const basic = { ...basicOf(slot), ...patch };
    const coeff = computePeqBiquad({ type: basic.type, freq: basic.freq, gainDb: basic.gainDb, q: basic.q }, SAMPLE_RATE);
    onChange(slot.index, { basic, coeff });
  }

  function setAllBypass(bypass: boolean) {
    slots.forEach((s) => onChange(s.index, { bypass }));
  }

  function applyRewFilters(filters: RewImportResult['filters']) {
    filters.slice(0, slots.length).forEach((f, i) => {
      const coeff = computePeqBiquad(
        { type: f.basic.type, freq: f.basic.freq, gainDb: f.basic.gainDb, q: f.basic.q },
        SAMPLE_RATE,
      );
      onChange(i, { basic: f.basic, coeff, bypass: f.bypass });
    });
  }

  function applyRewCoeffs(coeffs: Biquad[]) {
    coeffs.slice(0, slots.length).forEach((coeff, i) => {
      onChange(i, { coeff, bypass: false });
    });
  }

  const chartPoints = slots.map((s) => {
    const b = basicOf(s);
    return { index: s.index, freq: b.freq, gainDb: b.gainDb, type: b.type, bypass: s.bypass, coeff: s.coeff };
  });

  return (
    <div>
      <div className="toolbar">
        <span style={{ color: 'var(--text-dim)', fontSize: 12, alignSelf: 'center' }}>{channelLabel} — Parametric EQ</span>
        <button className="small-btn" onClick={() => setAllBypass(false)}>
          Enable All
        </button>
        <button className="small-btn" onClick={() => setAllBypass(true)}>
          Disable All
        </button>
        <button className="small-btn" onClick={() => setRewImportOpen((v) => !v)}>
          {rewImportOpen ? 'Hide REW Import' : 'Import from REW…'}
        </button>
        {outputIndex !== undefined && (
          <button className="small-btn" onClick={runVerify} disabled={verifyState.status === 'running'}>
            {verifyState.status === 'running' ? 'Measuring… (~1-2 min, please stay quiet)' : 'Verify against hardware'}
          </button>
        )}
      </div>

      {outputIndex !== undefined && verifyState.status === 'error' && (
        <div style={{ color: 'var(--accent-red)', fontSize: 12, marginBottom: 6 }}>
          Verification failed: {verifyState.message}
        </div>
      )}
      {outputIndex !== undefined && verifyState.status === 'done' && (
        <div style={{ color: '#3ecf6e', fontSize: 12, marginBottom: 6 }}>
          ✓ Measured with a real continuous sine sweep (20Hz–20kHz) through the DSP chip itself, reading its
          post-filter level meter. Each of the 10 PEQ slots was swept individually (thin green) plus all 10 together
          as actually configured (bold green) — compare against the predicted curves (blue).
        </div>
      )}

      {rewImportOpen && (
        <RewImportPanel
          slotCount={slots.length}
          onApplyFilters={applyRewFilters}
          onApplyCoeffs={applyRewCoeffs}
          onDone={() => setRewImportOpen(false)}
        />
      )}

      <FrequencyResponseChart
        points={chartPoints}
        sampleRate={SAMPLE_RATE}
        onDragPoint={(index, patch) => {
          const slot = slots[index];
          applyBasicChange(slot, patch);
        }}
        measuredCurves={measuredCurves}
      />

      <table className="peq-table">
        <thead>
          <tr>
            <th>#</th>
            <th>On</th>
            <th>Type</th>
            <th>Freq (Hz)</th>
            <th>Gain (dB)</th>
            <th>Q</th>
            <th>Advanced</th>
          </tr>
        </thead>
        <tbody>
          {slots.map((slot) => {
            const basic = basicOf(slot);
            return (
              <tr key={slot.index} style={{ opacity: slot.bypass ? 0.5 : 1 }}>
                <td>{slot.index + 1}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={!slot.bypass}
                    onChange={(e) => onChange(slot.index, { bypass: !e.target.checked })}
                  />
                </td>
                <td>
                  <select
                    value={basic.type}
                    onChange={(e) => applyBasicChange(slot, { type: e.target.value as PeqFilterType })}
                  >
                    {FILTER_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    min={10}
                    max={22000}
                    value={Math.round(basic.freq)}
                    onChange={(e) => applyBasicChange(slot, { freq: Number(e.target.value) })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step={0.1}
                    min={PEQ_GAIN_RANGE.min}
                    max={PEQ_GAIN_RANGE.max}
                    disabled={basic.type === 'ALL_PASS'}
                    value={basic.gainDb}
                    onChange={(e) => applyBasicChange(slot, { gainDb: Number(e.target.value) })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step={0.01}
                    min={0.1}
                    max={20}
                    value={basic.q}
                    onChange={(e) => applyBasicChange(slot, { q: Number(e.target.value) })}
                  />
                </td>
                <td>
                  <button className="small-btn" onClick={() => setAdvancedIndex(advancedIndex === slot.index ? null : slot.index)}>
                    {advancedIndex === slot.index ? 'Hide' : 'Biquad'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {advancedIndex !== null && (
        <AdvancedBiquadEditor
          slot={slots[advancedIndex]}
          onApply={(coeff) => onChange(advancedIndex, { coeff, bypass: false })}
        />
      )}
    </div>
  );
}

function RewImportPanel({
  slotCount,
  onApplyFilters,
  onApplyCoeffs,
  onDone,
}: {
  slotCount: number;
  onApplyFilters: (filters: RewImportResult['filters']) => void;
  onApplyCoeffs: (coeffs: Biquad[]) => void;
  onDone: () => void;
}) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<RewImportResult | null>(null);

  function process(source: string) {
    const parsed = importRewText(source);
    const overflow = parsed.format === 'filter-settings' ? parsed.filters.length - slotCount : parsed.coeffs.length - slotCount;
    if (overflow > 0) {
      parsed.warnings.push(
        `This channel only has ${slotCount} PEQ slots — the last ${overflow} filter(s) were not imported.`,
      );
    }
    setResult(parsed);
  }

  function apply() {
    if (!result) return;
    if (result.format === 'filter-settings') onApplyFilters(result.filters);
    else if (result.format === 'biquad') onApplyCoeffs(result.coeffs);
    onDone();
  }

  async function handleFile(file: File) {
    const content = await file.text();
    setText(content);
    process(content);
  }

  return (
    <div className="panel" style={{ marginBottom: 10 }}>
      <div className="field">
        <label>
          Paste a REW "Export Filter Settings as text" or biquad-coefficients export, or upload the .txt file
        </label>
        <textarea
          rows={6}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setResult(null);
          }}
          placeholder={'Filter  1: ON  PK       Fc    100.0 Hz  Gain   3.00 dB  Q  4.318\n...'}
        />
      </div>
      <div className="toolbar">
        <input type="file" accept=".txt" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
        <button className="small-btn" onClick={() => process(text)} disabled={!text.trim()}>
          Parse
        </button>
      </div>

      {result && (
        <div style={{ fontSize: 12, marginTop: 6 }}>
          {result.format === 'unknown' ? (
            <div style={{ color: 'var(--accent-red)' }}>{result.warnings[0]}</div>
          ) : (
            <>
              <div style={{ color: 'var(--text-dim)' }}>
                Detected {result.format === 'filter-settings' ? 'Filter Settings' : 'biquad coefficients'} export —{' '}
                {result.format === 'filter-settings' ? result.filters.length : result.coeffs.length} filter(s) parsed.
              </div>
              {result.warnings.map((w, i) => (
                <div key={i} style={{ color: 'var(--accent-yellow)' }}>
                  ⚠ {w}
                </div>
              ))}
              <div className="toolbar">
                <button
                  className="small-btn primary"
                  onClick={apply}
                  disabled={result.format === 'filter-settings' ? result.filters.length === 0 : result.coeffs.length === 0}
                >
                  Apply to PEQ slots
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function AdvancedBiquadEditor({
  slot,
  onApply,
}: {
  slot: PeqSlot;
  onApply: (coeff: Biquad) => void;
}) {
  const [text, setText] = useState(
    `b0=${slot.coeff.b0}\nb1=${slot.coeff.b1}\nb2=${slot.coeff.b2}\na1=${slot.coeff.a1}\na2=${slot.coeff.a2}`,
  );
  const [error, setError] = useState<string | null>(null);

  function process() {
    try {
      const values: Record<string, number> = {};
      for (const line of text.split(/[\n,]/)) {
        const m = line.match(/(b0|b1|b2|a1|a2)\s*=\s*(-?[\d.eE+-]+)/);
        if (m) values[m[1]] = Number(m[2]);
      }
      if (['b0', 'b1', 'b2', 'a1', 'a2'].some((k) => !(k in values))) {
        setError('Missing one or more coefficients (b0, b1, b2, a1, a2 required)');
        return;
      }
      setError(null);
      onApply({ b0: values.b0, b1: values.b1, b2: values.b2, a1: values.a1, a2: values.a2 });
    } catch {
      setError('Could not parse coefficients');
    }
  }

  return (
    <div className="panel" style={{ marginTop: 8 }}>
      <div className="field">
        <label>Advanced mode — biquad coefficients for slot {slot.index + 1}</label>
        <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      {error && <div style={{ color: 'var(--accent-red)', fontSize: 12 }}>{error}</div>}
      <div className="toolbar">
        <button className="small-btn primary" onClick={process}>
          Process and Apply
        </button>
      </div>
    </div>
  );
}
