// @ts-check
// Browser side of tests/browser/swarm.spec.js: the WGSL swarm and the JS reference run the same inbound
// stream; their buffers must be identical after every tick. On a mismatch, a per-pass replay of that
// tick names the first divergent kernel.
import '/engine/core/dev-global.js';
import { GpuDevice } from '/engine/gpu/gpu-device.js';
import { Swarm } from '/engine/swarm/swarm.js';
import { SwarmLayout } from '/engine/swarm/swarm-layout.js';
import { ProxyFlag, SwarmInbound, SwarmOutbound, SwarmTables, Team } from '/engine/swarm/swarm-contract.js';
import { PASSES, SwarmReference } from '/engine/swarm/reference/swarm-reference.js';
import { TEST_TYPES } from '/tests/support/swarm-harness.js';

const M = 1024;
/** @type {GpuDevice | null} */
let gpu = null;

/** @type {Record<string, (i: SwarmInbound, t: number) => void>} */
const SCENES = {
  mixed(i, t) {
    const px = Math.round(Math.cos(t / 40) * 6 * M);
    const py = Math.round(Math.sin(t / 55) * 5 * M);
    if (t === 0) {
      i.spawnRing({ type: 0, count: 900, cx: 0, cy: 0, r0: 3 * M, r1: 30 * M });
      i.spawnRing({ type: 1, count: 300, cx: 5 * M, cy: -5 * M, r0: 0, r1: 1536 }); // a dense crowd
    }
    if (t % 25 === 0) i.spawnRing({ type: (t / 25) % 3, count: 180, cx: px, cy: py, r0: 10 * M, r1: 20 * M });
    // Two collectors with overlapping magnets: every gem goes to the nearer one.
    i.proxy({ entity: 1, x: px, y: py, radius: 512, team: Team.PLAYER, flags: ProxyFlag.PUSHES | ProxyFlag.TARGETABLE | ProxyFlag.COLLECTOR, aux: 5 * M });
    i.proxy({ entity: 2, x: -px, y: 3 * M, radius: 700, team: Team.PLAYER, flags: ProxyFlag.COLLECTOR, aux: 3 * M });
    if (t === 150) i.depositScrap(9);
    for (let f = 0; f < 12; f++) {
      i.fire({ source: f, x: px + (f - 6) * 300, y: py, range: (8 + (f % 6)) * M, damage: 300 + f * 50, speed: 500 + f * 20, life: 40, pierce: f % 3 });
    }
    if (t === 200) i.requestReset();
  },
  big(i, t) {
    if (t === 0) {
      for (let g = 0; g < 50; g++) i.spawnRing({ type: g % 3, count: 2000, cx: ((g % 10) - 5) * 10 * M, cy: (Math.floor(g / 10) - 2) * 10 * M, r0: 0, r1: 8 * M });
    }
    i.proxy({ entity: 1, x: 0, y: 0, radius: 512, team: Team.PLAYER, flags: ProxyFlag.PUSHES | ProxyFlag.COLLECTOR, aux: 6 * M });
    for (let f = 0; f < 64; f++) i.fire({ source: f, x: (f - 32) * M, y: 0, range: 12 * M, damage: 400, speed: 600, life: 30, pierce: 1 });
  },
};

/**
 * @param {Int32Array} a @param {Int32Array} b @param {number} from @param {number} to
 * @returns {number} first differing index in [from, to), or -1
 */
function firstDiff(a, b, from, to) {
  for (let k = from; k < to; k++) if (a[k] !== b[k]) return k;
  return -1;
}

/**
 * Compares GPU state with the reference buffers; returns a description of the first difference, or null.
 * @param {{ U: Int32Array, P: Int32Array, A: Int32Array, O: Int32Array }} g
 * @param {{ U: Int32Array, P: Int32Array, A: Int32Array, O: Int32Array }} r
 * @param {SwarmLayout} layout
 */
