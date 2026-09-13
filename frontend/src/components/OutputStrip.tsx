import type { InputChannelState, OutputChannelState } from '../types';
import { DELAY_RANGE_MS, GAIN_RANGE } from '../types';
import { LevelMeter } from './LevelMeter';

export function OutputStrip({
  output,
  index,
  inputs,
  levelDb,
  onLabelChange,
  onGainChange,
  onMuteToggle,
  onInvertToggle,
  onDelayChange,
  onRoutingToggle,
  onRoutingGainChange,
  onOpenCrossover,
  onOpenPeq,
  onOpenFir,
  onOpenCompressor,
}: {
  output: OutputChannelState;
  index: number;
  inputs: InputChannelState[];
  levelDb: number;
  onLabelChange: (label: string) => void;
  onGainChange: (gain: number) => void;
  onMuteToggle: () => void;
  onInvertToggle: () => void;
  onDelayChange: (ms: number) => void;
  onRoutingToggle: (inputIndex: number) => void;
  onRoutingGainChange: (inputIndex: number, gain: number) => void;
  onOpenCrossover: () => void;
  onOpenPeq: () => void;
  onOpenFir: () => void;
  onOpenCompressor: () => void;
}) {
  const peqActive = output.peq.some((p) => !p.bypass);
  const crossoverActive = output.crossover.some((c) => !c.bypass);
  const firActive = !output.fir.bypass && output.fir.coefficients.length > 0;
  const compressorActive = !output.compressor.bypass;
  const activeRoutes = inputs.filter((_, i) => routedFrom(inputs, i, index));

  return (
    <div className="channel-strip">
      <input
        className="channel-label"
        value={output.label}
        maxLength={12}
        onChange={(e) => onLabelChange(e.target.value)}
      />

      <div className="routing-grid" style={{ gridTemplateColumns: `repeat(${inputs.length}, 1fr)` }}>
        {inputs.map((input, i) => {
          const entry = input.routing.find((r) => r.index === index);
          const routed = !!entry && !entry.mute;
          return (
            <button
              key={i}
              className={`strip-button${routed ? ' active-green' : ''}`}
              onClick={() => onRoutingToggle(i)}
              title={`Route ${input.label} → ${output.label}`}
            >
              {input.label}
            </button>
          );
        })}
      </div>
      {activeRoutes.length > 1 && (
        <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
          {inputs.map((input, i) => {
            const entry = input.routing.find((r) => r.index === index);
            if (!entry || entry.mute) return null;
            return (
              <div key={i} className="slider-row">
                <span>{input.label}</span>
                <input
                  type="range"
                  min={GAIN_RANGE.min}
                  max={GAIN_RANGE.max}
                  step={GAIN_RANGE.step}
                  value={entry.gain}
                  onChange={(e) => onRoutingGainChange(i, Number(e.target.value))}
                />
                <span className="slider-value">{entry.gain.toFixed(1)}</span>
              </div>
            );
          })}
        </div>
      )}

      <button className={`strip-button${crossoverActive ? ' active-yellow' : ''}`} onClick={onOpenCrossover}>
        CROSSOVER
      </button>
      <button className={`strip-button${peqActive ? ' active-yellow' : ''}`} onClick={onOpenPeq}>
        PEQ
      </button>
      <button className={`strip-button${firActive ? ' active-yellow' : ''}`} onClick={onOpenFir}>
        FIR
      </button>

      <div className="slider-row">
        <span>Delay</span>
        <input
          type="range"
          min={DELAY_RANGE_MS.min}
          max={DELAY_RANGE_MS.max}
          step={DELAY_RANGE_MS.step}
          value={output.delayMs}
          onChange={(e) => onDelayChange(Number(e.target.value))}
        />
        <input
          type="number"
          className="slider-number"
          min={DELAY_RANGE_MS.min}
          max={DELAY_RANGE_MS.max}
          step={DELAY_RANGE_MS.step}
          value={output.delayMs}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (!Number.isNaN(next)) {
              onDelayChange(Math.min(DELAY_RANGE_MS.max, Math.max(DELAY_RANGE_MS.min, next)));
            }
          }}
        />
        <span className="slider-unit">ms</span>
      </div>

      <div className="slider-row">
        <span>Gain</span>
        <input
          type="range"
          min={GAIN_RANGE.min}
          max={GAIN_RANGE.max}
          step={GAIN_RANGE.step}
          value={output.gain}
          onChange={(e) => onGainChange(Number(e.target.value))}
        />
        <span className="slider-value">{output.gain.toFixed(1)}</span>
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <button className={`strip-button${output.invert ? ' active-yellow' : ''}`} style={{ flex: 1 }} onClick={onInvertToggle}>
          INVERT
        </button>
        <button className={`strip-button${output.mute ? ' active-red' : ''}`} style={{ flex: 1 }} onClick={onMuteToggle}>
          {output.mute ? 'MUTED' : 'MUTE'}
        </button>
      </div>

      <button className={`strip-button${compressorActive ? ' active-yellow' : ''}`} onClick={onOpenCompressor}>
        COMPRESSOR
      </button>

      <LevelMeter label={`Out ${index + 1}`} db={levelDb} />
    </div>
  );
}

function routedFrom(inputs: InputChannelState[], inputIndex: number, outputIndex: number): boolean {
  const entry = inputs[inputIndex].routing.find((r) => r.index === outputIndex);
  return !!entry && !entry.mute;
}
