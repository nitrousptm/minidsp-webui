# minidsp-webui

A self-hosted web console for the [miniDSP 2x4 HD](https://www.minidsp.com/products/minidsp-in-a-box/minidsp-2x4-hd), built to replace the official desktop app ("miniDSP Console") for day-to-day tweaking from any browser — phone, laptop, whatever's nearby. It closely follows the layout of the official console (channel strips, routing matrix, PEQ with a live frequency-response chart, crossover, compressor, FIR, delay/phase, presets) and talks to the device through [minidsp-rs](https://github.com/mrene/minidsp-rs) (`minidspd`).

Built for running alongside [moOde Audio](https://moodeaudio.org/) on a Raspberry Pi with the 2x4 HD connected over USB, but nothing here is moOde-specific — any Linux box that can host the USB device and run Node.js works.

## Features

- Input/output channel strips: gain, mute, invert, delay, level meters
- Routing matrix (which input feeds which output, with per-connection gain)
- Parametric EQ: 10 slots per channel, PEAK/LOW_SHELF/HIGH_SHELF/ALL_PASS, a draggable frequency-response chart, and an import tool for Room EQ Wizard exports ("Export Filter Settings as text" or biquad-coefficient exports)
- Crossover: Butterworth (6–48 dB/oct), Linkwitz-Riley (12/24/48 dB/oct), Bessel (12 dB/oct), with per-output overlay charts
- Compressor and FIR (file or manual-entry coefficient) editors
- 4 on-device presets plus unlimited named JSON backups, with export/import
- **Hardware-in-the-loop verification**: plays a real logarithmic sine sweep through the DSP and measures the actual output level to confirm a filter is doing what it's configured to do — see [Hardware-in-the-loop verification](#hardware-in-the-loop-verification) below. This is the only way to check the device's real behavior, because of the read-back limitation described next.

## Architecture

```
minidsp-webui/
  backend/    Node.js + TypeScript + Express - the device's source of truth
  frontend/   React + TypeScript + Vite - the console UI
  deploy/     systemd units, install/sync/smoke-test scripts
```

**The 2x4 HD (and therefore minidsp-rs) can only *write* PEQ/crossover/
compressor/FIR/routing settings — it cannot be read back.** This isn't a
limitation of minidsp-rs; it's the device's own protocol. Only the active
preset number, source, volume/mute, and the live level meters can be read
from the device.

Because of that, the backend is the sole source of truth for the full DSP
configuration. It keeps its own copy on disk (`backend/data/presets/preset-<0-3>.json`), and every change made through the UI is written to that
file *and* sent to `minidspd` as the same operation. If something else
writes to the device directly (the official app, the `minidsp` CLI, a
different tool) the backend has no way to notice — see
[Known issues](#known-issues) below.

## Prerequisites

- A Raspberry Pi (or similar Linux box) with the 2x4 HD connected via USB
- [minidsp-rs](https://github.com/mrene/minidsp-rs) (`minidspd` + `minidsp` CLI) — `deploy/install-minidsp-rs.sh` installs this for you (see [Quick start](#quick-start))
- Node.js 20+ and npm — `deploy/install.sh` installs this via `apt` if missing

## Quick start

On the target machine (as root, or with `sudo`):

```bash
git clone https://github.com/nitrousptm/minidsp-webui.git
cd minidsp-webui
sudo bash deploy/install.sh
```

This will:

1. Install `minidsp-rs` if it isn't already present (`deploy/install-minidsp-rs.sh`)
2. Install Node.js/npm if missing
3. `npm install`, `npm test`, and `npm run build` for both `backend/` and `frontend/`
4. Install and enable the `minidsp-webui` systemd service
5. Install and enable `minidspd-watchdog` (see [Known issues](#known-issues) — minidsp-rs occasionally needs a kick)
6. Run a read-only smoke test against the running service

The console is then served at `http://<host>:5381` — the backend serves
both the API and the built frontend from a single port.

Check status / logs:

```bash
systemctl status minidsp-webui
journalctl -u minidsp-webui -f
```

### Developing on a separate machine

If you're editing the code on a workstation and deploying to a Pi over
SSH rather than cloning directly onto the Pi, `deploy/sync.sh` rsyncs the
whole project over (never partially — see the comment in the script for
why that matters) and `deploy/install.sh` then builds and restarts it:

```bash
PI_HOST=user@raspberrypi.local bash deploy/sync.sh
ssh user@raspberrypi.local 'cd minidsp-webui && sudo bash deploy/install.sh'
```

`PI_HOST`, `PI_PORT`, `PI_DEST`, and `SSH_KEY` are all overridable env vars
(see the top of `deploy/sync.sh` for defaults).

## Configuration

All via environment variables, set in `deploy/minidsp-webui.service` or your own process manager:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `5381` | Port the web UI/API listens on |
| `HOST` | `0.0.0.0` | Bind address |
| `MINIDSP_HOST` | `127.0.0.1` | Where `minidspd`'s HTTP API is |
| `MINIDSP_PORT` | `5380` | `minidspd`'s HTTP port |
| `MINIDSP_DEVICE_INDEX` | `0` | Which device, if minidspd sees more than one |
| `PRESETS_DIR` | `data/presets` | Where the 4 preset JSON files live |
| `BACKUPS_DIR` | `data/backups` | Where named backups live |
| `MINIDSP_MOCK` | unset | Set to `1` to run against an in-memory mock instead of a real device (local development, tests) |
| `MINIDSP_ALSA_DEVICE` | `hw:CARD=m2x4HD,DEV=0` | ALSA device used for hardware-in-the-loop sweeps |
| `HIL_SWEEP_DURATION_SEC` | `6` (prod) / `0.05` (mock) | Length of one hardware-in-the-loop sweep |
| `HIL_SWEEP_POLL_INTERVAL_MS` | `40` (prod) / `5` (mock) | How often the level meter is sampled during a sweep |

## Local development (no hardware needed)

Backend against an in-memory mock of minidspd:

```bash
cd backend && MINIDSP_MOCK=1 npm run dev
```

Frontend with hot reload (proxies `/api` and `/ws` to `localhost:5381`):

```bash
cd frontend && npm run dev
```

## Testing

```bash
cd backend && npm test              # unit + integration tests (Supertest against the mock)
cd frontend && npm test             # biquad/crossover math, WS frame merging
cd frontend && npm run e2e          # Playwright E2E against the mock backend
cd frontend && npm run e2e:flaky-check   # same, x5 repeats, for timing-sensitive changes
```

`deploy/smoke-test.sh <url>` is a read-only post-deployment check (device
detected, master status readable) — it never writes to the device.

See [TESTING.md](TESTING.md) for lessons learned about *why* the test setup
looks the way it does (mock fidelity, error-handling coverage, flakiness,
deploy discipline).

## Hardware-in-the-loop verification

Because the device can't be read back, there was previously no way to
confirm that a configured filter was actually being applied correctly by
the DSP chip — only that the *software* believed it had sent the right
values. The verify feature closes that gap: it plays a continuous
logarithmic sine sweep (20 Hz–20 kHz) through the DSP via the system's ALSA
device, reads the device's own post-filter level meter throughout the
sweep, and compares the measured response against the mathematically
predicted one.

- **PEQ verify** tests each of the 10 slots individually (all others
  held bypassed) plus the combined effect of all 10 as actually configured.
- **Crossover verify** tests the high-pass and low-pass groups individually
  plus their combined effect.

Both are available as a "Verify against hardware" button in the respective
editor. A full PEQ verify takes roughly 1–2 minutes (12 sweeps back to
back); crossover verify takes 30–40 seconds (4 sweeps). The original
configuration is always restored afterward, whether the sweep succeeds or
is interrupted.

## Known issues

- **No authentication** (matching minidsp-rs itself) — only run this on a
  trusted LAN.
- **The backend can't detect out-of-band changes.** If you use the official
  miniDSP Console, the mobile app, or the `minidsp` CLI directly, the
  backend's stored state silently goes stale, and the *next* change made
  through this UI will push that stale state back to the device, overwriting
  whatever you just set elsewhere. Don't mix control surfaces without
  reconciling state in between.
- **minidsp-rs 0.1.12's HTTP/WS server occasionally hangs completely** (even
  on plain `GET` requests), independently of the USB link to the device,
  which keeps working. `deploy/minidspd-watchdog.{sh,service,timer}` health-
  checks it every 2 minutes and restarts `minidsp.service` automatically.
- **A crossover group or FIR filter with an empty coefficients array
  (`{bypass: true, coefficients: []}` — the untouched default) reliably
  wedges minidspd** until it's restarted, confirmed by isolating every
  individual request in a full preset push. `pushFullConfigToDevice`
  (`backend/src/routes/presets.ts`) skips these writes entirely, since a
  bypassed filter with nothing configured has nothing worth writing anyway.
- Dirac Live purchase/activation isn't implemented — the official software
  triggers a Stripe payment for that, which is out of scope here.
- FIR file import expects raw IEEE-754 float32 binary data; exceeding the
  device's tap budget (4096 total / 2048 per channel) is reported as
  whatever error minidspd itself returns for that.

## License

[MIT](LICENSE)
