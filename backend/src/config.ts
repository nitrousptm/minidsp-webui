const useMock = process.env.MINIDSP_MOCK === '1';

export const config = {
  minidspHost: process.env.MINIDSP_HOST ?? '127.0.0.1',
  minidspPort: Number(process.env.MINIDSP_PORT ?? 5380),
  deviceIndex: Number(process.env.MINIDSP_DEVICE_INDEX ?? 0),
  webPort: Number(process.env.PORT ?? 5381),
  webHost: process.env.HOST ?? '0.0.0.0',
  presetsDir: process.env.PRESETS_DIR ?? 'data/presets',
  backupsDir: process.env.BACKUPS_DIR ?? 'data/backups',
  useMock,
  // Symbolic ALSA device name (survives card-index renumbering across
  // reboots, unlike "hw:3,0") for the hardware-in-the-loop verify feature.
  alsaDevice: process.env.MINIDSP_ALSA_DEVICE ?? 'hw:CARD=m2x4HD,DEV=0',
  // A full PEQ verify plays 12 sweeps (crossover: 4) back to back - in mock
  // mode there's no real audio or device to wait on, so default to a sweep
  // length that keeps e2e/dev runs fast instead of the multi-minute
  // production duration.
  hilSweepDurationSec: Number(process.env.HIL_SWEEP_DURATION_SEC ?? (useMock ? 0.05 : 6)),
  // Measured against the real minidspd: GET /devices/0 round-trips in ~10ms
  // typically (occasional outliers to ~400ms). 40ms leaves comfortable
  // headroom while still giving ~100-150 raw samples per 6s sweep instead of
  // the ~50 a naive 120ms interval would produce.
  hilSweepPollIntervalMs: Number(process.env.HIL_SWEEP_POLL_INTERVAL_MS ?? (useMock ? 5 : 40)),
};

export function minidspHttpBase(): string {
  return `http://${config.minidspHost}:${config.minidspPort}`;
}

export function minidspWsUrl(): string {
  return `ws://${config.minidspHost}:${config.minidspPort}/devices/${config.deviceIndex}?levels=true&poll=true`;
}
