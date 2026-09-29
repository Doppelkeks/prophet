// Browser tests: headless Chromium with WebGPU (SwiftShader when no GPU is present).
// WebGPU requires a secure context, so every test loads http://127.0.0.1 from tools/dev-server.js.
import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
export const PORTS = { dev: 4173, prod: 4174, noCoi: 4175 };

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.js',
  timeout: 90_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORTS.dev}`,
    channel: 'chromium',
    launchOptions: {
      args: ['--enable-unsafe-webgpu'],
      executablePath: process.env.PX_CHROMIUM || undefined,
    },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: `node tools/dev-server.js --port ${PORTS.dev} --no-watch`,
      url: `http://127.0.0.1:${PORTS.dev}/index.html`,
      cwd: root,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `node tools/dev-server.js --port ${PORTS.noCoi} --no-coi --no-watch`,
      url: `http://127.0.0.1:${PORTS.noCoi}/index.html`,
      cwd: root,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
