// @ts-check
// Engine-worker host (ADR-007, docs/engine/01-overview.md#frame-pipeline): owns the WebGPU device, the
// heap, the simulation and the frame loop. Each frame it drains the input ring, runs the due fixed
// ticks (at most 4; beyond that the game slows down instead of catching up), renders, and writes the
// UI state block.
import { FrameDriver } from '../core/frame-driver.js';
import { Heap } from '../core/heap.js';
import { TICK_HZ } from '../core/units.js';
import { GpuDevice } from '../gpu/gpu-device.js';
import { ActionMap } from '../input/action-map.js';
import { InputRing } from '../input/input-ring.js';
import { InputState } from '../input/input-state.js';
import { WorkerPorts } from '../jobs/worker-port.js';
import { Tiers } from '../platform/tiers.js';
import { SwarmReference } from '../swarm/reference/swarm-reference.js';
import { StateBlockWriter } from '../ui/state-block.js';
import { SimBoot } from './sim-boot.js';

/**
 * The slice of DedicatedWorkerGlobalScope the host uses (typed loosely so it type-checks under the DOM lib).
 * @typedef {{
 *   postMessage(message: any, options?: StructuredSerializeOptions): void,
 *   onmessage: ((event: MessageEvent) => any) | null,
 *   navigator: Navigator,
 * }} WorkerScope
 */

/**
 * @typedef {object} InitMessage
 * @property {OffscreenCanvas} canvas
 * @property {number} width
 * @property {number} height
 * @property {number} dpr
 * @property {import('../platform/tiers.js').ThreadingTier} threading
 * @property {string} driver 'raf' | 'ping' | 'atomics' | 'auto'
 * @property {string | null} [perf] performance-tier override
 * @property {number | null} [workers] job-worker count override
 */

/** Night-900 from the palette, as the clear color. */
const CLEAR = { r: 7 / 255, g: 11 / 255, b: 22 / 255, a: 1 };
const TICK_MS = 1000 / TICK_HZ;
const MAX_TICKS_PER_FRAME = 4; // docs/BUDGETS.md#simulation-constants
const HUD_EVERY = 2; // frames: the HUD refreshes at 30 Hz at 60 fps

export class EngineHost {
  /**
   * @param {WorkerScope} scope
   * @param {{ game: import('./game-module.js').GameModule, jobWorkerUrl: URL | string }} options
   */
  constructor(scope, options) {
    this.scope = scope;
    this.game = options.game;
    this.jobWorkerUrl = options.jobWorkerUrl;
    /** @type {GpuDevice | null} */
    this.gpu = null;
    /** @type {FrameDriver | null} */
    this.driver = null;
    /** @type {import('./sim-core.js').SimCore | null} */
    this.sim = null;
    /** @type {InputRing | null} */
    this.ring = null;
    /** @type {StateBlockWriter | null} */
    this.hud = null;
    this.shared = false;
    this.input = new InputState();
    this.actions = new ActionMap();
    this.applyInput = this.input.apply.bind(this.input);
    this.frames = 0;
    this.busy = false;
    this.last = -1;
    this.acc = 0;
    this.stats = { fps: 0, frameMs: 0, simMs: 0, ticks: 0, skipped: 0 };
    scope.onmessage = (e) => this.onMessage(e.data);
  }

  /** @param {any} msg */
  onMessage(msg) {
    switch (msg.type) {
      case 'init':
        this.init(msg).catch((err) => this.fail(err));
        break;
      case 'ping':
        this.driver?.ping(msg.t);
        break;
      case 'input': // transfer tier: the main thread batches its records
        if (this.ring) {
          const w = /** @type {Int32Array} */ (msg.words);
          for (let i = 0; i + 3 < w.length; i += 4) this.ring.push(w[i], w[i + 1], w[i + 2], w[i + 3]);
        }
        break;
    }
  }

