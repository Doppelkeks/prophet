// @ts-check
// The GPU swarm (docs/engine/05-gpu-swarm.md): the v0 pass chain as WGSL compute kernels over the packed
// buffers of SwarmLayout. Each simulated tick is encoded into the frame's command encoder, with its own
// inbound block and parameter slot, followed by a copy of its outbound block into the frame's readback
// slot. Blocks come back through the readback ring, strictly in submission order. With `timestamp-query`,
// each tick's pass (or, in `pass` timing, each step's) is timed, and the timings ride in the same slot.
import { GpuTimer, PAIR_BYTES, Samples } from '../gpu/gpu-timer.js';
import { ReadbackRing } from '../gpu/readback-ring.js';
import { PipelineCache } from '../gpu/pipeline-cache.js';
import { WgslPreprocessor } from '../gpu/wgsl-preprocessor.js';
import { EffectShape, EventClass, EventKind, FireFlag, MAX_IMPULSE, Policy, ProxyFlag, SwarmKeys, SwarmOutbound, Team, UnitFlag } from './swarm-contract.js';
import { MARK_PENALTY } from './reference/targeting.js';
import { FIELD_NONE, IH, INFLAG, LAYOUT_FIELDS, SwarmLayout } from './swarm-layout.js';
import { CARRY_OFFSET } from './reference/pickup-spawn.js';
import { MAGNET_SPEED, PICKUP_RADIUS } from './reference/pickups.js';
import { PRESSURE, PUSH_SHIFT, SEP_SHIFT } from './reference/steer.js';
import { SHOT_RADIUS } from './reference/projectiles.js';
import { PASSES } from './reference/swarm-reference.js';
import { Rng } from '../core/rng.js';

const KERNELS = '/engine/swarm/kernels/';
const PARAMS_STRIDE = 256; // minUniformBufferOffsetAlignment
const PARAM_WORDS = 12;

/** @typedef {import('./reference/swarm-buffers.js').TickParams} TickParams */

/**
 * GPU timing: `tick` times each tick's pass, `pass` gives every step of PASSES its own timed compute pass
 * (perf tools; the split costs a little), `off` never times. Without `timestamp-query` it is always off.
 * @typedef {'tick' | 'pass' | 'off'} SwarmTiming
 */

/**
 * @typedef {object} SwarmOptions
 * @property {number} [wg] workgroup size: 32, 64, 128 or 256
 * @property {number} [readbackSlots]
 * @property {number} [K]
 * @property {SwarmTiming} [timing] default `tick`
 * @property {(path: string) => Promise<string>} [load]
 */

export class Swarm {
  /**
   * @param {GPUDevice} device
   * @param {SwarmLayout} layout
   * @param {Int32Array} tables
   * @param {number} seed
   * @param {SwarmOptions} [options]
   */
  static async create(device, layout, tables, seed, options = {}) {
    const t0 = performance.now();
    const swarm = new Swarm(device, layout, tables, seed, options);
    await swarm.#compile(options.load ?? WgslPreprocessor.fetchLoader);
    swarm.warmupMs = performance.now() - t0;
    return swarm;
  }

