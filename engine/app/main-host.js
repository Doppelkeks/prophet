// @ts-check
import { Heap } from '../core/heap.js';
import { InputCapture } from '../input/input-capture.js';
import { InputRing } from '../input/input-ring.js';
import { Probes } from '../platform/probes.js';
import { Tiers } from '../platform/tiers.js';
import { CanvasMeter } from '../render/canvas-meter.js';
import { Signals } from '../ui/signal.js';
import { StateBlockReader } from '../ui/state-block.js';
import { DevReload } from './dev-reload.js';

/**
 * @typedef {object} DebugSurface  Read by tests and dev tools as `window.__px`.
 * @property {'booting' | 'ok' | 'unsupported' | 'error'} status
 * @property {import('../platform/probes.js').MainProbes} probes
 * @property {import('../platform/tiers.js').ThreadingTier} threading
 * @property {Record<string, any> | null} engine   engine-reported info (adapter, driver, tiers)
 * @property {number} frames                       frames rendered by the engine worker
 * @property {number} gpuWaits                     frames the engine skipped because the GPU was behind
 * @property {Record<string, any> | null} [swarm]  GPU swarm readback state (debug)
 * @property {Record<string, number> | null} hud   the last state-block snapshot, decoded
 * @property {{ dropped: number, retries: number }} bridge input records dropped, state-block read retries
 * @property {string | null} error
 * @property {() => Promise<Capture>} capture the internal image of the engine's last frame
 */

/**
 * @typedef {object} Capture  The engine's internal image: RGBA, top row first, no border cropped.
 * @property {number} width
 * @property {number} height
 * @property {Uint8Array} data
 * @property {number} tick the sim tick when it was taken
 * @property {import('../render/renderer.js').FrameView} view camera and viewport of that frame
 * @property {Record<string, number>} palette token → 0xRRGGBB of the colors in use
 */

/**
 * @typedef {object} MainHostOptions
 * @property {HTMLCanvasElement} canvas
 * @property {HTMLElement} overlay the UI root (`<px-app>`)
 * @property {URL} engineWorkerUrl
 * @property {import('../ui/state-block.js').StateSchema} hud layout of the UI state block
 * @property {(reader: StateBlockReader) => void} [onHud] called after each successful state-block read
 */

/** Frames between state-block reads on the main thread: 30 Hz at 60 fps (docs/BUDGETS.md#ui-constants). */
const READ_EVERY = 2;

/**
 * Main-thread host (ADR-007): probes capabilities, owns the DOM and input, starts the engine worker
 * with the canvas transferred to it, and bridges input and UI state (shared memory, or messages in
 * the `transfer` tier).
 */
export class MainHost {
  /** @param {MainHostOptions} options */
  constructor(options) {
    this.options = options;
    this.canvas = options.canvas;
    this.overlay = options.overlay;
    this.params = new URLSearchParams(globalThis.location ? location.search : '');
    this.probes = Probes.main();
    this.threading = Tiers.threading(this.probes, this.params.get('threading'));
    /** @type {DebugSurface} */
    this.debug = {
      status: 'booting',
      probes: this.probes,
      threading: this.threading,
      engine: null,
      frames: 0,
      gpuWaits: 0,
      hud: null,
      bridge: { dropped: 0, retries: 0 },
      error: null,
      capture: () => this.requestCapture(),
    };
    /** @type {Map<number, { resolve: (c: Capture) => void, reject: (e: Error) => void }>} */
    this.captures = new Map();
    this.captureId = 0;
    /** @type {ResizeObserver | null} */
    this.resizer = null;
    /** @type {Worker | null} */
    this.worker = null;
    /** @type {InputRing | null} */
    this.ring = null;
    /** @type {StateBlockReader | null} */
    this.reader = null;
    /** @type {InputCapture | null} */
    this.capture = null;
    /** @type {Int32Array | null} */
    this.pingWords = null;
    this.pingIndex = 0;
    this.driverMode = '';
    this.looping = false;
    this.rafFrames = 0;
    this.bootPanel = document.createElement('div');
    this.bootPanel.className = 'panel boot';
    this.loop = this.loop.bind(this);
  }

  async start() {
    window.__px = this.debug;
    DevReload.start(location);
    this.overlay.append(this.bootPanel);
    this.render();
    if (!this.probes.secure || !this.probes.webgpu) {
      return this.unsupported('This browser has no WebGPU in this context. Use Chrome/Edge 113+, Safari 26+ or Firefox 141+ (Windows), or the desktop app.');
    }
    if (!this.probes.offscreen) {
      return this.fail('OffscreenCanvas is unavailable; the main-thread host is not implemented yet.');
    }
    const dpr = globalThis.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    const offscreen = this.canvas.transferControlToOffscreen();
    const worker = new Worker(this.options.engineWorkerUrl, { type: 'module', name: 'px-engine' });
    this.worker = worker;
    worker.onmessage = (e) => this.onMessage(e.data);
    worker.onerror = (e) => this.fail(`engine worker error: ${e.message}`);
    const workers = this.params.get('workers');
    const num = (/** @type {string} */ k) => (this.params.get(k) === null ? null : Number(this.params.get(k)));
    worker.postMessage(
      {
        type: 'init',
        canvas: offscreen,
        width,
        height,
        dpr,
        threading: this.threading,
        driver: this.params.get('driver') ?? 'auto',
        perf: this.params.get('perf'),
        workers: workers === null ? null : Number(workers),
        swarm: this.params.get('swarm'),
        units: num('units'),
        shots: num('shots'),
      },
      { transfer: [offscreen] },
    );
  }

