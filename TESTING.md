# Testing notes and hard-won lessons

Every real bug found in production during initial development fell into one
of these categories. "Write more tests" wasn't the fix by itself — the fix
was making the *right* thing testable.

## 1. The mock must match the real device's actual behavior, not the ideal one

Two production bugs were invisible to the full test suite because
`MockMinidspClient` was more well-behaved than the real `minidspd`:

- **Crossover writes silently accepted malformed data.** The mock recorded
  whatever `postConfig()` was called with, without checking it. The real
  device rejects a crossover biquad array unless each biquad carries its own
  `index` field. Fixed by adding `validateWireConfig()` to the mock
  (`backend/src/mock/mockMinidspServer.ts`) that mirrors this real
  constraint — a regression here now fails in `npm test`, not on the real
  device three deploys later.
- **The WS poll stream was too clean.** The real `minidspd` sends mostly
  level-meter-only frames with an empty-but-present `master: {}`, and only
  includes real master fields on ~1 in 10 ticks. The mock used to send a
  fully-populated `master` on every tick, which meant the "does the UI
  survive a frame with no master data" bug was never exercised. Fixed in
  `MockMinidspClient.connect()`.

**Rule of thumb:** whenever you discover real-device behavior that differs
from what you assumed, encode that discovery *in the mock*, not just in the
fix. Otherwise the next similar bug slips through the same way.

## 2. Every mutating route needs a "device is unreachable" test

An unhandled rejection in one preset route (`pushFullConfigToDevice` called
without a `try`/`catch`) crashed the *entire* backend process on the first
real minidspd timeout — taking down every connected client's WebSocket over
one failed request. Express 4 does not catch rejected promises from async
route handlers; an uncaught one is a process-level unhandled rejection,
which crashes the process by default since Node 15.

Fixed with:
- `backend/src/asyncHandler.ts` — wraps every route handler, converts a
  thrown/rejected error into a clean error response instead of letting it
  propagate.
- `process.on('unhandledRejection', ...)` in `server.ts` as a last-resort
  net for anything outside a request (e.g. the WS relay's status listener).
- A table-driven test (`Device failures do not crash the server` in
  `routes.test.ts`) that runs *every* mutating route against an
  `AlwaysFailingClient` and asserts: clean error response, and the server is
  still responsive to the next request. When you add a new mutating route,
  add it to that table — that's the whole point of it being table-driven.

## 3. Flakiness from timing/races needs repeated runs, not one green run

Two race-condition bugs (Dashboard batched `onChange` calls clobbering each
other; the master bar being overwritten by live WS ticks mid-drag) only
showed up under realistic timing, not a single fast E2E pass. `npm run
e2e:flaky-check` (`frontend/package.json`) runs the whole suite 5x via
Playwright's `--repeat-each` before trusting a fix for anything
timing-sensitive.

## 4. Deploy the whole project, always

The `basic` field (PEQ/crossover metadata) worked perfectly in every local
test, and still silently regressed in production for an entire session,
because only `frontend/` had been synced to the Pi after a `backend/`
change — an entirely manual, easy-to-forget step.

Use `deploy/sync.sh` — it always syncs backend + frontend + deploy together.
Never hand-roll a `tar | ssh` for a subset of the project.

## 5. `minidsp-rs` 0.1.12's own instability is not something to test around

The real `minidspd` HTTP/WS server hangs completely (even on plain `GET`
requests) roughly every few hours, while the USB link to the device and the
`minidsp` CLI keep working fine throughout. This is upstream, not ours to
fix in this codebase. `deploy/minidspd-watchdog.{sh,service,timer}` health-
checks it every 2 minutes and restarts `minidsp.service` automatically
instead of requiring someone to notice.

## Running things

```bash
cd backend && npm test              # unit + integration, mock-based, fast
cd frontend && npm test             # biquad/crossover math, WS frame merging
cd frontend && npm run e2e          # full browser E2E against the mock
cd frontend && npm run e2e:flaky-check   # same, x5, for anything timing-sensitive
bash deploy/sync.sh                 # sync the whole project to the Pi
bash deploy/install.sh              # build, test, install services, smoke-test
bash deploy/smoke-test.sh <url>     # read-only check against a running instance
```
