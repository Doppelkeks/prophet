// @ts-check
// Browser side of tests/browser/golden.spec.js: runs WGSL twin functions on the GPU.
import { GpuDevice } from '/engine/gpu/gpu-device.js';
import { WgslPreprocessor } from '/engine/gpu/wgsl-preprocessor.js';
import { SIN_TABLE_Q14 } from '/engine/core/sin-table.js';

/** @type {{ device: GPUDevice, pipeline: GPUComputePipeline, sin: GPUBuffer } | null} */
let ctx = null;

async function setup() {
  const gpu = await GpuDevice.create();
  const device = gpu.device;
  const code = await new WgslPreprocessor(WgslPreprocessor.fetchLoader).process('/tests/browser/pages/golden.wgsl');
  const module = device.createShaderModule({ code });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((m) => m.type === 'error');
  if (errors.length) throw new Error(errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('\n'));
  const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
  const sin = device.createBuffer({ size: SIN_TABLE_Q14.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(sin, 0, SIN_TABLE_Q14);
  ctx = { device, pipeline, sin };
  return ctx;
}

/**
 * @param {number} op operation code (see golden.wgsl)
 * @param {number[]} words 4 u32 words per item
 * @returns {Promise<number[]>} one u32 per item
 */
async function runGolden(op, words) {
  const { device, pipeline, sin } = ctx ?? (await setup());
  const count = words.length / 4;
  const input = device.createBuffer({ size: Math.max(16, words.length * 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(input, 0, Uint32Array.from(words));
  const outBytes = Math.max(16, count * 4);
  const output = device.createBuffer({ size: outBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readback = device.createBuffer({ size: outBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const params = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(params, 0, Uint32Array.of(op, count, 0, 0));
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: params } },
      { binding: 1, resource: { buffer: input } },
      { binding: 2, resource: { buffer: output } },
      { binding: 3, resource: { buffer: sin } },
    ],
  });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(count / 64));
  pass.end();
  encoder.copyBufferToBuffer(output, 0, readback, 0, outBytes);
  device.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const result = Array.from(new Uint32Array(readback.getMappedRange()).subarray(0, count));
  readback.unmap();
  for (const b of [input, output, readback, params]) b.destroy();
  return result;
}

/** @type {any} */ (window).runGolden = runGolden;
/** @type {any} */ (window).__goldenReady = true;
