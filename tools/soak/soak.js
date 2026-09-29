// The soak run (docs/engine/10-tooling-testing.md#testing-strategy): plays the tech demo in Chromium with
// scripted input and records:
// - GC pauses on every JS thread, from Chrome traces taken in windows (each parsed, then dropped);
// - long tasks on the main thread;
// - the engine's frame times, stalls, taints and device state.
//
//   npm run soak -- --minutes 10                      the M2 exit run on a reference device
//   npm run soak -- --seconds 90 --swiftshader        a quick check without a GPU (CI flags)
//
// Options:
// - --url /index.html?units=4096: another page or pool size
// - --channel chrome: the installed Chrome
// - --headed
// - --out soak.json: write the report
// - --budget 4: override the budget
// It exits non-zero when the page failed, or when the GC pause p99 is over budget (docs/BUDGETS.md: ≤ 4 ms
// over a 10-minute run).
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GcStats, percentile } from './gc-trace.js';

/** docs/BUDGETS.md#other-cpu-memory: GC pause, p99 over a 10-min run. */
export const GC_P99_BUDGET_MS = 4;
/** The SwiftShader flags of tests/browser/playwright.config.js. */
export const SWIFTSHADER_ARGS = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-angle=swiftshader'];
/** Keys held in turn, 1.5 s each: PATCH circles the arena. */
const MOVES = ['KeyD', 'KeyW', 'KeyA', 'KeyS'];

/**
 * @typedef {object} SoakOptions
 * @property {string} url page to play (absolute, or relative to the page's base URL)
 * @property {number} seconds
 * @property {number} [window] seconds per trace window (default 60)
 * @property {(line: string) => void} [log]
 */

/**
 * Plays the page for `seconds` and returns the report. The page must be fresh (the long-task observer is
 * installed before it loads).
 * @param {import('@playwright/test').Browser} browser
 * @param {import('@playwright/test').Page} page
 * @param {SoakOptions} o
 */
export async function soak(browser, page, o) {
  const log = o.log ?? (() => {});
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await page.addInitScript(() => {
    const w = /** @type {any} */ (window);
    w.__pxLongTasks = [];
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) w.__pxLongTasks.push(e.duration);
      }).observe({ type: 'longtask', buffered: true });
    } catch {
      // no long-task observer in this browser
    }
  });
  await page.goto(o.url);
  await page.waitForFunction(() => {
    const px = window.__px;
    return !!px && (px.status === 'error' || px.status === 'unsupported' || (px.status === 'ok' && px.frames > 10 && !!px.hud));
  }, null, { timeout: 120_000 });
  const start = await snapshot(page);
  if (start.status !== 'ok') return { ok: false, errors: [...errors, `boot: ${start.status} ${start.error ?? ''}`], start };
  log(`soak: ${o.url}, ${o.seconds} s, engine ${JSON.stringify(start.engine)}`);
  const gc = new GcStats();
  const windowS = o.window ?? 60;
  const input = new Driver(page);
  const t0 = Date.now();
  while ((Date.now() - t0) / 1000 < o.seconds - 0.5) {
    const len = Math.min(windowS, o.seconds - (Date.now() - t0) / 1000);
    await browser.startTracing(undefined, { categories: ['v8'] });
    const tw = Date.now();
    await input.play(len);
    const buf = await browser.stopTracing();
    gc.add(JSON.parse(buf.toString('utf8')), (Date.now() - tw) / 1000);
    const s = gc.summary();
    log(`  ${Math.round((Date.now() - t0) / 1000)} s: ${s.pauses.count} GC pauses, p99 ${s.pauses.p99} ms, max ${s.pauses.max} ms (${s.minor} minor, ${s.major} major)`);
    if (errors.length) break;
  }
  await input.release();
  const end = await snapshot(page);
  const longTasks = /** @type {number[]} */ (await page.evaluate(() => /** @type {any} */ (window).__pxLongTasks ?? []));
  const seconds = (Date.now() - t0) / 1000;
  const g = gc.summary();
  const perf = end.perf ?? {};
  return {
    ok: errors.length === 0 && end.status === 'ok',
    errors,
    url: o.url,
    seconds: Math.round(seconds * 10) / 10,
    engine: start.engine,
    frames: end.frames - start.frames,
    ticks: end.tick - start.tick,
    fps: Math.round(((end.frames - start.frames) / seconds) * 10) / 10,
    frameMs: { p50: perf.frameP50 ?? null, p99: perf.frameP99 ?? null },
    readbackP95: perf.readbackP95 ?? null,
    swarmGpu: perf.swarmGpu ?? null,
    stalls: end.stalls - start.stalls,
    taints: end.taints,
    kills: end.kills - start.kills,
    device: end.device,
    longTasks: { count: longTasks.length, p99: Math.round(percentile(longTasks, 0.99)), max: Math.round(longTasks.reduce((m, v) => (v > m ? v : m), 0)) },
    gc: g,
    budget: { gcP99Ms: GC_P99_BUDGET_MS, met: g.pauses.p99 <= GC_P99_BUDGET_MS },
  };
}