function compare(g, r, layout) {
  const L = layout.L;
  const c = layout.caps;
  const field = (/** @type {string[]} */ names, /** @type {number} */ cap, /** @type {number} */ k) => `${names[Math.floor(k / cap)]}[${k % cap}]`;
  const unitFields = ['posX', 'posY', 'vel', 'altGen', 'hp', 'info', 'st0', 'st1'];
  const shotFields = ['posX', 'posY', 'vel', 'dmg', 'info', 'meta', 'lastHit', 'source'];
  const pickFields = ['pickup.posX', 'pickup.posY', 'pickup.value', 'pickup.info'];
  let k = firstDiff(g.U, r.U, 0, layout.words.U);
  if (k >= 0) return { buffer: 'U', at: field(unitFields, c.units, k), gpu: g.U[k], ref: r.U[k] };
  k = firstDiff(g.P, r.P, 0, layout.words.P);
  if (k >= 0) {
    const at = k < L.kPosX ? field(shotFields, c.shots, k) : field(pickFields, c.pickups, k - L.kPosX);
    return { buffer: 'P', at, gpu: g.P[k], ref: r.P[k] };
  }
  k = firstDiff(g.O, r.O, 0, layout.words.O);
  if (k >= 0) return { buffer: 'O', at: `O[${k}]`, gpu: g.O[k], ref: r.O[k] };
  const ranges = [
    ['accumulators', L.aDmg, L.aDmg + 5 * c.units],
    ['binCount', L.aBinCount, L.aBinCount + L.cells],
    ['binSumX', L.aBinSumX, L.aBinSumX + L.cells],
    ['binSumY', L.aBinSumY, L.aBinSumY + L.cells],
    ['binStart', L.aBinStart, L.aBinStart + L.cells],
    ['misc', L.aMisc, L.aMisc + 5],
    ['unitFree', L.aUnitFree, L.aUnitFree + r.A[L.aMisc]],
    ['shotFree', L.aShotFree, L.aShotFree + r.A[L.aMisc + 1]],
    ['pickFree', L.aPickFree, L.aPickFree + r.A[L.aMisc + 2]],
    ['dropList', L.aDropReq, L.aDropReq + r.A[L.aMisc + 3]],
    ['drops', L.aDrop, L.aDrop + c.units],
    ['requests', L.aReq, L.aReq + c.fires * 8],
  ];
  for (const [name, from, to] of /** @type {[string, number, number][]} */ (ranges)) {
    k = firstDiff(g.A, r.A, from, to);
    if (k >= 0) return { buffer: 'A', at: `${name}[${k - from}]`, gpu: g.A[k], ref: r.A[k] };
  }
  return null;
}

/** @param {SwarmReference} ref */
const refState = (ref) => ({ U: ref.b.Ui.slice(), P: ref.b.Pi.slice(), A: ref.b.A.slice(), O: ref.b.O.slice() });

/**
 * @param {{ scene: string, caps: Partial<import('/engine/swarm/swarm-layout.js').SwarmCaps>, ticks: number, wg: number, seed: number, check?: number }} cfg
 */
async function runSwarm(cfg) {
  gpu ??= await GpuDevice.create();
  const device = gpu.device;
  /** @type {string[]} */
  const errors = [];
  device.addEventListener('uncapturederror', (e) => errors.push(/** @type {GPUUncapturedErrorEvent} */ (e).error.message));
  const layout = new SwarmLayout(cfg.caps);
  const tables = SwarmTables.build(layout, TEST_TYPES);
  const t0 = performance.now();
  const swarm = await Swarm.create(device, layout, tables, cfg.seed, { wg: cfg.wg });
  const compileMs = performance.now() - t0;
  const ref = new SwarmReference(layout, tables, { seed: cfg.seed });
  const inbound = new SwarmInbound(layout);
  const scene = SCENES[cfg.scene];
  const check = cfg.check ?? 1;
  let prevFires = 0;
  let prevGpu = await swarm.readState();
  let prevRef = refState(ref);
  let kills = 0;
  let maxAlive = 0;
  let scrapDropped = 0;
  let scrapCollected = 0;
  let maxCarry = 0;
  let gpuMs = 0;
  let refMs = 0;
  /** @type {Map<number, Int32Array>} reference outbound blocks waiting for their GPU twin */
  const refBlocks = new Map();
  const blockMismatches = { count: 0, first: -1 };
  for (let t = 0; t < cfg.ticks; t++) {
    inbound.reset();
    scene(inbound, t);
    const block = inbound.finish(t).slice();
    let s = performance.now();
    await frameSlot(swarm, refBlocks, blockMismatches);
    swarm.submit(t, block, prevFires);
    swarm.endFrame();
    const g = t % check === 0 || t === cfg.ticks - 1 ? await swarm.readState() : null;
    gpuMs += performance.now() - s;
    s = performance.now();
    ref.submit(t, block, prevFires);
    refMs += performance.now() - s;
    const refBlock = /** @type {Int32Array} */ (ref.take(t));
    refBlocks.set(t, refBlock);
    const out = new SwarmOutbound(layout, refBlock);
    kills += out.kills;
    maxAlive = Math.max(maxAlive, out.unitsAlive);
    scrapDropped += out.scrapDropped;
    scrapCollected += out.scrapCollected;
    maxCarry = Math.max(maxCarry, out.scrapCarry);
    if (errors.length) return { ok: false, tick: t, errors };
    if (g) {
      const diff = compare(g, refState(ref), layout);
      if (diff) {
        const pass = check === 1 ? await diagnose(swarm, ref, layout, prevGpu, prevRef, t, block, prevFires) : 'unknown (enable per-tick checks)';
        return { ok: false, tick: t, pass, ...diff };
      }
      prevGpu = g;
      prevRef = refState(ref);
    }
    prevFires = inbound.fires;
  }
  // Every outbound block also comes back through the readback ring, identical to the reference's.
  const deadline = performance.now() + 20000;
  while (refBlocks.size && performance.now() < deadline) {
    collect(swarm, refBlocks, blockMismatches);
    await new Promise((r) => setTimeout(r, 5));
  }
  swarm.destroy();
  if (refBlocks.size || blockMismatches.count) return { ok: false, missingBlocks: refBlocks.size, blockMismatches };
  return { ok: true, ticks: cfg.ticks, kills, maxAlive, scrapDropped, scrapCollected, maxCarry, hash: ref.hash(), compileMs, gpuMs, refMs, errors };
}

