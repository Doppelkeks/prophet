// @ts-check

/**
 * @typedef {object} MainProbes
 * @property {boolean} secure         isSecureContext (WebGPU requires it)
 * @property {boolean} coi            crossOriginIsolated (SharedArrayBuffer, shared WebAssembly.Memory)
 * @property {boolean} sab            SharedArrayBuffer constructor present
 * @property {boolean} webgpu         navigator.gpu present
 * @property {boolean} waitAsync      Atomics.waitAsync present
 * @property {boolean} offscreen      canvas.transferControlToOffscreen present
 * @property {number} cores           navigator.hardwareConcurrency
 * @property {number} deviceMemory    navigator.deviceMemory (0 when unknown)
 * @property {boolean} electron       running inside the Electron shell
 * @property {string} userAgent
 */

/**
 * @typedef {object} AdapterProbe
 * @property {string} vendor
 * @property {string} architecture
 * @property {string} description
 * @property {boolean} isFallback     software adapter (e.g. SwiftShader in CI)
 * @property {string[]} features
 * @property {Record<string, number>} limits  the limits Prophet cares about
 */

/** Capability probes (docs/engine/08-platforms.md#tier-detection). */
export class Probes {
  /** Main-thread probes. @returns {MainProbes} */
  static main() {
    const nav = /** @type {Navigator} */ (globalThis.navigator);
    return {
      secure: globalThis.isSecureContext === true,
      coi: globalThis.crossOriginIsolated === true,
      sab: typeof SharedArrayBuffer === 'function',
      webgpu: !!(nav && nav.gpu),
      waitAsync: typeof Atomics.waitAsync === 'function',
      offscreen: typeof HTMLCanvasElement !== 'undefined' && 'transferControlToOffscreen' in HTMLCanvasElement.prototype,
      cores: (nav && nav.hardwareConcurrency) || 1,
      deviceMemory: (nav && nav.deviceMemory) || 0,
      electron: typeof window !== 'undefined' && !!window.prophetHost,
      userAgent: (nav && nav.userAgent) || '',
    };
  }

  /**
   * Summarizes an adapter for tier detection and diagnostics.
   * @param {GPUAdapter} adapter
   * @returns {AdapterProbe}
   */
  static adapter(adapter) {
    const info = adapter.info;
    const l = adapter.limits;
    return {
      vendor: info?.vendor ?? '',
      architecture: info?.architecture ?? '',
      description: info?.description ?? '',
      isFallback: !!(info && /** @type {{ isFallbackAdapter?: boolean }} */ (info).isFallbackAdapter),
      features: [...adapter.features].sort(),
      limits: {
        maxStorageBuffersPerShaderStage: l.maxStorageBuffersPerShaderStage,
        maxComputeWorkgroupStorageSize: l.maxComputeWorkgroupStorageSize,
        maxComputeInvocationsPerWorkgroup: l.maxComputeInvocationsPerWorkgroup,
        maxStorageBufferBindingSize: l.maxStorageBufferBindingSize,
        maxBufferSize: l.maxBufferSize,
      },
    };
  }
}