  /** @param {any} msg */
  onMessage(msg) {
    switch (msg.type) {
      case 'ready':
        this.debug.engine = msg.engine;
        this.debug.status = 'ok';
        this.connect(msg.engine.driver, msg.bridge);
        break;
      case 'state':
        this.reader?.receive(msg.words);
        return;
      case 'capture': {
        const p = this.captures.get(msg.id);
        this.captures.delete(msg.id);
        if (p) msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg);
        return;
      }
      case 'stats':
        this.debug.frames = msg.frames;
        this.debug.gpuWaits = msg.gpuWaits ?? 0;
        this.debug.swarm = msg.swarm ?? null;
        break;
      case 'error':
        this.fail(msg.message);
        break;
    }
    this.render();
  }

  /**
   * Sets up the input ring, the state-block reader and the main-thread frame loop.
   * @param {string} driver
   * @param {{ buffer: SharedArrayBuffer, inputW: number, inputCapacity: number, stateW: number, pingW: number } | null} bridge
   */
  connect(driver, bridge) {
    this.driverMode = driver;
    if (bridge) {
      const heap = Heap.attach(bridge.buffer);
      this.ring = new InputRing(heap.i32, bridge.inputW, bridge.inputCapacity);
      this.reader = new StateBlockReader(heap.i32, bridge.stateW, this.options.hud);
      this.pingWords = heap.i32;
      this.pingIndex = bridge.pingW;
    } else {
      this.ring = InputRing.create(); // flushed to the engine by message every frame
      this.reader = StateBlockReader.detached(this.options.hud);
    }
    this.capture = new InputCapture(this.ring, this.canvas, window);
    this.capture.attach();
    this.resizer = CanvasMeter.observe(this.canvas, (width, height) => this.worker?.postMessage({ type: 'resize', width, height }));
    this.looping = true;
    requestAnimationFrame(this.loop);
  }

  /** The main thread's frame: gamepads, input flush, frame ping, UI state. @param {number} t */
  loop(t) {
    if (!this.looping) return;
    requestAnimationFrame(this.loop);
    const worker = /** @type {Worker} */ (this.worker);
    this.capture?.pollGamepads();
    if (!this.pingWords && this.ring && this.ring.pending) {
      /** @type {number[]} */
      const words = [];
      this.ring.drain((k, a, b, c) => words.push(k, a, b, c));
      const buf = Int32Array.from(words);
      worker.postMessage({ type: 'input', words: buf }, [buf.buffer]);
    }
    if (this.driverMode === 'message-ping') worker.postMessage({ type: 'ping', t });
    else if (this.driverMode === 'atomics-ping' && this.pingWords) {
      Atomics.add(this.pingWords, this.pingIndex, 1);
      Atomics.notify(this.pingWords, this.pingIndex);
    }
    if (++this.rafFrames % READ_EVERY === 0 && this.reader && this.reader.read()) {
      const reader = this.reader;
      /** @type {Record<string, number>} */
      const snapshot = {};
      for (const [name, index] of Object.entries(reader.schema.index)) snapshot[name] = reader.get(index);
      this.debug.hud = snapshot;
      this.debug.bridge = { dropped: this.ring?.dropped ?? 0, retries: reader.retries };
      this.options.onHud?.(reader);
    }
    Signals.flush();
  }

  /** @returns {Promise<Capture>} */
  requestCapture() {
    const worker = this.worker;
    if (!worker || this.debug.status !== 'ok') return Promise.reject(new Error('engine not running'));
    const id = ++this.captureId;
    return new Promise((resolve, reject) => {
      this.captures.set(id, { resolve, reject });
      worker.postMessage({ type: 'capture', id });
    });
  }

  /** @param {string} message */
  fail(message) {
    this.debug.status = 'error';
    this.debug.error = message;
    this.looping = false;
    this.capture?.detach();
    this.resizer?.disconnect();
    console.error(`[prophet] ${message}`);
    this.render();
  }

  /** @param {string} message */
  unsupported(message) {
    this.debug.status = 'unsupported';
    this.debug.error = message;
    const box = document.createElement('div');
    box.className = 'unsupported';
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.textContent = message;
    box.append(panel);
    this.overlay.append(box);
    this.render();
  }

  render() {
    const d = this.debug;
    const p = d.probes;
    const e = d.engine;
    const lines = [
      `PROPHET BOOT  ${d.status.toUpperCase()}`,
      `secure=${p.secure} coi=${p.coi} sab=${p.sab} webgpu=${p.webgpu} waitAsync=${p.waitAsync}`,
      `threading=${d.threading} cores=${p.cores}${p.electron ? ' electron' : ''}`,
    ];
    if (e) {
      lines.push(`adapter=${e.adapter.vendor || '?'}/${e.adapter.architecture || '?'}${e.adapter.isFallback ? ' (fallback)' : ''}`);
      lines.push(`perf=${e.perfTier} driver=${e.driver} jobs=${e.jobWorkers} frames=${d.frames}`);
    }
    if (d.error) lines.push(`error: ${d.error}`);
    this.bootPanel.textContent = lines.join('\n');
  }
}

