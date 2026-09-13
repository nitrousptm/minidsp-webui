import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 5390;

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : undefined,
  },
  webServer: {
    // Wipe any leftover preset/backup data before starting so tests always
    // see a clean device state - a stale checkbox or dragged frequency from
    // a previous run otherwise makes unrelated tests fail nondeterministically.
    command: `rm -rf .e2e-data && node ../backend/dist/server.js`,
    cwd: __dirname,
    env: {
      MINIDSP_MOCK: '1',
      PORT: String(PORT),
      HOST: '127.0.0.1',
      PRESETS_DIR: '.e2e-data/presets',
      BACKUPS_DIR: '.e2e-data/backups',
    },
    url: `http://127.0.0.1:${PORT}/api/device`,
    reuseExistingServer: false,
    timeout: 20000,
  },
});
