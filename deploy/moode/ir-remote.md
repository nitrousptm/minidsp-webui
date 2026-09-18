# IR remote control for moOde (kernel rc-core, no LIRC)

An infrared remote for volume, mute, transport and DSP preset selection,
received by a 38 kHz receiver on a GPIO of the Pi. The Linux kernel
decodes the protocol itself; moOde's `triggerhappy` turns the resulting
key presses into `vol.sh`/`mpc`/`curl` commands. Nothing in minidsp-webui
is required for this — the preset keys just happen to talk to its API, and
the web UI follows preset changes made this way.

Three layers, each with its own tool:

| Layer | Job | Tool |
|---|---|---|
| Kernel | GPIO pulses → protocol + scancode | device-tree overlay `gpio-ir` |
| Keymap | scancode of *your* remote → key name (`KEY_VOLUMEUP`) | `ir-keytable`, `/etc/rc_keymaps/*.toml` |
| Action | key name → command | `triggerhappy`, `/etc/triggerhappy/triggers.d/*.conf` |

moOde already uses layer 3 for USB volume knobs, which is why
`triggerhappy` and `/etc/triggerhappy/triggers.d/media.conf`
(volume/mute) are present on every moOde install. LIRC is not involved.

## Hardware

### The receiver

An IR receiver *module* — photodiode, amplifier, 38 kHz band-pass and
demodulator in one 3-pin package. Its output is a clean logic signal: high
at rest, low while carrier is being received. A bare IR photodiode or
phototransistor is **not** enough; you would have to build the amplifier,
filter and demodulator yourself.

Good choices, all Vishay, all pin-compatible (OUT – GND – VS) and happy
on 3.3 V: **TSOP38238**, TSOP34838, TSOP4838, TSOP31238. The generic
Arduino-kit parts (VS1838B, TL1838, HX1838, Huey-Jann IR1261) work too
and also run on 3.3 V; they are a bit more sensitive to ambient light.

Two things to check on any other part before wiring it:

- **Supply voltage.** Everything must be 3.3 V at the Pi. A 5 V-only
  receiver (older Sharp GP1U5x, TSOP17xx/28xx series) drives its output
  to 5 V, which kills the GPIO. It can be used with a resistor divider
  (2.2 kΩ series, 3.3 kΩ to GND → 3.0 V) or, safer for an unknown output
  stage, an NPN inverter (10 kΩ to the base, emitter to GND, collector to
  the GPIO with 10 kΩ to 3.3 V) plus `invert=0` in the overlay.
- **Carrier frequency.** 38 kHz matches nearly all remotes (NEC, RC-5,
  Sony). A 36 or 40 kHz part still works with reduced range.

The one used here came out of a miniDSP 2x4 HD (a TSOP34838 behind its
front window). The 2x4 HD's own IR learning function is lost that way; it
was of no use in this setup because it can only act on the DSP master
volume, which is kept as a fixed ceiling (see [README.md](README.md)).

### Pinout

Vishay TSOP3x/4x series, lens facing you, pins down, left to right:
**1 OUT – 2 GND – 3 VS**. The same order applies to the bare VS1838B.
Modules on a small breakout board (KY-022 etc.) use their own order —
read the silkscreen. Verify against the datasheet before powering it; a
swapped VS/OUT usually destroys the part.

### Wiring to the Raspberry Pi

| Receiver pin | Pi header pin (physical) | BCM GPIO |
|---|---|---|
| OUT | 22 | GPIO 25 |
| GND | 20 | GND |
| VS | 17 | 3.3 V |

```
  Pi header, outer row:  ... 14  16  18  20  22 ...
                             GND GP23 GP24 GND GP25
                                  enc  enc  │    │
                                            GND  OUT   ← receiver
  inner row:             ... 13  15  17  19  21
                                        3V3
                                         │
                                         VS
```