/**
 * Harvests the readback ring and checks the arrived blocks against the reference's.
 * @param {Swarm} swarm @param {Map<number, Int32Array>} refBlocks @param {{ count: number, first: number }} bad
 */
function collect(swarm, refBlocks, bad) {
  swarm.harvest();
  for (const [t, expected] of refBlocks) {
    const got = swarm.take(t);
    if (!got) continue;
    refBlocks.delete(t);
    if (got.length !== expected.length || got.some((w, i) => w !== expected[i])) {
      bad.count++;
      if (bad.first < 0) bad.first = t;
    }
  }
}

/** Waits for a free readback slot and starts a frame. @param {Swarm} swarm @param {Map<number, Int32Array>} refBlocks @param {{ count: number, first: number }} bad */
async function frameSlot(swarm, refBlocks, bad) {
  for (;;) {
    collect(swarm, refBlocks, bad);
    if (swarm.beginFrame()) return;
    await new Promise((r) => setTimeout(r, 1));
  }
}

/**
 * Replays tick `t` pass by pass from the last matching state and returns the first pass whose output
 * differs from the reference.
 * @param {Swarm} swarm @param {SwarmReference} ref @param {SwarmLayout} layout
 * @param {{ U: Int32Array, P: Int32Array, A: Int32Array, O: Int32Array }} prevGpu
 * @param {{ U: Int32Array, P: Int32Array, A: Int32Array, O: Int32Array }} prevRef
 * @param {number} t @param {Int32Array} block @param {number} prevFires
 */
async function diagnose(swarm, ref, layout, prevGpu, prevRef, t, block, prevFires) {
  /** @type {{ U: Int32Array, P: Int32Array, A: Int32Array, O: Int32Array }[]} */
  const after = [];
  const b = ref.b;
  b.Ui.set(prevRef.U);
  b.Pi.set(prevRef.P);
  b.A.set(prevRef.A);
  b.O.set(prevRef.O);
  ref.afterPass = () => after.push(refState(ref));
  ref.submit(t, block, prevFires);
  ref.afterPass = null;
  for (let n = 1; n <= PASSES.length; n++) {
    swarm.writeState(prevGpu);
    swarm.runTick(t, block, prevFires, n);
    const g = await swarm.readState();
    const diff = compare(g, after[n - 1], layout);
    if (diff) return `${PASSES[n - 1]} (${diff.buffer} ${diff.at}: gpu ${diff.gpu}, ref ${diff.ref})`;
  }
  return 'none (the full tick differs but no single pass does)';
}

/** Readback ring: ticks come back through mapped slots, in order, identical to the reference. @param {{ ticks: number, seed: number }} cfg */
async function runReadback(cfg) {
  gpu ??= await GpuDevice.create();
  const layout = new SwarmLayout({ units: 1024, shots: 256, fires: 32, groups: 8, proxies: 4, gridW: 64, arenaHalf: 64 * M });
  const tables = SwarmTables.build(layout, TEST_TYPES);
  const swarm = await Swarm.create(gpu.device, layout, tables, cfg.seed, { readbackSlots: 3 });
  const ref = new SwarmReference(layout, tables, { seed: cfg.seed });
  const inbound = new SwarmInbound(layout);
  let prevFires = 0;
  let tick = 0;
  let starved = 0;
  /** @type {number[]} */
  const order = [];
  let mismatches = 0;
  const deadline = performance.now() + 30000;
  while (order.length < cfg.ticks && performance.now() < deadline) {
    swarm.harvest();
    for (let t = order.length; ; t++) {
      const block = swarm.take(t);
      if (!block) break;
      order.push(t);
      const expected = ref.take(t);
      if (!expected || block.some((w, i) => w !== expected[i])) mismatches++;
    }
    const allowed = swarm.beginFrame();
    if (!allowed) starved++;
    for (let k = 0; k < allowed && tick < cfg.ticks; k++) {
      inbound.reset();
      SCENES.mixed(inbound, tick);
      const block = inbound.finish(tick).slice();
      swarm.submit(tick, block, prevFires);
      ref.submit(tick, block, prevFires);
      prevFires = inbound.fires;
      tick++;
    }
    if (allowed) swarm.endFrame();
    await new Promise((r) => setTimeout(r, 4));
  }
  const p95 = swarm.readback.p95();
  swarm.destroy();
  return { received: order.length, inOrder: order.every((t, i) => t === i), mismatches, starved, p95 };
}

Object.assign(window, { runSwarm, runReadback, __swarmReady: true });