/** @param {import('@playwright/test').Page} page */
async function snapshot(page) {
  return page.evaluate(() => {
    const px = window.__px;
    const hud = /** @type {Record<string, number>} */ (px?.hud ?? {});
    const e = px?.engine;
    return {
      status: px?.status ?? 'none',
      error: px?.error ?? null,
      frames: px?.frames ?? 0,
      tick: hud.tick ?? 0,
      stalls: hud.stalls ?? 0,
      taints: hud.taints ?? 0,
      kills: hud.kills ?? 0,
      device: px?.device ?? null,
      perf: /** @type {Record<string, any> | null} */ (px?.perf ?? null),
      engine: e ? { perfTier: e.perfTier, driver: e.driver, swarm: e.swarm, warmup: e.warmup, adapter: `${e.adapter?.vendor}/${e.adapter?.architecture}` } : null,
    };
  });
}

/** Scripted play: PATCH circles, stomps, overclocks, and the director's stress goes up, with bursts. */
class Driver {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
    this.t = 0; // seconds played
    this.held = '';
  }

  /** @param {number} seconds */
  async play(seconds) {
    const end = this.t + seconds;
    const k = this.page.keyboard;
    while (this.t < end) {
      const move = MOVES[Math.floor(this.t / 1.5) % MOVES.length];
      if (move !== this.held) {
        if (this.held) await k.up(this.held);
        await k.down(move);
        this.held = move;
      }
      const step = Math.round(this.t * 4); // quarter seconds
      if (step % 12 === 0) await k.press('Space'); // stomp every 3 s
      if (step % 28 === 0) await k.press('KeyQ'); // Overclock when the meter is full
      if (step % 20 === 0) await k.press('BracketRight'); // a burst ring every 5 s
      if (step % 16 === 0 && this.t < 24) await k.press('Equal'); // stress up, 6 times
      await new Promise((r) => setTimeout(r, 250));
      this.t += 0.25;
    }
  }

  async release() {
    if (this.held) await this.page.keyboard.up(this.held);
    this.held = '';
  }
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const o = { seconds: 600, url: '/index.html', swiftshader: false, headed: false, channel: '', out: '', budget: GC_P99_BUDGET_MS, window: 60 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--minutes') o.seconds = Number(argv[++i]) * 60;
    else if (a === '--seconds') o.seconds = Number(argv[++i]);
    else if (a === '--url') o.url = argv[++i];
    else if (a === '--swiftshader') o.swiftshader = true;
    else if (a === '--headed') o.headed = true;
    else if (a === '--channel') o.channel = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--budget') o.budget = Number(argv[++i]);
    else if (a === '--window') o.window = Number(argv[++i]);
    else throw new Error(`soak: unknown argument ${a}`);
  }
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const { chromium } = await import('@playwright/test');
  const { DevServer } = await import('../dev-server.js');
  const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
  const server = new DevServer({ root, port: 0, watch: false, log: false });
  const port = await server.start();
  const browser = await chromium.launch({
    headless: !o.headed,
    channel: o.channel || undefined,
    executablePath: !o.channel && process.env.PX_CHROMIUM ? process.env.PX_CHROMIUM : undefined,
    args: o.swiftshader ? SWIFTSHADER_ARGS : ['--enable-unsafe-webgpu'],
  });
  let code = 1;
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const url = new URL(o.url, `http://127.0.0.1:${port}`).href;
    const report = await soak(browser, page, { url, seconds: o.seconds, window: o.window, log: (s) => console.log(s) });
    const met = 'gc' in report && report.gc ? report.gc.pauses.p99 <= o.budget : false;
    console.log(JSON.stringify(report, null, 2));
    if (o.out) await writeFile(o.out, JSON.stringify(report, null, 2));
    console.log(report.ok ? `soak: GC pause p99 ${'gc' in report && report.gc ? report.gc.pauses.p99 : '?'} ms (budget ${o.budget} ms): ${met ? 'met' : 'OVER BUDGET'}` : `soak: FAILED ${report.errors.join('; ')}`);
    code = report.ok && met ? 0 : 1;
  } finally {
    await browser.close();
    await server.stop();
  }
  process.exit(code);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