  /**
   * Use Swarm.create.
   * @param {GPUDevice} device @param {SwarmLayout} layout @param {Int32Array} tables @param {number} seed
   * @param {SwarmOptions} options
   */
  constructor(device, layout, tables, seed, options) {
    this.device = device;
    this.layout = layout;
    this.wg = options.wg ?? 64;
    if (![32, 64, 128, 256].includes(this.wg)) throw new Error('swarm: workgroup size must be 32, 64, 128 or 256');
    this.keys = SwarmKeys.of(seed, Rng.key);
    const w = layout.words;
    const L = layout.L;
    const S = GPUBufferUsage.STORAGE;
    const RW = S | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    const buf = (/** @type {string} */ label, /** @type {number} */ words, /** @type {number} */ usage) =>
      device.createBuffer({ label: `swarm.${label}`, size: Math.max(16, words * 4), usage });
    this.buffers = {
      L: buf('layout', LAYOUT_FIELDS.length, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
      TP: device.createBuffer({ label: 'swarm.params', size: PARAMS_STRIDE * layout.caps.ticksInFlight, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
      U: buf('U', w.U, RW),
      P: buf('P', w.P, RW),
      A: buf('A', w.A, RW),
      I: buf('I', w.I, S | GPUBufferUsage.COPY_DST),
      O: buf('O', w.O, RW),
      T: buf('T', w.T, S | GPUBufferUsage.COPY_DST),
      G: buf('G', w.G, S | GPUBufferUsage.COPY_DST),
    };
    device.queue.writeBuffer(this.buffers.L, 0, layout.uniform(this.keys));
    device.queue.writeBuffer(this.buffers.T, 0, tables);
    this.outBytes = L.outWords * 4;
    const K = layout.caps.ticksInFlight;
    /** @type {SwarmTiming} */
    this.timing = GpuTimer.supported(device) ? (options.timing ?? 'tick') : 'off';
    this.timer = this.timing === 'off' ? null : new GpuTimer(device, this.timing === 'pass' ? K * PASSES.length : K, 'swarm.timer');
    /** Byte offset of the timings in a readback slot, after the K outbound blocks (8-aligned for BigInt64Array). */
    this.timesAt = (this.outBytes * K + 7) & ~7;
    this.readback = new ReadbackRing(device, {
      slots: options.readbackSlots ?? Math.max(6, (options.K ?? 4) + 2),
      bytes: this.timesAt + (this.timer ? this.timer.bytes : 0),
      label: 'swarm.readback',
    });
    /** GPU ms per tick, from timestamps (empty without them). */
    this.gpuTick = new Samples(256);
    /** Per-step GPU ns summed over `passTicks` ticks (`pass` timing only), in PASSES order. */
    this.passNs = new Float64Array(PASSES.length);
    this.passTicks = 0;
    /** Wall ms Swarm.create spent building the pipelines. */
    this.warmupMs = 0;
    const storage = (/** @type {boolean} */ ro) => ({ type: /** @type {GPUBufferBindingType} */ (ro ? 'read-only-storage' : 'storage') });
    this.bindLayout = device.createBindGroupLayout({
      label: 'swarm.bindings',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: PARAM_WORDS * 4 } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: storage(false) },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: storage(false) },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: storage(false) },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: storage(true) },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: storage(false) },
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: storage(true) },
        { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: storage(true) },
      ],
    });
    const b = this.buffers;
    this.bindGroup = device.createBindGroup({
      label: 'swarm.group',
      layout: this.bindLayout,
      entries: [
        { binding: 0, resource: { buffer: b.L } },
        { binding: 1, resource: { buffer: b.TP, size: PARAM_WORDS * 4 } },
        { binding: 2, resource: { buffer: b.U } },
        { binding: 3, resource: { buffer: b.P } },
        { binding: 4, resource: { buffer: b.A } },
        { binding: 5, resource: { buffer: b.I } },
        { binding: 6, resource: { buffer: b.O } },
        { binding: 7, resource: { buffer: b.T } },
        { binding: 8, resource: { buffer: b.G } },
      ],
    });
    this.pipelineLayout = device.createPipelineLayout({ label: 'swarm.layout', bindGroupLayouts: [this.bindLayout] });
    this.cache = new PipelineCache(device);
    /** @type {Record<string, GPUComputePipeline>} */
    this.pipelines = {};
    /** @type {{ encoder: GPUCommandEncoder, slot: import('../gpu/readback-ring.js').ReadbackSlot, ticks: number[] } | null} */
    this.frame = null;
    /** @type {Map<number, Int32Array>} */
    this.arrived = new Map();
    this.params = new Uint32Array(PARAM_WORDS);
    this.fieldSel = 0;
    this.fieldValid = false;
  }

  /** @param {(path: string) => Promise<string>} load */
  async #compile(load) {
    const pre = new WgslPreprocessor(load);
    const header =
      SwarmLayout.wgslStruct() +
      SwarmLayout.wgslConstants({
        SEP_SHIFT,
        PUSH_SHIFT,
        PRESSURE,
        SHOT_RADIUS,
        PICKUP_RADIUS,
        MAGNET_SPEED,
        CARRY_OFFSET,
        PROXY_PUSHES: ProxyFlag.PUSHES,
        PROXY_COLLECTOR: ProxyFlag.COLLECTOR,
        PLAYER_TEAM: Team.PLAYER,
        EFFECT_RING: EffectShape.RING,
        EVENT_UNIT_DIED: EventKind.UNIT_DIED,
        EVENT_CLASS_GAMEPLAY: EventClass.GAMEPLAY,
        UNIT_REPORT: UnitFlag.REPORT,
        MAX_IMPULSE,
        MARK_PENALTY,
        POLICY_STRONGEST: Policy.STRONGEST,
        POLICY_AIMED: Policy.AIMED,
        POLICY_CHAIN: Policy.CHAIN,
        FIRE_PREFER_MARKED: FireFlag.PREFER_MARKED,
      });
    const code = async (/** @type {string} */ name) => header + (await pre.process(`${KERNELS}${name}.wgsl`));
    const WG = this.wg;
    /** @type {[string, string, string, Record<string, number>][]} [pipeline name, kernel, entry point, constants] */
    const list = [
      ['clear', 'clear', 'main', { WG }],
      ['shotSpawn', 'shot-spawn', 'main', { WG }],
      ['pickupSpawn', 'pickup-spawn', 'main', { WG }],
      ['unitSpawn', 'unit-spawn', 'main', { WG }],
      ['binCount', 'bin-count', 'main', { WG }],
      ['binScatter', 'bin-scatter', 'main', { WG }],
      ['steer', 'steer', 'main', { WG }],
      ['integrate', 'integrate', 'main', { WG }],
      ['projectiles', 'projectiles', 'main', { WG }],
      ['effects', 'effects', 'main', { WG }],
      ['resolve', 'resolve', 'main', { WG }],
      ['contact', 'contact', 'main', { WG }],
      ['targeting', 'targeting', 'main', { WG }],
      ['pickups', 'pickups', 'main', { WG }],
      ['finalize', 'finalize', 'main', {}],
    ];
    for (const mode of [0, 1, 2, 3, 4]) {
      for (const entry of ['blocks', 'sums', 'apply']) list.push([`scan${mode}.${entry}`, 'scan', entry, { WG, MODE: mode }]);
    }
    const sources = new Map();
    for (const [, kernel] of list) if (!sources.has(kernel)) sources.set(kernel, await code(kernel));
    const built = await Promise.all(
      list.map(([, kernel, entryPoint, constants]) => this.cache.compute({ code: sources.get(kernel), label: `swarm.${kernel}`, entryPoint, layout: this.pipelineLayout, constants })),
    );
    list.forEach(([name], i) => (this.pipelines[name] = built[i]));
  }

  /**
   * Starts a frame: returns how many ticks it may encode (0 when every readback slot is in flight).
   */
  beginFrame() {
    if (this.frame) throw new Error('swarm: beginFrame() twice');
    const slot = this.readback.acquire();
    if (!slot) return 0;
    this.frame = { encoder: this.device.createCommandEncoder({ label: 'swarm.frame' }), slot, ticks: [] };
    return this.layout.caps.ticksInFlight;
  }

  /** @param {number} tick @param {Int32Array} inbound @param {number} prevFires @param {Int32Array | null} [field] */
  submit(tick, inbound, prevFires, field = null) {
    this.#field(inbound, field);
    const f = this.frame;
    if (!f) throw new Error('swarm: submit() outside beginFrame()/endFrame()');
    const k = f.ticks.length;
    if (k >= this.layout.caps.ticksInFlight) throw new Error('swarm: too many ticks in one frame');
    const p = this.#params(tick, k, inbound, prevFires);
    this.#write(k, inbound, p);
    this.encodeTick(f.encoder, k, p, PASSES.length, true);
    f.encoder.copyBufferToBuffer(this.buffers.O, 0, f.slot.buffer, k * this.outBytes, this.outBytes);
    f.ticks.push(tick);
  }

  /** Submits the frame and maps its readback slot. */
  endFrame() {
    const f = this.frame;
    if (!f) return;
    this.frame = null;
    const n = f.ticks.length;
    if (this.timer) this.timer.resolve(f.encoder, this.timing === 'pass' ? n * PASSES.length : n, f.slot.buffer, this.timesAt);
    this.device.queue.submit([f.encoder.finish()]);
    if (f.ticks.length) this.readback.submitted(f.slot, f.ticks);
    else this.readback.release(f.slot);
  }

  /** Collects the blocks of every harvested slot (call at frame start). */
  harvest() {
    return this.readback.harvest((slot, data) => {
      const n = slot.ticks.length;
      for (let k = 0; k < n; k++) {
        this.arrived.set(slot.ticks[k], SwarmOutbound.canonicalize(this.layout, new Int32Array(data, k * this.outBytes, this.outBytes >> 2)));
      }
      if (this.timer) this.#times(new BigInt64Array(data, this.timesAt, (this.timing === 'pass' ? n * PASSES.length : n) * (PAIR_BYTES >> 3)), n);
    });
  }

  /** Records the timings of a harvested frame of `n` ticks. @param {BigInt64Array} pairs @param {number} n */
  #times(pairs, n) {
    if (this.timing === 'tick') {
      for (let k = 0; k < n; k++) this.gpuTick.push(GpuTimer.ns(pairs, k) / 1e6);
      return;
    }
    const S = PASSES.length;
    for (let k = 0; k < n; k++) {
      let sum = 0;
      for (let i = 0; i < S; i++) {
        const ns = GpuTimer.ns(pairs, k * S + i);
        this.passNs[i] += ns;
        sum += ns;
      }
      this.gpuTick.push(sum / 1e6);
    }
    this.passTicks += n;
  }

  /**
   * GPU time per tick (p50 and p95, ms) over the recent ticks, and in `pass` timing the mean ms of each step
   * since the last reset. Null without timestamps.
   * @returns {{ mode: SwarmTiming, ticks: number, p50: number, p95: number, passes: Record<string, number> | null } | null}
   */
  gpuTiming() {
    if (!this.timer) return null;
    /** @type {Record<string, number> | null} */
    let passes = null;
    if (this.timing === 'pass' && this.passTicks) {
      passes = {};
      for (let i = 0; i < PASSES.length; i++) passes[PASSES[i]] = this.passNs[i] / this.passTicks / 1e6;
    }
    return { mode: this.timing, ticks: this.gpuTick.count, p50: this.gpuTick.percentile(0.5), p95: this.gpuTick.percentile(0.95), passes };
  }

  /** Drops the timings so far (after a warm-up). */
  resetTiming() {
    this.gpuTick.reset();
    this.passNs.fill(0);
    this.passTicks = 0;
  }

  /** @param {number} tick */
  take(tick) {
    const block = this.arrived.get(tick);
    if (!block) return null;
    this.arrived.delete(tick);
    return block;
  }

  /** @param {number} tick @param {number} k @param {Int32Array} inbound @param {number} prevFires @returns {TickParams} */
  #params(tick, k, inbound, prevFires) {
    return {
      tick,
      inBase: k * this.layout.L.inWords,
      prevFires,
      groups: inbound[IH.GROUPS],
      fires: inbound[IH.FIRES],
      proxies: inbound[IH.PROXIES],
      effects: inbound[IH.EFFECTS],
      requests: inbound[IH.REQUESTS],
      flags: inbound[IH.FLAGS],
      field: this.fieldValid ? this.fieldSel : FIELD_NONE,
    };
  }

  /**
   * The flow-field double buffer: a committed field goes into the other half, which this tick reads from
   * then on. Swaps are at least `ticksInFlight` ticks apart, so a frame never overwrites a half that one of
   * its earlier ticks still reads. A reset swarm has no field until the next swap.
   * @param {Int32Array} inbound @param {Int32Array | null} field
   */
  #field(inbound, field) {
    if (inbound[IH.FLAGS] & INFLAG.RESET) this.fieldValid = false;
    if (!field) return;
    this.fieldSel ^= 1;
    this.device.queue.writeBuffer(this.buffers.G, this.fieldSel * this.layout.L.cells * 4, field.buffer, field.byteOffset, field.byteLength);
    this.fieldValid = true;
  }

  /** @param {number} k @param {Int32Array} inbound @param {TickParams} p */
  #write(k, inbound, p) {
    const q = this.device.queue;
    q.writeBuffer(this.buffers.I, p.inBase * 4, inbound.buffer, inbound.byteOffset, this.layout.L.inWords * 4);
    const w = this.params;
    w[0] = p.tick;
    w[1] = p.inBase;
    w[2] = p.prevFires;
    w[3] = p.groups;
    w[4] = p.fires;
    w[5] = p.proxies;
    w[6] = p.requests;
    w[7] = p.flags;
    w[8] = p.effects;
    w[9] = p.field;
    q.writeBuffer(this.buffers.TP, k * PARAMS_STRIDE, w);
  }

  /**
   * Encodes the first `count` passes of one tick (all of them normally; fewer for per-pass diffs). A timed
   * tick writes timestamp pair k (`tick` timing) or pairs k·S … k·S + count − 1, one compute pass per step.
   * @param {GPUCommandEncoder} encoder @param {number} k parameter slot @param {TickParams} p @param {number} count
   * @param {boolean} [timed]
   */
  encodeTick(encoder, k, p, count, timed = false) {
    const L = this.layout.L;
    const pl = this.pipelines;
    const wg = this.wg;
    const groups = (/** @type {number} */ n) => Math.ceil(n / wg);
    if (p.flags & 1 && count > 0) {
      // Swarm reset: the pools and the scratch start over, exactly like fresh buffers (ClearPass twin).
      encoder.clearBuffer(this.buffers.U);
      encoder.clearBuffer(this.buffers.P);
      encoder.clearBuffer(this.buffers.A);
    }
    const t = timed ? this.timer : null;
    const split = t !== null && this.timing === 'pass';
    const begin = (/** @type {string} */ label, /** @type {GPUComputePassTimestampWrites | undefined} */ timestampWrites) => {
      const pass = encoder.beginComputePass({ label, timestampWrites });
      pass.setBindGroup(0, this.bindGroup, [k * PARAMS_STRIDE]);
      return pass;
    };
    let pass = begin(split ? `swarm.${PASSES[0]}` : `swarm.tick${p.tick}`, t ? t.writes[split ? k * PASSES.length : k] : undefined);
    const run = (/** @type {string} */ name, /** @type {number} */ x) => {
      if (x <= 0) return;
      pass.setPipeline(pl[name]);
      pass.dispatchWorkgroups(x);
    };
    const scan = (/** @type {number} */ mode, /** @type {number} */ n) => {
      run(`scan${mode}.blocks`, Math.ceil(n / 256));
      run(`scan${mode}.sums`, 1);
      run(`scan${mode}.apply`, groups(n));
    };
    /** @type {Record<string, () => void>} */
    const steps = {
      clear: () => run('clear', groups(Math.max(L.cells, L.outWords))),
      freeScan: () => {
        scan(0, L.unitCap);
        scan(1, L.shotCap);
        scan(3, L.pickCap);
        scan(4, L.unitCap);
      },
      shotSpawn: () => run('shotSpawn', groups(p.prevFires)),
      pickupSpawn: () => run('pickupSpawn', groups(L.unitCap)), // drops are known on the GPU only
      unitSpawn: () => run('unitSpawn', groups(p.requests)),
      binCount: () => run('binCount', groups(L.unitCap)),
      binScan: () => scan(2, L.cells),
      binScatter: () => run('binScatter', groups(L.unitCap)),
      steer: () => run('steer', groups(L.unitCap)),
      integrate: () => run('integrate', groups(L.unitCap)),
      projectiles: () => run('projectiles', groups(L.shotCap)),
      effects: () => run('effects', p.effects), // one workgroup per effect
      resolve: () => run('resolve', groups(L.unitCap)),
      contact: () => run('contact', p.proxies),
      targeting: () => run('targeting', p.fires),
      pickups: () => run('pickups', groups(L.pickCap)),
      finalize: () => run('finalize', 1),
    };
    for (let i = 0; i < count; i++) {
      if (split && i > 0) {
        pass.end();
        pass = begin(`swarm.${PASSES[i]}`, /** @type {GpuTimer} */ (t).writes[k * PASSES.length + i]);
      }
      steps[PASSES[i]]();
    }
    pass.end();
  }

  // ---- tests and tools ------------------------------------------------------------------------

  /**
   * Runs one tick outside the frame loop, only up to pass `count` (per-pass diffs). No readback slot.
   * @param {number} tick @param {Int32Array} inbound @param {number} prevFires @param {number} [count]
   */
  runTick(tick, inbound, prevFires, count = PASSES.length) {
    const p = this.#params(tick, 0, inbound, prevFires);
    this.#write(0, inbound, p);
    const encoder = this.device.createCommandEncoder({ label: 'swarm.debug' });
    this.encodeTick(encoder, 0, p, count);
    this.device.queue.submit([encoder.finish()]);
  }

  /** Reads U, P, A and O back (slow: tests and debug views). */
  async readState() {
    const d = this.device;
    const names = /** @type {const} */ (['U', 'P', 'A', 'O']);
    const encoder = d.createCommandEncoder({ label: 'swarm.readState' });
    const staging = names.map((n) => {
      const src = this.buffers[n];
      const dst = d.createBuffer({ size: src.size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      encoder.copyBufferToBuffer(src, 0, dst, 0, src.size);
      return dst;
    });
    d.queue.submit([encoder.finish()]);
    const out = await Promise.all(
      staging.map(async (b) => {
        await b.mapAsync(GPUMapMode.READ);
        const copy = new Int32Array(b.getMappedRange().slice(0));
        b.destroy();
        return copy;
      }),
    );
    return { U: out[0], P: out[1], A: out[2], O: out[3] };
  }

  /** Overwrites U, P, A and O (per-pass diffs start every pass from the same state). @param {{ U: Int32Array, P: Int32Array, A: Int32Array, O: Int32Array }} s */
  writeState(s) {
    const q = this.device.queue;
    for (const n of /** @type {const} */ (['U', 'P', 'A', 'O'])) q.writeBuffer(this.buffers[n], 0, s[n]);
  }

  destroy() {
    for (const b of Object.values(this.buffers)) b.destroy();
    this.readback.destroy();
    this.timer?.destroy();
  }
}
