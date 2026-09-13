#!/bin/bash
# Installs/updates the minidsp-webui backend+frontend on the Raspberry Pi.
# Run this from the project root on the Pi (e.g. /root/minidsp-webui) as root.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

echo "==> Installing Node.js/npm (if missing)"
if ! command -v node >/dev/null 2>&1; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs npm
fi
node --version
npm --version

echo "==> Building backend"
cd "$PROJECT_DIR/backend"
npm install
npm test
npm run build

echo "==> Building frontend"
cd "$PROJECT_DIR/frontend"
npm install
npm test
npm run build

echo "==> Installing systemd service"
cp "$PROJECT_DIR/deploy/minidsp-webui.service" /etc/systemd/system/minidsp-webui.service
systemctl daemon-reload
systemctl enable minidsp-webui.service
systemctl restart minidsp-webui.service

echo "==> Installing minidspd health watchdog (minidsp-rs 0.1.12's HTTP server hangs periodically)"
chmod +x "$PROJECT_DIR/deploy/minidspd-watchdog.sh"
cp "$PROJECT_DIR/deploy/minidspd-watchdog.service" /etc/systemd/system/minidspd-watchdog.service
cp "$PROJECT_DIR/deploy/minidspd-watchdog.timer" /etc/systemd/system/minidspd-watchdog.timer
systemctl daemon-reload
systemctl enable --now minidspd-watchdog.timer

echo "==> Waiting for backend to come up"
sleep 2
bash "$PROJECT_DIR/deploy/smoke-test.sh" http://127.0.0.1:5381 || {
  echo "Smoke test failed, check: journalctl -u minidsp-webui -n 50"
  exit 1
}