Why GPIO 25 and not the overlay's default GPIO 18: 18 is an I2S pin
(`dtparam=i2s=on` is set on moOde), and 23/24/17 are taken by the rotary
encoder and its button ([rotary-encoder.md](rotary-encoder.md)). Any free
GPIO works; just put its number in the overlay line.

No external components. Vishay's optional RC filter in the supply
(100 Ω series + 4.7 µF to GND) is only worth adding if you see spurious
codes and the receiver hangs on a noisy 3.3 V rail. Keep the receiver a
few centimetres away from the Pi, the DSP and the display cable, and not
in direct sunlight or under a PWM-dimmed LED lamp.

Bench test before connecting OUT to the GPIO: power the receiver from
3.3 V, multimeter between OUT and GND. At rest ~3.3 V; while a remote
button is held the average drops visibly (the meter averages the bursts).
If it does not, the remote can be checked with a phone camera — the IR
LED is visible as a flicker.

## Software, step by step

Everything as root on the Pi.

### 1. Tool and kernel driver

```bash
apt install ir-keytable
```

`ir-keytable` is its own package, not part of `v4l-utils`. Then tell the
kernel there is a receiver on GPIO 25 and reboot:

```bash
cp /boot/firmware/config.txt /root/config.txt.bak
echo "dtoverlay=gpio-ir,gpio_pin=25" >> /boot/firmware/config.txt
reboot
```

(For an inverting level shifter add `,invert=0`.) After the reboot:

```bash
ir-keytable
```

must list a device with `Driver: gpio_ir_recv`, an
`Input device: /dev/input/eventN` and `Enabled kernel protocols: lirc rc-6`.
The two `vc4_hdmi` entries are HDMI-CEC and can be ignored.

### 2. Read your remote's scancodes

The kernel enables only RC-6 by default. Enable all protocols and watch:

```bash
ir-keytable -c -p all -t
```

Press each key you want to use. Per press you get a line like
`... protocol(nec): scancode = 0x350a`. Note protocol and scancode per
key; holding a key shows the protocol's repeat frames, which later become
auto-repeat. Ctrl+C to stop. Nothing at all → `pinctrl get 25` must show
`hi` at rest with the receiver connected; `lo` means OUT and GND are
swapped or VS is missing.

For reference, the miniDSP remote (the SHD-style one with transport keys)
is NEC, device address `0x35`:

| Key | Scancode | | Key | Scancode |
|---|---|---|---|---|
| Volume + | `0x350a` | | Preset 1 | `0x3501` |
| Volume − | `0x3509` | | Preset 2 | `0x3502` |
| Mute | `0x350c` | | Preset 3 | `0x3505` |
| Play/Pause | `0x3543` | | Preset 4 | `0x3500` |
| Next | `0x3542` | | Source | `0x350e` |
| Prev | `0x3541` | | Dirac Live | `0x3506` |
| Standby | `0x3540` | | | |

### 3. Keymap: scancode → key name

[ir/minidsp-remote.toml](ir/minidsp-remote.toml) is the map for that
remote; adapt the scancodes for yours.

```bash
install -m 644 deploy/moode/ir/minidsp-remote.toml /etc/rc_keymaps/
ir-keytable -c -w /etc/rc_keymaps/minidsp-remote.toml
ir-keytable -t
```

Now every mapped key must additionally print a
`... key_down: KEY_VOLUMEUP` line. No such line → wrong protocol name or
scancode. Unmapped scancodes (Source, Dirac if you leave them out) produce
no key event at all, which is the correct way to ignore a button.

**Choosing key names.** They must exist in the kernel's list
(`grep KEY_ /usr/include/linux/input-event-codes.h`), and two things read
them before `triggerhappy` does:

- The X server on moOde's local display forwards all input devices to
  Chromium. `KEY_F1` opens Chromium's help, `KEY_F3` find, `KEY_F5`
  reload. Use names Chromium ignores — the media keys, `KEY_PROG1..4`,
  `KEY_SOUND`, `KEY_CONFIG`.
