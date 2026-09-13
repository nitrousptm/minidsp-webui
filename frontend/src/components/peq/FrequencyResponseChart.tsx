import { useEffect, useRef, useState } from 'react';
import type { Biquad, PeqFilterType } from '../../types';
import { biquadMagnitudeDb, combinedMagnitudeDb } from '../../lib/biquad';

export interface ChartPoint {
  index: number;
  freq: number;
  gainDb: number;
  type: PeqFilterType;
  bypass: boolean;
  coeff: Biquad;
}

const FREQ_MIN = 20;
const FREQ_MAX = 20000;
const GAIN_MIN = -20;
const GAIN_MAX = 20;
const PAD = { left: 34, right: 12, top: 10, bottom: 20 };

function freqToX(freq: number, width: number): number {
  const t = (Math.log10(freq) - Math.log10(FREQ_MIN)) / (Math.log10(FREQ_MAX) - Math.log10(FREQ_MIN));
  return PAD.left + t * (width - PAD.left - PAD.right);
}

function xToFreq(x: number, width: number): number {
  const t = (x - PAD.left) / (width - PAD.left - PAD.right);
  const clamped = Math.max(0, Math.min(1, t));
  return Math.pow(10, Math.log10(FREQ_MIN) + clamped * (Math.log10(FREQ_MAX) - Math.log10(FREQ_MIN)));
}

function gainToY(gain: number, height: number): number {
  const t = (gain - GAIN_MIN) / (GAIN_MAX - GAIN_MIN);
  return height - PAD.bottom - t * (height - PAD.top - PAD.bottom);
}

function yToGain(y: number, height: number): number {
  const t = (height - PAD.bottom - y) / (height - PAD.top - PAD.bottom);
  const clamped = Math.max(0, Math.min(1, t));
  return GAIN_MIN + clamped * (GAIN_MAX - GAIN_MIN);
}

const OCTAVE_TICKS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
const GAIN_TICKS = [-15, -10, -5, 0, 5, 10, 15];

export interface MeasuredCurve {
  frequencies: number[];
  measuredDeltaDb: number[];
  color: string;
  width?: number;
  showDots?: boolean;
}

export function FrequencyResponseChart({
  points,
  sampleRate,
  width = 860,
  height = 320,
  onDragPoint,
  measuredCurves,
}: {
  points: ChartPoint[];
  sampleRate: number;
  width?: number;
  height?: number;
  onDragPoint?: (index: number, patch: { freq?: number; gainDb?: number }) => void;
  measuredCurves?: MeasuredCurve[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [hover, setHover] = useState<{ freq: number; db: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#14151a';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#2c2e35';
    ctx.fillStyle = '#7a7d86';
    ctx.font = '10px sans-serif';
    ctx.lineWidth = 1;
    for (const f of OCTAVE_TICKS) {
      const x = freqToX(f, width);
      ctx.beginPath();
      ctx.moveTo(x, PAD.top);
      ctx.lineTo(x, height - PAD.bottom);
      ctx.stroke();
      const label = f >= 1000 ? `${f / 1000}k` : `${f}`;
      ctx.fillText(label, x - 8, height - 6);
    }
    for (const g of GAIN_TICKS) {
      const y = gainToY(g, height);
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(width - PAD.right, y);
      ctx.strokeStyle = g === 0 ? '#4a4d57' : '#2c2e35';
      ctx.stroke();
      ctx.fillStyle = '#7a7d86';
      ctx.fillText(`${g}`, 4, y + 3);
    }

    // individual (light) curves for active filters
    const activeCoeffs = points.filter((p) => !p.bypass).map((p) => p.coeff);
    for (const p of points) {
      if (p.bypass) continue;
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(74, 158, 255, 0.35)';
      ctx.lineWidth = 1;
      for (let x = PAD.left; x <= width - PAD.right; x++) {
        const freq = xToFreq(x, width);
        const db = biquadMagnitudeDb(p.coeff, freq, sampleRate);
        const y = gainToY(Math.max(GAIN_MIN, Math.min(GAIN_MAX, db)), height);
        if (x === PAD.left) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // combined (bold) curve
    ctx.beginPath();
    ctx.strokeStyle = '#4a9eff';
    ctx.lineWidth = 2.5;
    for (let x = PAD.left; x <= width - PAD.right; x++) {
      const freq = xToFreq(x, width);
      const db = combinedMagnitudeDb(activeCoeffs, freq, sampleRate);
      const y = gainToY(Math.max(GAIN_MIN, Math.min(GAIN_MAX, db)), height);
      if (x === PAD.left) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // measured (hardware-verified) curves, overlaid on top of the predicted one
    for (const curve of measuredCurves ?? []) {
      if (curve.frequencies.length === 0) continue;
      ctx.beginPath();
      ctx.strokeStyle = curve.color;
      ctx.lineWidth = curve.width ?? 2;
      curve.frequencies.forEach((freq, i) => {
        const x = freqToX(freq, width);
        const y = gainToY(Math.max(GAIN_MIN, Math.min(GAIN_MAX, curve.measuredDeltaDb[i])), height);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      if (curve.showDots) {
        ctx.fillStyle = curve.color;
        curve.frequencies.forEach((freq, i) => {
          const x = freqToX(freq, width);
          const y = gainToY(Math.max(GAIN_MIN, Math.min(GAIN_MAX, curve.measuredDeltaDb[i])), height);
          ctx.beginPath();
          ctx.arc(x, y, 2, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    }

    // draggable handles
    for (const p of points) {
      const x = freqToX(p.freq, width);
      const y = gainToY(p.type === 'ALL_PASS' ? 0 : p.gainDb, height);
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = p.bypass ? '#5b5e66' : '#e8c547';
      ctx.fill();
      ctx.strokeStyle = '#14151a';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#e8e9ec';
      ctx.font = '9px sans-serif';
      ctx.fillText(`${p.index + 1}`, x - 3, y - 9);
    }

    if (hover) {
      ctx.strokeStyle = '#ff8c42';
      ctx.beginPath();
      ctx.moveTo(hover.x, PAD.top);
      ctx.lineTo(hover.x, height - PAD.bottom);
      ctx.stroke();
      ctx.fillStyle = '#ff8c42';
      ctx.fillText(`${hover.freq.toFixed(0)} Hz, ${hover.db.toFixed(1)} dB`, hover.x + 6, PAD.top + 10);
    }
  }, [points, sampleRate, width, height, hover, measuredCurves]);

  function findHandleAt(x: number, y: number): number | null {
    for (const p of points) {
      const px = freqToX(p.freq, width);
      const py = gainToY(p.type === 'ALL_PASS' ? 0 : p.gainDb, height);
      if (Math.hypot(px - x, py - y) <= 8) return p.index;
    }
    return null;
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const idx = findHandleAt(x, y);
    if (idx !== null) {
      setDragIndex(idx);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const freq = xToFreq(x, width);
    const db = yToGain(y, height);
    setHover({ freq, db, x, y });

    if (dragIndex !== null && onDragPoint) {
      const point = points.find((p) => p.index === dragIndex);
      if (point) {
        const patch: { freq?: number; gainDb?: number } = { freq: Math.round(freq) };
        if (point.type !== 'ALL_PASS') patch.gainDb = Math.round(db * 10) / 10;
        onDragPoint(dragIndex, patch);
      }
    }
  }

  function handlePointerUp() {
    setDragIndex(null);
  }

  return (
    <div className="chart-wrap">
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => setHover(null)}
        style={{ display: 'block', cursor: dragIndex !== null ? 'grabbing' : 'crosshair' }}
      />
    </div>
  );
}
