#!/bin/bash
# Re-apply the moOde volume knob to the miniDSP 2x4HD's USB (UAC) volume
# control after the device (re)enumerates.
#
# The 2x4HD exposes a USB feature-unit volume ('miniDSP 2x4HD Playback
# Volume', 0..127 = -127..0 dB) that moOde drives via MPD's hardware mixer.
# Verified on the real device: every USB re-enumeration resets that control
# to 127 (0 dB), and MPD keeps reporting its old percentage without pushing
# it again. Without this hook a USB hiccup therefore means full level,
# limited only by the DSP master volume. Triggered by 99-minidsp-usbvol.rules; see deploy/moode/README.md.
# Only meaningful on a moOde host - install.sh skips it elsewhere.
set -u

SQLDB=/var/local/www/db/moode-sqlite3.db
CTL="name='miniDSP 2x4HD Playback Volume'"

CARD=$(aplay -l 2>/dev/null | awk -F'[: ]+' '/m2x4HD/{print $2; exit}')
[ -z "$CARD" ] && exit 0

PCT=$(sqlite3 "$SQLDB" "SELECT value FROM cfg_system WHERE param='volknob'")
MUTE=$(sqlite3 "$SQLDB" "SELECT value FROM cfg_system WHERE param='volmute'")
[ -z "$PCT" ] && PCT=0

# Same cubic mapping MPD's ALSA mixer uses (alsa-utils volume_mapping.c) for a
# -127..0 dB control: raw = 127 + 60*log10(pct/100*(1-m) + m), m = 10^(-127/60).
# Checked against MPD on the device: 40 % -> 103, 44 % -> 106.
RAW=$(awk -v p="$PCT" 'BEGIN { m = 10^(-127/60); n = p/100*(1-m) + m;
        r = 127 + 60*log(n)/log(10); if (r < 0) r = 0; printf "%d", r + 0.5 }')
[ "$MUTE" = "1" ] && RAW=0

# The mixer controls can lag the card's udev event by a moment.
for _ in 1 2 3 4 5 6; do
  if amixer -c "$CARD" cset "$CTL" "$RAW,$RAW" >/dev/null 2>&1; then
    logger -t minidsp-usbvol "miniDSP re-enumerated as card $CARD: USB volume set to $RAW/127 (moOde knob ${PCT} %, mute=${MUTE:-0})"
    exit 0
  fi
  sleep 0.5
done
logger -t minidsp-usbvol "miniDSP re-enumerated as card $CARD but setting the USB volume failed"
exit 1
