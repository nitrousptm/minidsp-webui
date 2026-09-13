#!/bin/bash
# Installs minidsp-rs (the `minidspd` daemon + `minidsp` CLI) from the
# official .deb release, if it isn't already installed. minidsp-webui talks
# to the 2x4HD exclusively through minidspd's HTTP API - this is a
# prerequisite, not part of minidsp-webui itself, but it's easy to forget
# it's needed at all on a freshly-flashed Pi (see README "Prerequisites").
#
# Pinned to the version minidsp-webui has actually been debugged against
# (including the empty-coefficients-array hang worked around in
# backend/src/routes/presets.ts - see README "Known issues"). Override with
# MINIDSP_RS_VERSION=latest or a specific tag (e.g. v0.1.13) to try a newer
# release; nothing here has been validated against anything else.
set -euo pipefail

MINIDSP_RS_VERSION="${MINIDSP_RS_VERSION:-v0.1.12}"
REPO="mrene/minidsp-rs"

if command -v minidspd >/dev/null 2>&1; then
  echo "==> minidspd already installed ($(minidspd --version 2>&1 | head -1 || echo 'version unknown')), skipping"
  exit 0
fi

case "$(uname -m)" in
  aarch64) DEB_ARCH="arm64" ;;
  armv7l|armv6l) DEB_ARCH="armhf" ;;
  x86_64) DEB_ARCH="amd64" ;;
  *) echo "Unsupported architecture: $(uname -m). See https://github.com/$REPO/releases for other options." >&2; exit 1 ;;
esac

if [ "$MINIDSP_RS_VERSION" = "latest" ]; then
  RELEASE_URL="https://api.github.com/repos/$REPO/releases/latest"
else
  RELEASE_URL="https://api.github.com/repos/$REPO/releases/tags/$MINIDSP_RS_VERSION"
fi

echo "==> Looking up minidsp-rs release ($MINIDSP_RS_VERSION) for $DEB_ARCH"
DEB_URL=$(curl -sf "$RELEASE_URL" | grep -o "https://[^\"]*minidsp_[^\"]*_${DEB_ARCH}\.deb" | head -1)
if [ -z "$DEB_URL" ]; then
  echo "Could not find a ${DEB_ARCH}.deb asset for $MINIDSP_RS_VERSION. Check https://github.com/$REPO/releases and install manually." >&2
  exit 1
fi

TMP_DEB="$(mktemp --suffix=.deb)"
trap 'rm -f "$TMP_DEB"' EXIT
echo "==> Downloading $DEB_URL"
curl -sfL "$DEB_URL" -o "$TMP_DEB"

echo "==> Installing"
dpkg -i "$TMP_DEB"

echo "==> Waiting for minidspd to come up"
sleep 2
if curl -sf --max-time 5 http://127.0.0.1:5380/devices >/dev/null; then
  echo "OK: minidspd is running and reachable on 127.0.0.1:5380"
  curl -s http://127.0.0.1:5380/devices
else
  echo "minidspd was installed but isn't responding yet on 127.0.0.1:5380."
  echo "Check: systemctl status minidsp ; journalctl -u minidsp -n 50"
  echo "If no device is listed, confirm the 2x4HD is connected via USB: lsusb | grep -i 2752"
fi