- `systemd-logind` handles `KEY_POWER`/`KEY_POWER2` (shuts the Pi down),
  `KEY_SLEEP`/`KEY_SUSPEND` (suspend) and `KEY_RESTART`. Map the remote's
  standby button to something neutral such as `KEY_STOP`.

To load the map at boot, add as the first line of `/etc/rc_maps.cfg`
(fields separated by tabs — driver, table name, file):

```
*	gpio_ir_recv	minidsp-remote.toml
```

The udev rule shipped with `ir-keytable` applies this file whenever the
device appears.

**Auto-repeat rate.** The kernel repeats a held key every 125 ms after a
500 ms delay. With the volume keys that means eight `vol.sh` runs per
second - each one a write to moOde's SQLite database on the SD card, and
under I/O pressure (a struggling Wi-Fi driver shares the SD card's interrupt
on the Pi 4) they queue up and the knob lags. 250 ms is plenty for a volume
ramp. Try it live with `ir-keytable -D 400 -P 250`; to make it permanent,
[ir/61-ir-repeat.rules](ir/61-ir-repeat.rules) sets it whenever the
receiver appears:

```bash
install -m 644 deploy/moode/ir/61-ir-repeat.rules /etc/udev/rules.d/
udevadm control --reload-rules && udevadm trigger -s rc -c add
ir-keytable -s rc0 | grep -i repeat
```

### 4. Actions: key name → command

[ir/minidsp-remote.conf](ir/minidsp-remote.conf) is the matching
`triggerhappy` file. Own file on purpose — moOde owns `media.conf` and may
rewrite it on update; it already provides single-press volume/mute.

```bash
install -m 644 deploy/moode/ir/minidsp-remote.conf /etc/triggerhappy/triggers.d/
systemctl enable --now triggerhappy
```

Format: `KEY_NAME  <event>  <command>`, event `1` = press, `2` =
auto-repeat while held, `0` = release. The command line goes through
`/bin/sh`, so quote JSON: `-d '{"preset":0}'` — without the single quotes
the shell strips the double quotes and the backend gets `{preset:0}`,
which is not JSON. `thd` re-reads the directory only on start:
`systemctl restart triggerhappy` after every edit.

Presets go through the web UI backend so its stored state follows the
device. Two endpoints, pick by trust level:

| Endpoint | Does | Time until the device reports it |
|---|---|---|
| `POST /api/master` `{"preset":n}` | switches the device preset, records it in the backend | ~3.6 s |
| `POST /api/presets/n/activate` | the same, then pushes the backend's stored config for that preset into the device | ~6 s |

As long as every DSP change is made through the web UI, both leave device
and backend identical and `/api/master` is the faster one. `/activate` is
the safety belt for the case that something else (official app, `minidsp`
CLI) has written to the device since — the device cannot be read back, so
this is the only way to know what is in it. The web UI follows either:
it watches `master.preset` in minidspd's live status and re-syncs.

### 5. Check after a reboot

```bash
reboot
```

Afterwards, without touching anything: `ir-keytable` shows the driver,
`ir-keytable -t` prints key names, `systemctl is-active triggerhappy` says
`active`, the remote works.

## Troubleshooting

- Keys decode (`ir-keytable -t` shows `key_down`) but nothing happens:
  `journalctl -u triggerhappy -f` while pressing. Debian starts `thd` with
  `--user nobody`; on this moOde install `vol.sh` and `mpc` still work
  that way, but a command that needs root will not.
- Volume steps twice per single press: `media.conf` (event 1) and this
  file (event 2) both fire. Remove the two `2` lines — no repeat-while-held,
  but clean single steps.
- Preset key does nothing: run the exact command line from the `.conf`
  in a shell. A JSON error means the quoting problem above.
- After a moOde update the receiver stops working: check that
  `/boot/firmware/config.txt` still has the `dtoverlay=gpio-ir` line and
  that `triggerhappy` is still enabled.