  /** @param {InitMessage} msg */
  async init(msg) {
    msg.canvas.width = msg.width;
    msg.canvas.height = msg.height;
    this.gpu = await GpuDevice.create({ canvas: msg.canvas });
    this.gpu.device.addEventListener('uncapturederror', (e) => {
      this.fail(new Error(`WebGPU validation: ${/** @type {GPUUncapturedErrorEvent} */ (e).error.message}`));
    });
    const cores = this.scope.navigator.hardwareConcurrency || 1;
    const perf = Tiers.performance(this.gpu.info, cores, msg.perf ?? null);
    const threading = msg.threading;
    const workers = msg.workers ?? Tiers.jobWorkers(threading, perf, cores);
    this.shared = threading === 'shared';
    const heap = Heap.create(perf, this.shared);
    const boot = await SimBoot.create({
      game: this.game,
      heap,
      tier: threading,
      workers,
      spawn: (i) => WorkerPorts.spawnBrowser(this.jobWorkerUrl, `px-job-${i}`),
      // The CPU reference swarm, with small pools, until the GPU swarm backend exists.
      swarm: (layout, tables, seed) => new SwarmReference(layout, tables, { seed }),
      swarmProfile: 'test',
    });
    this.sim = boot.sim;
    if (this.shared) {
      this.ring = new InputRing(heap.i32, boot.plan.input.off >> 2);
      this.ring.format();
    } else {
      this.ring = InputRing.create();
    }
    this.hud = new StateBlockWriter(heap.i32, boot.plan.state.off >> 2, this.game.hud);

    const wanted = msg.driver;
    /** @type {import('../core/frame-driver.js').FrameDriverMode} */
    const mode =
      wanted === 'raf' ? 'worker-raf' : wanted === 'ping' ? 'message-ping' : wanted === 'atomics' && this.shared ? 'atomics-ping' : FrameDriver.detect(this.shared);
    this.driver = new FrameDriver(mode, (t) => this.frame(t), { pingWords: heap.i32, pingIndex: Heap.W.PING });

    this.scope.postMessage({
      type: 'ready',
      engine: {
        adapter: this.gpu.info,
        driver: mode,
        rafInWorker: typeof requestAnimationFrame === 'function',
        perfTier: perf,
        jobWorkers: boot.workers,
        format: this.gpu.format,
        features: [...this.gpu.features].sort(),
        manifest: boot.manifest.hash,
      },
      bridge: this.shared
        ? { buffer: heap.buffer, inputW: boot.plan.input.off >> 2, inputCapacity: this.ring.capacity, stateW: boot.plan.state.off >> 2, pingW: Heap.W.PING }
        : null,
    });
    this.driver.start();
  }

  /** @param {number} now */
  async frame(now) {
    if (this.busy) {
      this.stats.skipped++;
      return;
    }
    const sim = this.sim;
    if (!sim || !this.ring) return;
    this.busy = true;
    try {
      this.ring.drain(this.applyInput);
      const dt = this.last < 0 ? TICK_MS : now - this.last;
      this.last = now;
      this.acc += Math.min(dt, 250);
      const t0 = performance.now();
      let ticks = 0;
      while (this.acc >= TICK_MS && ticks < MAX_TICKS_PER_FRAME) {
        const [w0, w1] = this.actions.sample(this.input);
        sim.stamp(w0, w1);
        if (!(await sim.step())) break; // stalled on a late swarm block: retry next frame
        this.acc -= TICK_MS;
        ticks++;
      }
      if (this.acc >= TICK_MS) this.acc = TICK_MS - 0.001; // behind: slow down, never skip ticks
      const s = this.stats;
      s.simMs = performance.now() - t0;
      s.ticks = ticks;
      s.frameMs = dt;
      s.fps = s.fps ? s.fps + (1000 / Math.max(dt, 1) - s.fps) * 0.1 : 1000 / Math.max(dt, 1);
      this.render();
      this.frames++;
      if (this.frames % HUD_EVERY === 0) this.writeHud();
      if (this.frames % 30 === 1) this.scope.postMessage({ type: 'stats', frames: this.frames });
    } catch (err) {
      this.fail(err);
    } finally {
      this.busy = false;
    }
  }

  render() {
    const gpu = this.gpu;
    if (!gpu || !gpu.context) return;
    const encoder = gpu.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: gpu.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: CLEAR }],
    });
    pass.end();
    gpu.device.queue.submit([encoder.finish()]);
  }

  writeHud() {
    const hud = this.hud;
    const sim = this.sim;
    if (!hud || !sim) return;
    hud.begin();
    this.game.extract(sim, hud, this.stats);
    hud.end();
    if (!this.shared) this.scope.postMessage({ type: 'state', words: hud.copy() });
  }

  /** @param {unknown} err */
  fail(err) {
    this.driver?.stop();
    const message = err instanceof Error ? err.message : String(err);
    this.scope.postMessage({ type: 'error', message });
  }
}
