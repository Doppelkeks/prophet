// @ts-check
// The swarm stress page (docs/engine/10-tooling-testing.md#performance): runs StressScene on the GPU swarm as
// fast as the readback ring allows, one tick per frame, and reports GPU time per tick (timestamp-query),
// wall time per tick, readback latency, pool fill and event overflow. `npm run dev`, then open
// http://localhost:4173/tools/stress/?units=100000&shots=50000&ticks=600
//
// URL parameters:
// - `units` and `shots`: the pool sizes (default: the `high` profile, 100k and 50k)
// - `ticks`: how many ticks to run
// - `warm`: ticks left out of the timings
// - `wg`: the workgroup size
// - `timing`: `tick`, or `pass` for a per-step split
// - `seed`
// The report lands in `window.__stress` and on the page.
import { GpuDevice } from '../../engine/gpu/gpu-device.js';
import { Swarm } from '../../engine/swarm/swarm.js';
import { SwarmLayout } from '../../engine/swarm/swarm-layout.js';
import { SwarmInbound, SwarmOutbound, SwarmTables } from '../../engine/swarm/swarm-contract.js';
import { ARENA_COST, NAV } from '../../game/data/arena.js';
import { SWARM_CAPS, SWARM_STATUSES, SWARM_TYPES } from '../../game/data/swarm-types.js';
import { StressScene } from './stress-scene.js';

/**
 * @typedef {object} StressConfig
 * @property {number} units
 * @property {number} shots
 * @property {number} ticks
 * @property {number} warm
 * @property {number} wg
 * @property {import('../../engine/swarm/swarm.js').SwarmTiming} timing
 * @property {number} seed
 */

/** @param {URLSearchParams} q @returns {StressConfig} */
export function config(q) {
  const num = (/** @type {string} */ k, /** @type {number} */ d) => (q.has(k) ? Number(q.get(k)) : d);
  const high = SWARM_CAPS.high;
  return {
    units: num('units', high.units ?? 100000),
    shots: num('shots', high.shots ?? 50000),
    ticks: num('ticks', 600),
    warm: num('warm', 60),
    wg: num('wg', 64),
    timing: q.get('timing') === 'pass' ? 'pass' : 'tick',
    seed: num('seed', 0x5c4a9),
  };
}

/** @param {StressConfig} cfg */
export async function run(cfg) {
  const gpu = await GpuDevice.create();
  const device = gpu.device;
  /** @type {string[]} */
  const errors = [];
  device.addEventListener('uncapturederror', (e) => errors.push(/** @type {GPUUncapturedErrorEvent} */ (e).error.message));
  const layout = new SwarmLayout({ ...SWARM_CAPS.high, units: cfg.units, shots: cfg.shots, fires: 1024, gridW: NAV.w, cellShift: NAV.shift, originX: NAV.origin, originY: NAV.origin });
  const tables = SwarmTables.build(layout, SWARM_TYPES, SWARM_STATUSES, ARENA_COST);
  const swarm = await Swarm.create(device, layout, tables, cfg.seed, { wg: cfg.wg, timing: cfg.timing });
  const scene = new StressScene(layout, { units: cfg.units });
  const inbound = new SwarmInbound(layout);
  const stats = {
    blocks: 0,
    inOrder: true,
    starved: 0,
    kills: 0,
    fired: 0,
    events: 0,
    maxEvents: 0,
    eventOverflow: 0,
    spawnsRejected: 0,
    shotsRejected: 0,
    scrapDropped: 0,
    scrapCollected: 0,
    minAlive: Infinity,
    maxAlive: 0,
    maxShots: 0,
    maxPickups: 0,
    last: { alive: 0, shots: 0, pickups: 0 },
  };
  let next = 0; // the next block to take
  let t0 = 0; // wall clock when the first measured tick was submitted
  const take = () => {
    swarm.harvest();
    for (let block = swarm.take(next); block; block = swarm.take(next)) {
      const o = new SwarmOutbound(layout, block);
      if (o.tick !== next) stats.inOrder = false;
      scene.observe(next, o.unitsAlive);
      stats.blocks++;
      stats.kills += o.kills;
      stats.fired += o.fired;
      stats.events += o.events;
      stats.maxEvents = Math.max(stats.maxEvents, o.events);
      stats.eventOverflow |= o.eventOverflow;
      stats.spawnsRejected += o.spawnsRejected;
      stats.shotsRejected += o.shotsRejected;
      stats.scrapDropped += o.scrapDropped;
      stats.scrapCollected += o.scrapCollected;
      if (next >= cfg.warm) stats.minAlive = Math.min(stats.minAlive, o.unitsAlive);
      stats.maxAlive = Math.max(stats.maxAlive, o.unitsAlive);
      stats.maxShots = Math.max(stats.maxShots, o.shotsAlive);
      stats.maxPickups = Math.max(stats.maxPickups, o.pickupsAlive);
      stats.last = { alive: o.unitsAlive, shots: o.shotsAlive, pickups: o.pickupsAlive };
      next++;
    }
  };
  let prevFires = 0;
  for (let t = 0; t < cfg.ticks; t++) {
    take();
    while (!swarm.beginFrame()) {
      stats.starved++;
      await new Promise((r) => setTimeout(r, 0));
      take();
    }
    if (t === cfg.warm) {
      swarm.resetTiming();
      swarm.readback.latency.reset();
      t0 = performance.now();
    }
    inbound.reset();
    scene.fill(inbound, t);
    swarm.submit(t, inbound.finish(t), prevFires, inbound.field);
    swarm.endFrame();
    prevFires = inbound.fires;
    if (errors.length) break;
    if (t % 16 === 15) await new Promise((r) => setTimeout(r, 0)); // let the page breathe
  }
  const deadline = performance.now() + 60000;
  while (next < cfg.ticks && !errors.length && performance.now() < deadline) {
    take();
    await new Promise((r) => setTimeout(r, 1));
  }
  const measured = Math.max(0, cfg.ticks - cfg.warm);
  const report = {
    done: true,
    ok: !errors.length && next === cfg.ticks && stats.inOrder,
    errors,
    config: cfg,
    adapter: gpu.info,
    features: [...gpu.features].sort(),
    compileMs: round(swarm.warmupMs),
    pipelines: Object.keys(swarm.pipelines).length,
    gpu: timing(swarm.gpuTiming()),
    wallMsPerTick: measured && t0 ? round((performance.now() - t0) / measured) : 0,
    readbackP95: round(swarm.readback.p95()),
    ...stats,
    minAlive: Number.isFinite(stats.minAlive) ? stats.minAlive : 0,
  };
  swarm.destroy();
  device.destroy();
  return report;
}

/** @param {number} v */
const round = (v) => Math.round(v * 1000) / 1000;

/** @param {ReturnType<Swarm['gpuTiming']>} g */
function timing(g) {
  if (!g) return null;
  /** @type {Record<string, number> | null} */
  let passes = null;
  if (g.passes) {
    passes = {};
    for (const [k, v] of Object.entries(g.passes)) passes[k] = round(v);
  }
  return { mode: g.mode, ticks: g.ticks, p50: round(g.p50), p95: round(g.p95), passes };
}
