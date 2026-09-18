# Optional moOde integration

Nothing in minidsp-webui needs [moOde](https://moodeaudio.org/). This
directory collects what makes a moOde-based streamer with the 2x4 HD on
USB a complete, self-contained player — a volume knob, an IR remote, and
one safety hook — without any of it becoming a dependency of the web UI.
`deploy/install.sh` installs only the hook, and only when it finds moOde's
database; the hardware parts are manual and documented step by step.

| Topic | What it gives you | Doc |
|---|---|---|
| Volume in the DSP, safely | moOde's volume knob drives the 2x4 HD's USB volume; a udev hook keeps it from resetting to 0 dB | this file |
| Rotary encoder | a physical volume knob with push button next to the display, and a fix for moOde's encoder decoding bug | [rotary-encoder.md](rotary-encoder.md) |
| IR remote | volume, mute, transport and preset keys through a 38 kHz receiver on a GPIO — kernel decoding, no LIRC | [ir-remote.md](ir-remote.md) |

## Volume: moOde → the 2x4 HD's USB volume

The 2x4 HD's USB audio interface exposes a UAC volume control
(`miniDSP 2x4HD Playback Volume`, 0..127 = -127..0 dB). With moOde's
volume type set to *Hardware* (Audio → MPD Config), MPD drives that
control instead of attenuating the samples itself: the USB stream stays
bit-perfect, every source moOde plays lands on the same level, and the
knob, the phone and the encoder all move the same thing. MPD maps its
0..100 % onto the control with the cubic curve from alsamixer (40 % →
−23 dB, 50 % → −18 dB, 80 % → −6 dB), which feels right.

That USB stage sits *in front of* the DSP master volume and adds to it.
The web UI shows it read-only in the master bar ("USB −21 dB · total
−31 dB") whenever the backend host has the 2x4 HD as an ALSA card, so the
master slider is never mistaken for the whole picture. Keep the DSP master
at a fixed ceiling (e.g. −10 dB); day-to-day level lives in the USB stage.

Always set volume through moOde — its knob, its UI, `/var/www/util/vol.sh N`
— never with plain `mpc volume`. moOde tracks the knob in its own database
(`cfg_system.volknob`) and its encoder daemon reads it from there.

### The trap: the USB volume resets to 0 dB on every enumeration

Verified on the real device: whenever the 2x4 HD (re)appears on the USB
bus — power cycle, cable, a USB hiccup — its USB volume control comes back
at 127 (0 dB). MPD keeps reporting the old percentage and does not push it
again. The next play would run at full level, limited only by the DSP
master ceiling.

`minidsp-usbvol-restore.sh` + `99-minidsp-usbvol.rules` close that gap: a
udev rule fires when the miniDSP sound card is added, the script reads
moOde's knob position and mute flag from its database, converts the
percentage with the same cubic mapping MPD's ALSA mixer uses
(`raw = 127 + 60*log10(pct/100*(1-m) + m)`, `m = 10^(-127/60)`; 40 % → 103,
44 % → 106) and writes it with `amixer` within about a second. Each run
logs one line: `journalctl -t minidsp-usbvol`.

MPD still pauses playback when the device disappears; that is MPD's normal
behaviour and deliberately left alone.

### Install

`deploy/install.sh` installs the hook automatically when it finds a moOde
database at `/var/local/www/db/moode-sqlite3.db`. Force it on or off with
`MOODE_VOLUME_HOOK=yes|no` (default `auto`). By hand:

```bash
install -m 755 deploy/moode/minidsp-usbvol-restore.sh /usr/local/bin/
install -m 644 deploy/moode/99-minidsp-usbvol.rules /etc/udev/rules.d/
udevadm control --reload-rules
```

Test without touching a cable — re-enumerate the device from software and
watch the control come back at the knob's value:

```bash
D=/sys/bus/usb/devices/$(basename $(dirname $(grep -l 2752 /sys/bus/usb/devices/*/idVendor | head -1)))
echo 0 > $D/authorized; sleep 3; echo 1 > $D/authorized; sleep 5
amixer -c 0 cget name='miniDSP 2x4HD Playback Volume' | grep values
journalctl -t minidsp-usbvol -n 1
```

## Files

```
deploy/moode/
  README.md                    this file
  rotary-encoder.md            encoder hardware, moOde config, decoder fix
  rotenc-buxton.patch          the fix for /var/www/daemon/rotenc.py
  ir-remote.md                 receiver hardware, kernel/keymap/triggerhappy setup
  ir/minidsp-remote.toml       keymap for the miniDSP remote (adapt scancodes)
  ir/minidsp-remote.conf       triggerhappy actions for it
  minidsp-usbvol-restore.sh    USB volume restore hook
  99-minidsp-usbvol.rules      udev rule that triggers it
```
