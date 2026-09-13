import { useEffect, useRef } from 'react';
import type { Compressor } from '../../types';

function CompressorCurve({ compressor }: { compressor: Compressor }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const width = 300;
  const height = 220;
  const pad = 24;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#14151a';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#2c2e35';
    ctx.strokeRect(pad, pad, width - pad * 2, height - pad * 2);

    const toX = (dbIn: number) => pad + ((dbIn + 60) / 60) * (width - pad * 2);
    const toY = (dbOut: number) => height - pad - ((dbOut + 60) / 60) * (height - pad * 2);

    // unity reference line
    ctx.beginPath();
    ctx.strokeStyle = '#3a3d46';
    ctx.setLineDash([4, 4]);
    ctx.moveTo(toX(-60), toY(-60));
    ctx.lineTo(toX(0), toY(0));
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.strokeStyle = compressor.bypass ? '#6b6f76' : '#4a9eff';
    ctx.lineWidth = 2;
    for (let dbIn = -60; dbIn <= 0; dbIn += 1) {
      const dbOut = compressor.bypass
        ? dbIn
        : dbIn <= compressor.threshold
          ? dbIn
          : compressor.threshold + (dbIn - compressor.threshold) / compressor.ratio;
      const x = toX(dbIn);
      const y = toY(dbOut);
      if (dbIn === -60) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }, [compressor]);

  return (
    <div className="chart-wrap">
      <canvas ref={ref} />
    </div>
  );
}

export function CompressorEditor({
  compressor,
  onChange,
}: {
  compressor: Compressor;
  onChange: (patch: Partial<Compressor>) => void;
}) {
  return (
    <div className="strip-row">
      <CompressorCurve compressor={compressor} />
      <div className="panel" style={{ flex: 1, minWidth: 260 }}>
        <label style={{ fontSize: 12 }}>
          <input type="checkbox" checked={!compressor.bypass} onChange={(e) => onChange({ bypass: !e.target.checked })} />{' '}
          Enable Compressor
        </label>
        <div className="field-grid" style={{ marginTop: 10 }}>
          <div className="field">
            <label>Threshold (dBFS)</label>
            <input
              type="number"
              step={0.5}
              min={-60}
              max={0}
              value={compressor.threshold}
              onChange={(e) => onChange({ threshold: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label>Ratio</label>
            <input
              type="number"
              step={0.1}
              min={1}
              max={20}
              value={compressor.ratio}
              onChange={(e) => onChange({ ratio: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label>Attack (ms)</label>
            <input
              type="number"
              step={0.1}
              min={0}
              max={500}
              value={compressor.attack}
              onChange={(e) => onChange({ attack: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label>Release (ms)</label>
            <input
              type="number"
              step={1}
              min={0}
              max={2000}
              value={compressor.release}
              onChange={(e) => onChange({ release: Number(e.target.value) })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
