import { LEVEL_METER_RANGE } from '../types';

export function LevelMeter({ label, db }: { label: string; db: number }) {
  const pct = Math.max(
    0,
    Math.min(100, ((db - LEVEL_METER_RANGE.min) / (LEVEL_METER_RANGE.max - LEVEL_METER_RANGE.min)) * 100),
  );
  return (
    <div className="slider-row" title={`${label}: ${db.toFixed(1)} dB`}>
      <span style={{ minWidth: 16 }}>{label}</span>
      <div className="level-meter">
        <div className="level-meter-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="slider-value">{db.toFixed(1)}</span>
    </div>
  );
}
