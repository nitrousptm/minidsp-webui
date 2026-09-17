#!/bin/bash
# Installs/updates minidsp-webui (backend+frontend) on the target machine.
# Run this from the project root (e.g. after `git clone`) as root:
#   sudo bash deploy/install.sh
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

echo "==> Installing minidsp-rs (if missing)"
bash "$PROJECT_DIR/deploy/install-minidsp-rs.sh"

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
# The checked-in unit files use a placeholder path - substitute it for
# wherever this checkout actually lives, so cloning to something other than
# /root/minidsp-webui (a different user's home dir, a different repo name)
# still works instead of silently pointing systemd at the wrong directory.
sed "s#/root/minidsp-webui#$PROJECT_DIR#g" "$PROJECT_DIR/deploy/minidsp-webui.service" > /etc/systemd/system/minidsp-webui.service
systemctl daemon-reload
systemctl enable minidsp-webui.service
systemctl restart minidsp-webui.service

echo "==> Installing minidspd health watchdog (minidsp-rs 0.1.12's HTTP server hangs periodically)"
chmod +x "$PROJECT_DIR/deploy/minidspd-watchdog.sh"
sed "s#/root/minidsp-webui#$PROJECT_DIR#g" "$PROJECT_DIR/deploy/minidspd-watchdog.service" > /etc/systemd/system/minidspd-watchdog.service
cp "$PROJECT_DIR/deploy/minidspd-watchdog.timer" /etc/systemd/system/minidspd-watchdog.timer
systemctl daemon-reload
systemctl enable --now minidspd-watchdog.timer

# Optional, moOde only: re-apply moOde's volume knob to the 2x4 HD's USB volume
# control after every USB (re)enumeration - it resets to 0 dB otherwise. See
# deploy/moode/README.md. Auto-detected via moOde's database; override with
# MOODE_VOLUME_HOOK=yes|no. Nothing else in this project depends on moOde.
MOODE_VOLUME_HOOK="${MOODE_VOLUME_HOOK:-auto}"
if [ "$MOODE_VOLUME_HOOK" = "auto" ]; then
  if [ -f /var/local/www/db/moode-sqlite3.db ]; then MOODE_VOLUME_HOOK=yes; else MOODE_VOLUME_HOOK=no; fi
fi
if [ "$MOODE_VOLUME_HOOK" = "yes" ]; then
  echo "==> moOde detected: installing USB volume restore hook (deploy/moode)"
  install -m 755 "$PROJECT_DIR/deploy/moode/minidsp-usbvol-restore.sh" /usr/local/bin/minidsp-usbvol-restore.sh
  install -m 644 "$PROJECT_DIR/deploy/moode/99-minidsp-usbvol.rules" /etc/udev/rules.d/99-minidsp-usbvol.rules
  udevadm control --reload-rules
else
  echo "==> No moOde database found, skipping the moOde USB volume hook (MOODE_VOLUME_HOOK=yes to force)"
fi

echo "==> Waiting for backend to come up"
sleep 2
bash "$PROJECT_DIR/deploy/smoke-test.sh" http://127.0.0.1:5381 || {
  echo "Smoke test failed, check: journalctl -u minidsp-webui -n 50"
  exit 1
}
