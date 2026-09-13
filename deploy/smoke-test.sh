#!/bin/bash
# Read-only post-deployment check: verifies the webui backend is up and can
# see the real minidsp-rs daemon and the 2x4HD device. Never writes settings.
set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:5381}"

echo "==> Checking $BASE_URL/api/device"
device_json=$(curl -sf "$BASE_URL/api/device")
echo "$device_json"
echo "$device_json" | grep -q '"2x4HD"' || { echo "FAIL: 2x4HD not reported"; exit 1; }

echo "==> Checking $BASE_URL/api/master"
master_json=$(curl -sf "$BASE_URL/api/master")
echo "$master_json"
echo "$master_json" | grep -q '"master"' || { echo "FAIL: no master status"; exit 1; }

echo "==> Checking $BASE_URL/api/state"
curl -sf "$BASE_URL/api/state" > /dev/null || { echo "FAIL: /api/state unreachable"; exit 1; }

echo "OK: minidsp-webui backend is reachable and the 2x4HD is connected."
