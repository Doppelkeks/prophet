// @ts-check
import { FrameDriver } from '../core/frame-driver.js';
import { GpuDevice } from '../gpu/gpu-device.js';
import { Tiers } from '../platform/tiers.js';

/**
 * The slice of DedicatedWorkerGlobalScope the host uses (typed loosely so it type-checks under the DOM lib).
 * @typedef {{
 *   postMessage(message: any, options?: StructuredSerializeOptions): void,
 *   onmessage: ((event: MessageEvent) => any) | null,
 *   navigator: Navigator,
 * }} WorkerScope
 */

/** Night-900 from the palette, as the clear color. */
const CLEAR = { r: 7 / 255, g: 11 / 255, b: 22 / 255, a: 1 };

/**
 * Engine-worker host (ADR-007): owns the WebGPU device and the frame loop.
 * Increment 0 only clears the canvas; later increments add the simulation and the renderer.
 */
export class EngineHost {
  /** @param {WorkerScope} scope */
  constructor(scope) {
    this.scope = scope;
    /** @type {GpuDevice | null} */
    this.gpu = null;
    /** @type {FrameDriver | null} */
    this.driver = null;
    this.frames = 0;
    scope.onmessage = (e) => this.onMessage(e.data);
  }

  /** @param {any} msg */
  onMessage(msg) {
    if (msg.type === 'init') this.init(msg).catch((err) => this.fail(err));
    else if (msg.type === 'ping') this.driver?.ping(msg.t);
  }

  /** @param {{ canvas: OffscreenCanvas, width: number, height: number, threading: string, driver: string }} msg */
  async init(msg) {
    msg.canvas.width = msg.width;
    msg.canvas.height = msg.height;
    this.gpu = await GpuDevice.create({ canvas: msg.canvas });
    const mode = /** @type {import('../core/frame-driver.js').FrameDriverMode} */ (
      msg.driver === 'raf' ? 'worker-raf' : msg.driver === 'ping' ? 'message-ping' : FrameDriver.detect(false)
    );
    this.driver = new FrameDriver(mode, () => this.frame());
    this.gpu.device.addEventListener('uncapturederror', (e) => {
      this.fail(new Error(`WebGPU validation: ${/** @type {GPUUncapturedErrorEvent} */ (e).error.message}`));
    });
    const cores = this.scope.navigator.hardwareConcurrency || 1;
    this.scope.postMessage({
      type: 'ready',
      engine: {
        adapter: this.gpu.info,
        driver: mode,
        rafInWorker: typeof requestAnimationFrame === 'function',
        perfTier: Tiers.performance(this.gpu.info, cores),
        format: this.gpu.format,
        features: [...this.gpu.features].sort(),
      },
    });
    this.driver.start();
  }

  frame() {
    const gpu = this.gpu;
    if (!gpu || !gpu.context) return;
    const encoder = gpu.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: gpu.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: CLEAR }],
    });
    pass.end();
    gpu.device.queue.submit([encoder.finish()]);
    this.frames++;
    if (this.frames % 30 === 1) this.scope.postMessage({ type: 'stats', frames: this.frames });
  }

  /** @param {unknown} err */
  fail(err) {
    this.driver?.stop();
    const message = err instanceof Error ? err.message : String(err);
    this.scope.postMessage({ type: 'error', message });
  }
}
