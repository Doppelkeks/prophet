// Electron smoke tests. On Linux without a display run: xvfb-run -a npm run test:electron
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.js',
  timeout: 120_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
});
