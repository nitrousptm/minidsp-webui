import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { config } from './config.js';
import { createMinidspClient } from './minidspClient.js';
import { ConfigStore } from './store.js';
import { deviceRouter } from './routes/device.js';
import { masterRouter } from './routes/master.js';
import { channelsRouter } from './routes/channels.js';
import { presetsRouter } from './routes/presets.js';
import { diagnosticsRouter } from './routes/diagnostics.js';
import { attachWsRelay } from './wsRelay.js';
import type { MinidspClient } from './minidspClient.js';
import { createTonePlayer, type TonePlayer } from './diagnostics/tonePlayer.js';

export async function createApp(overrideClient?: MinidspClient, overrideStore?: ConfigStore, overrideTonePlayer?: TonePlayer) {
  const client = overrideClient ?? createMinidspClient();
  const store = overrideStore ?? new ConfigStore();
  const tonePlayer = overrideTonePlayer ?? createTonePlayer();
  await store.whenReady();

  const app = express();
  app.use(express.json());

  app.use('/api', deviceRouter(client));
  app.use('/api', masterRouter(client, store));
  app.use('/api', channelsRouter(client, store));
  app.use('/api', presetsRouter(client, store));
  app.use('/api', diagnosticsRouter(client, store, tonePlayer));

  const frontendDist = path.resolve(process.cwd(), '../frontend/dist');
  if (existsSync(frontendDist)) {
    // Vite's build output hashes filenames under /assets - those are safe to
    // cache forever. index.html is not hashed, so it must always be
    // revalidated; otherwise a browser tab left open across a redeploy keeps
    // running stale JS indefinitely (silently missing every subsequent fix).
    app.use(
      express.static(frontendDist, {
        index: false,
        setHeaders: (res, filePath) => {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      }),
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  }

  return { app, client, store };
}

async function main() {
  // Last-resort safety net: every route handler is already wrapped with
  // asyncHandler, but this guards against anything that slips through
  // (e.g. an error inside the WS relay's status listener, which runs
  // outside any request). Logging instead of crashing keeps the one
  // long-lived process serving every client's WebSocket alive through a
  // single failed operation (this used to take the whole service down on
  // any transient minidspd hiccup).
  process.on('unhandledRejection', (err) => {
    // eslint-disable-next-line no-console
    console.error('Unhandled rejection (ignored, process stays up):', err);
  });

  const { app, client } = await createApp();
  const httpServer = createServer(app);
  attachWsRelay(httpServer, client);
  client.connect();

  httpServer.listen(config.webPort, config.webHost, () => {
    // eslint-disable-next-line no-console
    console.log(`minidsp-webui backend listening on http://${config.webHost}:${config.webPort}`);
  });
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
