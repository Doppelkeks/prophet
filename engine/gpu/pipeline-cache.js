// @ts-check
// Shader modules and compute pipelines, created once and reused (docs/engine/03-rendering.md). Compile
// errors surface with their line numbers instead of a generic validation error.

export class PipelineCache {
  /** @param {GPUDevice} device */
  constructor(device) {
    this.device = device;
    /** @type {Map<string, Promise<GPUShaderModule>>} */
    this.modules = new Map();
    /** @type {Map<string, Promise<GPUComputePipeline>>} */
    this.pipelines = new Map();
  }

  /** @param {string} code @param {string} label */
  module(code, label) {
    let m = this.modules.get(code);
    if (!m) {
      m = this.#compile(code, label);
      this.modules.set(code, m);
    }
    return m;
  }

  /** @param {string} code @param {string} label */
  async #compile(code, label) {
    const module = this.device.createShaderModule({ code, label });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter((m) => m.type === 'error');
    if (errors.length) {
      const lines = code.split('\n');
      const text = errors.map((m) => `${label}:${m.lineNum}:${m.linePos} ${m.message}\n    ${lines[m.lineNum - 1] ?? ''}`).join('\n');
      throw new Error(`WGSL compile error\n${text}`);
    }
    return module;
  }

  /**
   * @param {{ code: string, label: string, entryPoint: string, layout: GPUPipelineLayout | 'auto', constants?: Record<string, number> }} d
   */
  compute(d) {
    const key = `${d.label}|${d.entryPoint}|${JSON.stringify(d.constants ?? {})}`;
    let p = this.pipelines.get(key);
    if (!p) {
      p = this.module(d.code, d.label).then((module) =>
        this.device.createComputePipelineAsync({ label: `${d.label}.${d.entryPoint}`, layout: d.layout, compute: { module, entryPoint: d.entryPoint, constants: d.constants } }),
      );
      this.pipelines.set(key, p);
    }
    return p;
  }
}
