// @ts-check
import { Probes } from '../platform/probes.js';

/** Optional features Prophet uses when present (docs/engine/03-rendering.md#device-and-features). */
const OPTIONAL_FEATURES = /** @type {GPUFeatureName[]} */ (['timestamp-query', 'subgroups', 'shader-f16', 'indirect-first-instance']);

/** Owns the WebGPU adapter, device and canvas context. Lives on the engine worker only. */
export class GpuDevice {
  /**
   * @param {GPUAdapter} adapter
   * @param {GPUDevice} device
   * @param {GPUCanvasContext | null} context
   * @param {GPUTextureFormat} format
   */
  constructor(adapter, device, context, format) {
    this.adapter = adapter;
    this.device = device;
    this.context = context;
    this.format = format;
    this.info = Probes.adapter(adapter);
    /** @type {Set<string>} */
    this.features = new Set(device.features);
    /** Resolves when the device is lost (driver reset, `device.destroy()`, backgrounding). */
    this.lost = device.lost;
  }

  /**
   * @param {{ canvas?: OffscreenCanvas | HTMLCanvasElement | null, want?: GPUFeatureName[], powerPreference?: GPUPowerPreference }} [options]
   * @returns {Promise<GpuDevice>}
   */
  static async create(options = {}) {
    const gpu = navigator.gpu;
    if (!gpu) throw new Error('webgpu-unavailable: navigator.gpu is missing (needs a secure context and a WebGPU browser)');
    const adapter = await gpu.requestAdapter({ powerPreference: options.powerPreference ?? 'high-performance' });
    if (!adapter) throw new Error('webgpu-unavailable: requestAdapter() returned null');
    const want = options.want ?? OPTIONAL_FEATURES;
    const requiredFeatures = want.filter((f) => adapter.features.has(f));
    const device = await adapter.requestDevice({ requiredFeatures });
    let context = null;
    const format = gpu.getPreferredCanvasFormat();
    if (options.canvas) {
      context = /** @type {GPUCanvasContext | null} */ (options.canvas.getContext('webgpu'));
      if (!context) throw new Error('webgpu-unavailable: canvas.getContext("webgpu") returned null');
      context.configure({ device, format, alphaMode: 'opaque' });
    }
    return new GpuDevice(adapter, device, context, format);
  }
}
