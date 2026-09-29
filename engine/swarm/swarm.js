// @ts-check
// The GPU swarm (docs/engine/05-gpu-swarm.md): the v0 pass chain as WGSL compute kernels over the packed
// buffers of SwarmLayout. Each simulated tick is encoded into the frame's command encoder, with its own
// inbound block and parameter slot, followed by a copy of its outbound block into the frame's readback
// slot. Blocks come back through the readback ring, strictly in submission order.
import { ReadbackRing } from '../gpu/readback-ring.js';
import { PipelineCache } from '../gpu/pipeline-cache.js';
import { WgslPreprocessor } from '../gpu/wgsl-preprocessor.js';
import { ProxyFlag, SwarmKeys, Team } from './swarm-contract.js';
import { IH, SwarmLayout } from './swarm-layout.js';
import { PRESSURE, PUSH_SHIFT, SEP_SHIFT } from './reference/steer.js';
import { SHOT_RADIUS } from './reference/projectiles.js';
import { PASSES } from './reference/swarm-reference.js';
import { Rng } from '../core/rng.js';

const KERNELS = '/engine/swarm/kernels/';
const PARAMS_STRIDE = 256; // minUniformBufferOffsetAlignment
const PARAM_WORDS = 8;

/** @typedef {import('./reference/swarm-buffers.js').TickParams} TickParams */

export class Swarm {
  /**
   * @param {GPUDevice} device
   * @param {SwarmLayout} layout
   * @param {Int32Array} tables
   * @param {number} seed
   * @param {{ wg?: number, readbackSlots?: number, K?: number, load?: (path: string) => Promise<string> }} [options]
   */
  static async create(device, layout, tables, seed, options = {}) {
    const swarm = new Swarm(device, layout, tables, seed, options);
    await swarm.#compile(options.load ?? WgslPreprocessor.fetchLoader);
    return swarm;
  }

  /**
   * Use Swarm.create.
   * @param {GPUDevice} device @param {SwarmLayout} layout @param {Int32Array} tables @param {number} seed
   * @param {{ wg?: number, readbackSlots?: number, K?: number }} options
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
      L: buf('layout', 64, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
      TP: device.createBuffer({ label: 'swarm.params', size: PARAMS_STRIDE * layout.caps.ticksInFlight, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
      U: buf('U', w.U, RW),
      P: buf('P', w.P, RW),
      A: buf('A', w.A, RW),
      I: buf('I', w.I, S | GPUBufferUsage.COPY_DST),
      O: buf('O', w.O, RW),
      T: buf('T', w.T, S | GPUBufferUsage.COPY_DST),
    };
    device.queue.writeBuffer(this.buffers.L, 0, layout.uniform(this.keys));
    device.queue.writeBuffer(this.buffers.T, 0, tables);
    this.outBytes = L.outWords * 4;
    this.readback = new ReadbackRing(device, { slots: options.readbackSlots ?? Math.max(6, (options.K ?? 4) + 2), bytes: this.outBytes * layout.caps.ticksInFlight, label: 'swarm.readback' });
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
  }

  /** @param {(path: string) => Promise<string>} load */
  async #compile(load) {
    const pre = new WgslPreprocessor(load);
    const header =
      SwarmLayout.wgslStruct() +
      SwarmLayout.wgslConstants({ SEP_SHIFT, PUSH_SHIFT, PRESSURE, SHOT_RADIUS, PROXY_PUSHES: ProxyFlag.PUSHES, PLAYER_TEAM: Team.PLAYER });
    const code = async (/** @type {string} */ name) => header + (await pre.process(`${KERNELS}${name}.wgsl`));
    const WG = this.wg;
    /** @type {[string, string, string, Record<string, number>][]} [pipeline name, kernel, entry point, constants] */
    const list = [
      ['clear', 'clear', 'main', { WG }],
      ['shotSpawn', 'shot-spawn', 'main', { WG }],
      ['unitSpawn', 'unit-spawn', 'main', { WG }],
      ['binCount', 'bin-count', 'main', { WG }],
      ['binScatter', 'bin-scatter', 'main', { WG }],
      ['steer', 'steer', 'main', { WG }],
      ['integrate', 'integrate', 'main', { WG }],
      ['projectiles', 'projectiles', 'main', { WG }],
      ['resolve', 'resolve', 'main', { WG }],
      ['contact', 'contact', 'main', { WG }],
      ['targeting', 'targeting', 'main', { WG }],
      ['finalize', 'finalize', 'main', {}],
    ];
    for (const mode of [0, 1, 2]) {
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

  /** @param {number} tick @param {Int32Array} inbound @param {number} prevFires */
  submit(tick, inbound, prevFires) {
    const f = this.frame;
    if (!f) throw new Error('swarm: submit() outside beginFrame()/endFrame()');
    const k = f.ticks.length;
    if (k >= this.layout.caps.ticksInFlight) throw new Error('swarm: too many ticks in one frame');
    const p = this.#params(tick, k, inbound, prevFires);
    this.#write(k, inbound, p);
    this.encodeTick(f.encoder, k, p, PASSES.length);
    f.encoder.copyBufferToBuffer(this.buffers.O, 0, f.slot.buffer, k * this.outBytes, this.outBytes);
    f.ticks.push(tick);
  }

  /** Submits the frame and maps its readback slot. */
  endFrame() {
    const f = this.frame;
    if (!f) return;
    this.frame = null;
    this.device.queue.submit([f.encoder.finish()]);
    if (f.ticks.length) this.readback.submitted(f.slot, f.ticks);
    else this.readback.release(f.slot);
  }

  /** Collects the blocks of every harvested slot (call at frame start). */
  harvest() {
    return this.readback.harvest((slot, data) => {
      for (let k = 0; k < slot.ticks.length; k++) this.arrived.set(slot.ticks[k], new Int32Array(data, k * this.outBytes, this.outBytes >> 2));
    });
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
      requests: inbound[IH.REQUESTS],
      flags: inbound[IH.FLAGS],
    };
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
    q.writeBuffer(this.buffers.TP, k * PARAMS_STRIDE, w);
  }

  /**
   * Encodes the first `count` passes of one tick (all of them normally; fewer for per-pass diffs).
   * @param {GPUCommandEncoder} encoder @param {number} k parameter slot @param {TickParams} p @param {number} count
   */
  encodeTick(encoder, k, p, count) {
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
    const pass = encoder.beginComputePass({ label: `swarm.tick${p.tick}` });
    pass.setBindGroup(0, this.bindGroup, [k * PARAMS_STRIDE]);
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
      },
      shotSpawn: () => run('shotSpawn', groups(p.prevFires)),
      unitSpawn: () => run('unitSpawn', groups(p.requests)),
      binCount: () => run('binCount', groups(L.unitCap)),
      binScan: () => scan(2, L.cells),
      binScatter: () => run('binScatter', groups(L.unitCap)),
      steer: () => run('steer', groups(L.unitCap)),
      integrate: () => run('integrate', groups(L.unitCap)),
      projectiles: () => run('projectiles', groups(L.shotCap)),
      resolve: () => run('resolve', groups(L.unitCap)),
      contact: () => run('contact', p.proxies),
      targeting: () => run('targeting', p.fires),
      finalize: () => run('finalize', 1),
    };
    for (let i = 0; i < count; i++) steps[PASSES[i]]();
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
  }
}
