# minidsp-webui

Eine eigene Web-Oberfläche für den miniDSP 2x4 HD, die die miniDSP Device
Console möglichst originalgetreu nachbildet (Kanalstreifen, Routing-Matrix,
PEQ mit grafischem Frequenzgang, Crossover, Compressor, FIR, Delay/Phase,
Presets). Als Backend-Zugriff auf das Gerät dient
[minidsp-rs](https://github.com/mrene/minidsp-rs) (`minidspd`).

Gedacht für den Betrieb neben moOde Audio auf einem Raspberry Pi, an den der
2x4 HD per USB angeschlossen ist.

## Architektur

```
minidsp/
  backend/    Node.js + TypeScript + Express, Proxy/Zustandsspeicher vor minidsp-rs
  frontend/   React + TypeScript + Vite, die eigentliche Konsolen-Oberfläche
  deploy/     systemd-Unit, Installations- und Smoke-Test-Skript
```

**Wichtig:** Der 2x4 HD (und damit auch minidsp-rs) kann PEQ/Crossover/
Compressor/FIR/Routing nur **schreiben**, nicht auslesen. Das Backend ist
deshalb selbst die Quelle der Wahrheit für die vollständige Konfiguration
(gespeichert unter `backend/data/presets/preset-<0-3>.json`) und schickt bei
jeder Änderung den entsprechenden Ausschnitt an `minidspd`. Nur Preset-Nummer,
Source, Lautstärke/Mute und die Pegel werden live vom Gerät gespiegelt.

## Voraussetzungen auf dem Pi

- `minidsp-rs` (`minidspd` + `minidsp` CLI) installiert und als systemd-Dienst
  aktiv, HTTP-API erreichbar (Standard: `127.0.0.1:5380`, siehe
  `/etc/minidsp/config.toml`)
- Node.js 20+ und npm (unter Debian/Raspberry Pi OS reicht `apt install nodejs
  npm`)

## Installation / Deployment

```bash
./deploy/install.sh
```

Das Skript installiert bei Bedarf Node.js, baut Backend und Frontend, richtet
den systemd-Dienst `minidsp-webui` ein und führt einen lesenden Smoke-Test
gegen die echte `minidspd`-Instanz aus. Backend und ausgeliefertes Frontend
laufen danach unter `http://<pi-hostname>:5381`.

Manueller Neustart / Status:

```bash
systemctl status minidsp-webui
journalctl -u minidsp-webui -f
```

## Lokale Entwicklung (ohne Hardware)

Backend im Mock-Modus (simuliert `minidspd`, kein echtes Gerät nötig):

```bash
cd backend && MINIDSP_MOCK=1 npm run dev
```

Frontend mit Hot-Reload (proxied `/api` und `/ws` zu `localhost:5381`):

```bash
cd frontend && npm run dev
```

## Tests

```bash
cd backend && npm test      # Unit + Integrationstests (Supertest gegen Mock)
cd frontend && npm test     # Biquad-/Crossover-Mathematik
cd frontend && npm run e2e  # Playwright E2E gegen Mock-Backend
```

`deploy/smoke-test.sh <url>` prüft nach dem Deployment schreibfrei, ob das
Backend läuft und der 2x4 HD erkannt wird.

## Bekannte Einschränkungen

- Keine Authentifizierung (wie minidsp-rs selbst) – nur im vertrauenswürdigen
  LAN betreiben.
- Dirac-Live-Kauf/-Aktivierung (Konvertierung zu DDRC-24) ist bewusst nicht
  abgebildet, da das in der Originalsoftware eine Stripe-Zahlung auslöst.
- FIR-Datei-Import erwartet IEEE-754-float32-Binärdateien; das exakte
  Verhalten bei Überschreiten des Tap-Budgets (4096 gesamt / 2048 pro Kanal)
  hängt von der jeweiligen minidsp-rs-Version ab und wird serverseitig als
  Fehlermeldung durchgereicht.
