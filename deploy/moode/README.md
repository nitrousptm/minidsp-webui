# Optional moOde integration

Nothing in minidsp-webui needs [moOde](https://moodeaudio.org/); these files
only matter if the 2x4 HD is fed from a moOde player over USB **and** moOde's
volume type is set to *Hardware*, so that MPD drives the 2x4 HD's USB volume
control (`miniDSP 2x4HD Playback Volume`, 0..127 = -127..0 dB). That is a
good way to make the DSP the single volume point (bit-perfect USB stream,
one level for every source) — but it has one trap.

## The trap: the USB volume resets to 0 dB on every enumeration

Verified on the real device: whenever the 2x4 HD (re)appears on the USB bus
— power cycle, cable, a USB hiccup — its USB volume control comes back at
127 (0 dB). MPD keeps reporting the old percentage and does not push it
again. The next play would run at full level, limited only by the DSP master
volume.

`minidsp-usbvol-restore.sh` + `99-minidsp-usbvol.rules` close that gap: a
udev rule fires when the miniDSP sound card is added, the script reads
moOde's knob position and mute flag from its database, converts the
percentage with the same cubic mapping MPD's ALSA mixer uses
(`raw = 127 + 60*log10(pct/100*(1-m) + m)`, `m = 10^(-127/60)`; 40 % -> 103,
44 % -> 106) and writes it with `amixer` within about a second. Each run
logs one line: `journalctl -t minidsp-usbvol`.

MPD still pauses playback when the device disappears; that is MPD's normal
behaviour and deliberately left alone.

## Install

`deploy/install.sh` installs the hook automatically when it finds a moOde
database at `/var/local/www/db/moode-sqlite3.db`. Force it on or off with
`MOODE_VOLUME_HOOK=yes|no` (default `auto`). By hand:

```bash
install -m 755 deploy/moode/minidsp-usbvol-restore.sh /usr/local/bin/
install -m 644 deploy/moode/99-minidsp-usbvol.rules /etc/udev/rules.d/
udevadm control --reload-rules
```

Two practical notes for this setup: set the volume through moOde (knob, its
rotary-encoder daemon, `/var/www/util/vol.sh N`), never with plain
`mpc volume` — moOde tracks the knob in its own database and the hook reads
that. And keep the DSP master volume in this web UI at a fixed ceiling (e.g.
-10 dB) as a second line of defence; day-to-day level then lives in the USB
control, which this UI does not show.
