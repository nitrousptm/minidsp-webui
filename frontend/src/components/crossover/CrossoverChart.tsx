import { useEffect, useRef, useState } from 'react';
import type { Biquad } from '../../types';
import { useContainerWidth } from '../../lib/useContainerWidth';
import { combinedMagnitudeDb } from '../../lib/biquad';

const FREQ_MIN = 20;
const FREQ_MAX = 20000;
const GAIN_MIN = -60;
const GAIN_MAX = 6;
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

const OCTAVE_TICKS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];

export interface ChannelCurve {
  outputIndex: number;
  color: string;
  hpBiquads: Biquad[];
  lpBiquads: Biquad[];
  visible: boolean;
}

export type CrossoverHandleKind = 'highpass' | 'lowpass';

export interface CrossoverHandle {
  kind: CrossoverHandleKind;
  freq: number;
  biquads: Biquad[]; // used to place the handle exactly on its own curve
  enabled: boolean;
}

export interface MeasuredCurve {
  frequencies: number[];
  measuredDeltaDb: number[];
  color: string;
  width?: number;
  showDots?: boolean;
}

export function CrossoverChart({
  curves,
  handles,
  sampleRate,
  width: maxWidth = 860,
  height = 280,
  onDragHandle,
  measuredCurves,
}: {
  curves: ChannelCurve[];
  handles?: CrossoverHandle[];
  sampleRate: number;
  width?: number;
  height?: number;
  onDragHandle?: (kind: CrossoverHandleKind, freq: number) => void;
  measuredCurves?: MeasuredCurve[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Never wider than the box it sits in (phones), never wider than maxWidth (desktops).
  const [wrapRef, wrapWidth] = useContainerWidth<HTMLDivElement>();
  const width = wrapWidth ? Math.min(maxWidth, wrapWidth) : maxWidth;
  const [dragKind, setDragKind] = useState<CrossoverHandleKind | null>(null);
  const [hoverFreq, setHoverFreq] = useState<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
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
    ctx.fillStyle = '#7a7d86';
    ctx.font = '10px sans-serif';
    for (const f of OCTAVE_TICKS) {
      const x = freqToX(f, width);
      ctx.beginPath();
      ctx.moveTo(x, PAD.top);
      ctx.lineTo(x, height - PAD.bottom);
      ctx.stroke();
      ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x - 8, height - 6);
    }
    for (const g of [-48, -36, -24, -12, -6, -3, 0]) {
      const y = gainToY(g, height);
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(width - PAD.right, y);
      ctx.strokeStyle = g === 0 ? '#4a4d57' : '#2c2e35';
      ctx.stroke();
      ctx.fillStyle = '#7a7d86';
      ctx.fillText(`${g}`, 4, y + 3);
    }

    for (const curve of curves) {
      if (!curve.visible) continue;
      const combined = [...curve.hpBiquads, ...curve.lpBiquads];
      ctx.beginPath();
      ctx.strokeStyle = curve.color;
      ctx.lineWidth = curve.color === '#ff8c42' ? 2.5 : 1.5;
      for (let x = PAD.left; x <= width - PAD.right; x++) {
        const freq = xToFreq(x, width);
        const db = combined.length ? combinedMagnitudeDb(combined, freq, sampleRate) : 0;
        const y = gainToY(Math.max(GAIN_MIN, Math.min(GAIN_MAX, db)), height);
        if (x === PAD.left) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

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

    for (const h of handles ?? []) {
      const x = freqToX(h.freq, width);
      const db = h.biquads.length ? combinedMagnitudeDb(h.biquads, h.freq, sampleRate) : 0;
      const y = gainToY(Math.max(GAIN_MIN, Math.min(GAIN_MAX, db)), height);
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = h.enabled ? '#e8c547' : '#5b5e66';
      ctx.fill();
      ctx.strokeStyle = '#14151a';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#e8e9ec';
      ctx.font = '9px sans-serif';
      ctx.fillText(h.kind === 'highpass' ? 'HP' : 'LP', x - 8, y - 9);
    }

    if (hoverFreq !== null) {
      const x = freqToX(hoverFreq, width);
      ctx.strokeStyle = '#ff8c42';
      ctx.beginPath();
      ctx.moveTo(x, PAD.top);
      ctx.lineTo(x, height - PAD.bottom);
      ctx.stroke();
      ctx.fillStyle = '#ff8c42';
      ctx.fillText(`${hoverFreq.toFixed(0)} Hz`, x + 6, PAD.top + 10);
    }
  }, [curves, handles, sampleRate, width, height, hoverFreq, measuredCurves]);

  function findHandleAt(x: number, y: number): CrossoverHandleKind | null {
    for (const h of handles ?? []) {
      const px = freqToX(h.freq, width);
      const db = h.biquads.length ? combinedMagnitudeDb(h.biquads, h.freq, sampleRate) : 0;
      const py = gainToY(Math.max(GAIN_MIN, Math.min(GAIN_MAX, db)), height);
      if (Math.hypot(px - x, py - y) <= 8) return h.kind;
    }
    return null;
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!onDragHandle) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const kind = findHandleAt(x, y);
    if (kind !== null) {
      setDragKind(kind);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const freq = xToFreq(x, width);
    setHoverFreq(freq);
    if (dragKind !== null && onDragHandle) {
      onDragHandle(dragKind, Math.round(freq));
    }
  }

  function handlePointerUp() {
    setDragKind(null);
  }

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => setHoverFreq(null)}
        // touch-action none: a finger on a handle drags the handle, not the page
        style={{ display: 'block', touchAction: 'none', cursor: onDragHandle ? (dragKind !== null ? 'grabbing' : 'crosshair') : 'default' }}
      />
    </div>
  );
}
