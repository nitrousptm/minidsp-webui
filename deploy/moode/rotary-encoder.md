# Rotary encoder for moOde (volume knob + push button)

A volume knob on the streamer itself, next to the display, using moOde's
built-in rotary-encoder support — plus a fix for a decoding bug in moOde's
`rotenc.py` that makes the volume jump backwards with common encoders.

Nothing here touches minidsp-webui; it is documented because the knob ends
up driving the same volume stage the web UI shows as "USB" in the master
bar (see [README.md](README.md)).

## Hardware

### The encoder

Any mechanical quadrature encoder with a push switch works. Used here:
**Bourns PEC11R-4220F-S0024** — 24 detents, 24 pulses per revolution (one
full electrical cycle per detent), 20 mm D-shaft, momentary push switch.
Cheap, robust, easy to find.

What matters when picking another one:

- *Mechanical* (contact) encoders need no supply — they are just two
  switches. Optical/magnetic ones need power and often output 5 V; avoid
  those unless you add level shifting.
- Detents vs. pulses: with 24/24 both contacts are open at every rest
  position and the whole cycle happens between detents; 12-detent/24-pulse
  types rest on a half cycle. Both work with the patched decoder below,
  which emits exactly one step per full electrical cycle.

### Pinout (PEC11R)

Three pins in a row on one side, 2.5 mm pitch: **A – C – B**, the middle
one is the common. Two pins on the opposite side: the push switch. The
metal mounting tabs are mechanical only — leave them unconnected.

```
        ┌───────────────┐
        │   ┌───────┐   │
   A ───┤   │ shaft │   ├─── SW1
   C ───┤   │  (o)  │   │
   B ───┤   └───────┘   ├─── SW2
        └───────────────┘
   (pins seen from the bottom; A/C/B 2.5 mm apart)
```

### Wiring to the Raspberry Pi

No external parts. The Pi's internal pull-ups (enabled by moOde's script)
hold the inputs high; a closing contact pulls them to ground.

| Encoder pin | Pi header pin (physical) | BCM GPIO |
|---|---|---|
| C (common, middle) | 14 | GND |
| A | 16 | GPIO 23 |
| B | 18 | GPIO 24 |
| Switch pin 1 | 9 | GND |
| Switch pin 2 | 11 | GPIO 17 |

GPIO 23/24 are moOde's defaults for the encoder, and pins 14/16/18 sit
next to each other on the outer row of the header. The switch GPIO is free
to choose; 17 is just what is used here.

```
  Pi header, outer row (even pins), counted from the SD-card end:
    2   4   6   8  10  12  14  16  18  20  22 ...
                           GND GP23 GP24 GND GP25
                            │   │    │
                            C   A    B        ← encoder
```

Rules that cost a debugging session when broken:

- **Only 3.3 V or GND at the encoder side, never 5 V.** The GPIOs are not
  5 V tolerant.
- Physical pin numbering: pin 1 is the square pad next to the SD card;
  **odd** pins are the inner row, **even** pins the outer row. Being off by
  one pin lands on GPIO 22 or 25 and nothing happens.
- The PEC11R's flat pins do not make reliable contact in breadboards or
  Dupont sockets. Solder wires to them.
- Verify the wiring without moOde: `pinctrl get 23` must show `ip pu | hi`
  at rest, and while polling (`while true; do pinctrl get 23; pinctrl get
  24; sleep 0.05; done`) a slow turn must show `lo` on both lines between
  detents. If it never does, it is the wiring — a bare wire from pin 14 to
  pin 16 must make GPIO 23 read `lo`.

Debounce hardware is **not** needed with the patched decoder. If you keep
the stock `rotenc.py`, Bourns' recommended RC network per phase (10 kΩ
pull-up to 3.3 V, 10 kΩ in series to the GPIO, 10 nF from the GPIO to GND)
helps but does not fully fix the problem described next.

## moOde configuration

*System Config → Peripherals → Rotary encoder*: ON, pins `23,24`, params
`100 2 3` (poll interval in ms, acceleration factor, volume step). Then
Set. moOde runs `/var/www/daemon/rotenc.py 100 2 3 23 24` as the
`rotenc` service.

The push button: *System Config → GPIO Control*: Button 1, GPIO `17`,
pull-up, command e.g. `mpc,toggle` (play/pause) or
`/var/www/util/vol.sh,-mute` (mute/unmute with the UI's mute state
tracked). Arguments are comma-separated; anything executable works.

Direction wrong? Enter the pins as `24,23`.

## The bug: volume jumps back

Stock `rotenc.py` decides the direction from *which pin* raised the
interrupt that returned both inputs to the idle `1-1` state. That fails in
two ways with a real mechanical encoder:

1. **Contact bounce on the first contact.** Turning clockwise, A closes
   first. If A bounces open for a moment, the inputs read `1-1` via pin A —
   counted as a *counter-clockwise* step. The real step follows a few ms
   later. Across two of moOde's 100 ms poll intervals the volume visibly
   goes down, then up.
2. **Callback latency.** RPi.GPIO delivers callbacks late and one after
   another. When both rising edges arrive within that window (fast turn,
   or the CPU busy with the display), the callback for the first edge
   already reads `1-1` and blames the wrong pin.

`bouncetime=` would drop legitimate edges at moderate speed and does
nothing about case 2.

### The fix: state-table decoding

[rotenc-buxton.patch](rotenc-buxton.patch) replaces `encoder_isr()` with
Ben Buxton's full-step quadrature state table. A step is emitted only after
the complete `11 → 01 → 00 → 10 → 11` sequence (or its mirror) has been
seen, independent of which pin raised the interrupt. Bounce or a merged
edge can at worst drop a step; it can never produce one in the wrong
direction. Arguments, accel/step handling and rotation sense are
unchanged.

Apply on the Pi (as root):

```bash
cp /var/www/daemon/rotenc.py /root/rotenc.py.orig
patch /var/www/daemon/rotenc.py < deploy/moode/rotenc-buxton.patch
systemctl restart rotenc
```

Test in the foreground with debug output (stop the service first):

```bash
systemctl stop rotenc; python3 /var/www/daemon/rotenc.py 100 2 3 23 24 1
```

Ten detents clockwise must print only `+` lines whose numbers sum to 10,
never a `-`. Then `systemctl start rotenc`.

The same change has been submitted upstream to moOde. Until it lands,
**a moOde update overwrites `/var/www/daemon/rotenc.py`** — if the jumping
comes back after an update, re-apply the patch.

## Volume: what the knob actually moves

With moOde's volume type set to *Hardware* (see [README.md](README.md)),
the knob drives the 2x4 HD's USB volume control through MPD, exactly like
the moOde UI and a phone browser. The web UI shows that stage as
"USB −xx dB" in the master bar. Always set volume through moOde (knob,
UI, `/var/www/util/vol.sh N`), never with plain `mpc volume` — moOde
tracks the knob position in its own database and `rotenc.py` reads it from
there; a value set behind its back makes the next knob turn jump to the
stale position.
