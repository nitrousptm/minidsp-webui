import type { InputChannelState } from '../types';
import { GAIN_RANGE } from '../types';
import { LevelMeter } from './LevelMeter';

export function InputStrip({
  input,
  index,
  levelDb,
  onLabelChange,
  onGainChange,
  onMuteToggle,
  onOpenPeq,
}: {
  input: InputChannelState;
  index: number;
  levelDb: number;
  onLabelChange: (label: string) => void;
  onGainChange: (gain: number) => void;
  onMuteToggle: () => void;
  onOpenPeq: () => void;
}) {
  const peqActive = input.peq.some((p) => !p.bypass);

  return (
    <div className="channel-strip">
      <input
        className="channel-label"
        value={input.label}
        maxLength={12}
        onChange={(e) => onLabelChange(e.target.value)}
      />
      <LevelMeter label={`In ${index + 1}`} db={levelDb} />
      <div className="slider-row">
        <span>Gain</span>
        <input
          type="range"
          min={GAIN_RANGE.min}
          max={GAIN_RANGE.max}
          step={GAIN_RANGE.step}
          value={input.gain}
          onChange={(e) => onGainChange(Number(e.target.value))}
        />
        <span className="slider-value">{input.gain.toFixed(1)}</span>
      </div>
      <button className={`strip-button${peqActive ? ' active-yellow' : ''}`} onClick={onOpenPeq}>
        PEQ
      </button>
      <button className={`strip-button${input.mute ? ' active-red' : ''}`} onClick={onMuteToggle}>
        {input.mute ? 'MUTED' : 'MUTE'}
      </button>
    </div>
  );
}
