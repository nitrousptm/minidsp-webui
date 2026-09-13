import { useState } from 'react';
import type { OutputChannelState } from '../../types';
import { MAX_FIR_TAPS_PER_CHANNEL, MAX_FIR_TAPS_TOTAL, MIN_FIR_TAPS_PER_CHANNEL } from '../../types';

export function FirEditor({
  outputs,
  outputIndex,
  onChange,
}: {
  outputs: OutputChannelState[];
  outputIndex: number;
  onChange: (patch: { bypass?: boolean; coefficients?: number[] }) => void;
}) {
  const fir = outputs[outputIndex].fir;
  const [manualText, setManualText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const totalTapsUsed = outputs.reduce((sum, o) => sum + (o.fir.bypass ? 0 : o.fir.coefficients.length), 0);
  const thisChannelTaps = fir.bypass ? 0 : fir.coefficients.length;
  const tapsAvailable = MAX_FIR_TAPS_TOTAL - (totalTapsUsed - thisChannelTaps);

  function applyCoefficients(coefficients: number[]) {
    if (coefficients.length > 0 && coefficients.length < MIN_FIR_TAPS_PER_CHANNEL) {
      setError(`At least ${MIN_FIR_TAPS_PER_CHANNEL} taps are required`);
      return;
    }
    if (coefficients.length > MAX_FIR_TAPS_PER_CHANNEL) {
      setError(`No more than ${MAX_FIR_TAPS_PER_CHANNEL} taps are allowed per channel`);
      return;
    }
    if (coefficients.length > tapsAvailable) {
      setError(`Only ${tapsAvailable} taps are available across all 4 outputs (${MAX_FIR_TAPS_TOTAL} total)`);
      return;
    }
    setError(null);
    onChange({ coefficients, bypass: false });
  }

  function processManualText() {
    const values: number[] = [];
    for (const line of manualText.split(/[\n,]/)) {
      const m = line.match(/b\d+\s*=\s*(-?[\d.eE+-]+)/);
      if (m) values.push(Number(m[1]));
    }
    if (values.length === 0) {
      setError('No coefficients found (expected lines like "b0 = 1")');
      return;
    }
    applyCoefficients(values);
  }

  async function handleFile(file: File) {
    const buffer = await file.arrayBuffer();
    const floats = new Float32Array(buffer);
    applyCoefficients(Array.from(floats));
  }

  return (
    <div>
      <div className="toolbar" style={{ justifyContent: 'space-between' }}>
        <label style={{ fontSize: 12 }}>
          <input type="checkbox" checked={!fir.bypass} onChange={(e) => onChange({ bypass: !e.target.checked })} /> Enable FIR
        </label>
        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          This channel: {thisChannelTaps} taps &nbsp;|&nbsp; Available: {tapsAvailable} / {MAX_FIR_TAPS_TOTAL} total
        </span>
      </div>

      {error && <div style={{ color: 'var(--accent-red)', fontSize: 12, marginBottom: 8 }}>{error}</div>}

      <div className="strip-row">
        <div className="panel" style={{ flex: 1, minWidth: 260 }}>
          <strong style={{ fontSize: 13 }}>File Mode</strong>
          <p style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            Upload a coefficient file in IEEE-754 single-precision binary float32 format (as exported by rePhase, REW, etc.).
          </p>
          <input
            type="file"
            accept=".bin,.dat,.raw"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
        </div>
        <div className="panel" style={{ flex: 1, minWidth: 260 }}>
          <strong style={{ fontSize: 13 }}>Manual Mode</strong>
          <p style={{ fontSize: 11, color: 'var(--text-dim)' }}>Paste plain-text coefficients, one per line: "b0 = 1".</p>
          <textarea rows={5} value={manualText} onChange={(e) => setManualText(e.target.value)} style={{ width: '100%' }} />
          <div className="toolbar">
            <button className="small-btn primary" onClick={processManualText}>
              Process and Apply
            </button>
            <button className="small-btn" onClick={() => onChange({ coefficients: [], bypass: true })}>
              Clear Taps
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
