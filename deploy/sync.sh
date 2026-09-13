#!/bin/bash
# Syncs the ENTIRE project (backend + frontend + deploy) to the Pi in one
# shot. Never sync backend/ and frontend/ separately by hand - that's
# exactly how a backend change (the `basic` field support) once went
# undeployed for an entire session while only the frontend kept getting
# synced, silently reintroducing a bug that looked identical to one already
# fixed. Run this before every deploy/install.sh.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PI_HOST="${PI_HOST:-root@moode.local}"
PI_PORT="${PI_PORT:-22}"
PI_DEST="${PI_DEST:-/root/minidsp-webui}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/minidsp_pi_deploy}"

echo "==> Syncing entire project to $PI_HOST:$PI_DEST"
tar czf - \
  --exclude=node_modules \
  --exclude=dist \
  --exclude=data \
  --exclude=.e2e-data \
  --exclude=test-results \
  --exclude=playwright-report \
  -C "$PROJECT_DIR" backend frontend deploy README.md \
  | ssh -i "$SSH_KEY" -p "$PI_PORT" "$PI_HOST" "mkdir -p $PI_DEST && tar xzf - -C $PI_DEST"

echo "==> Sync complete"
