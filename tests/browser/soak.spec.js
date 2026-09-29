// @ts-check
// A one-minute soak of the tech demo (tools/soak/soak.js), the CI slice of the M2 GC exit criterion. SwiftShader
// shares the CPU with the collector, so pause lengths here are not the budget's. `npm run soak -- --minutes 10`
// on a reference device checks that (docs/engine/10-tooling-testing.md#testing-strategy).
// Here, the run must stay healthy while the collector is watched:
// - no errors, no tainted blocks, the device intact;
// - GC statistics from every JS thread, attached to the report.
import { expect, test } from '@playwright/test';
import { soak } from '../../tools/soak/soak.js';

// Playwright's own trace snapshots the page on every key press, which would allocate on the main thread.
test.use({ trace: 'off' });

test('soak: a minute of scripted play stays healthy, with GC pauses measured on every JS thread', async ({ browser, page }, info) => {
  test.setTimeout(180_000);
  const r = await soak(browser, page, { url: '/index.html?units=4096&shots=1024&pickups=512', seconds: 60, window: 30 });
  info.annotations.push({ type: 'soak', description: JSON.stringify({ fps: r.fps, frameMs: r.frameMs, stalls: r.stalls, longTasks: r.longTasks, gc: r.gc }) });
  expect(r.errors, JSON.stringify(r.errors)).toEqual([]);
  expect(r.ok).toBe(true);
  if (!('gc' in r) || !r.gc) throw new Error('no GC statistics');
  expect(r.taints, 'no event overflow').toBe(0);
  expect(r.device?.state).toBe('ok');
  expect(r.ticks).toBeGreaterThan(300);
  expect(r.kills).toBeGreaterThan(0);
  expect(r.gc.windows).toBe(2);
  expect(r.gc.threads.some((t) => t.thread.startsWith('DedicatedWorker')), 'the engine worker is traced').toBe(true);
});
