#!/bin/bash
# minidsp-rs 0.1.12's HTTP/WS server has a recurring bug: it becomes fully
# unresponsive (even to plain GET requests) roughly every few hours of
# uptime, while the underlying USB link to the device stays fine (the
# `minidsp` CLI keeps working throughout). A restart of minidsp.service
# always recovers it in a few seconds. This checks health and restarts it
# automatically instead of requiring someone to notice and do it by hand.
set -uo pipefail

LOG_TAG="minidspd-watchdog"

if curl -sf --max-time 5 http://127.0.0.1:5380/devices/0 > /dev/null 2>&1; then
  exit 0
fi

logger -t "$LOG_TAG" "minidspd unresponsive (GET /devices/0 timed out) - restarting minidsp.service"
systemctl restart minidsp.service

sleep 3
if curl -sf --max-time 5 http://127.0.0.1:5380/devices/0 > /dev/null 2>&1; then
  logger -t "$LOG_TAG" "minidsp.service restarted successfully, device responding again"
else
  logger -t "$LOG_TAG" "minidsp.service restarted but device still not responding - needs manual attention"
fi
