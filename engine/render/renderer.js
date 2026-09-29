// @ts-check
// Renderer v0 (docs/engine/03-rendering.md#renderer-v0): the scene at the internal resolution through the
// oblique camera (ground, swarm units, shots and actors as vertex-pulled boxes, with a depth buffer), then a
// nearest-neighbour upscale to the canvas (docs/engine/04-pixel-art-pipeline.md). Units and shots are read
// straight from the swarm's GPU buffers. Render code: floats are fine here.
import { PipelineCache } from '../gpu/pipeline-cache.js';
import { WgslPreprocessor } from '../gpu/wgsl-preprocessor.js';
import { SHOT_ALIVE, UNIT_ALIVE } from '../swarm/swarm-layout.js';
import { PixelViewport } from './pixel-viewport.js';
import { ACTOR_WORDS } from './render-style.js';

const SHADERS = '/engine/render/shaders/';
const UNIT_STYLES = 0;
const ACTOR_STYLES = 16;
const SHOT_STYLE = 32;
const STYLE_COUNT = 33;
const PALETTE_SIZE = 32;
const FRAME_WORDS = 24;
/** Depth range in internal px (y − z) mapped onto [0, 1] around the camera: ±256 m. */
const DEPTH_RANGE = 4096;
const COLOR_FORMAT = 'rgba8unorm';
const DEPTH_FORMAT = 'depth24plus';

/** @typedef {import('./render-style.js').RenderStyle} RenderStyle */
/** @typedef {import('./render-style.js').BoxStyle} BoxStyle */

/** The camera and viewport of the last rendered frame (for captures and tests). */
/** @typedef {{ k: number, iw: number, ih: number, halfW: number, halfH: number, snapU: number, snapV: number, cropX: number, cropY: number }} FrameView */

export class Renderer {
  /**
   * @param {GPUDevice} device
   * @param {GPUTextureFormat} format canvas format
   * @param {RenderStyle} style
   * @param {{ load?: (path: string) => Promise<string> }} [options]
   */
  static async create(device, format, style, options = {}) {
    const load = options.load ?? WgslPreprocessor.fetchLoader;
    const tokens = Renderer.parsePalette(await load(style.palette));
    const r = new Renderer(device, format, style, tokens);
    await r.#compile(load);
    return r;
  }

  /**
   * `--c-name: #RRGGBB;` declarations to a token → 0xRRGGBB map.
   * @param {string} css
   */
  static parsePalette(css) {
    /** @type {Map<string, number>} */
    const out = new Map();
    for (const m of css.matchAll(/--c-([\w-]+):\s*#([0-9a-fA-F]{6})\b/g)) out.set(m[1], parseInt(m[2], 16));
    return out;
  }

  /**
   * Use Renderer.create.
   * @param {GPUDevice} device @param {GPUTextureFormat} format @param {RenderStyle} style @param {Map<string, number>} tokens
   */
  constructor(device, format, style, tokens) {
    this.device = device;
    this.format = format;
    this.style = style;
    this.viewport = new PixelViewport();
    /** @type {string[]} palette index → token */
    this.paletteTokens = [];
    /** @type {Record<string, number>} token → 0xRRGGBB, for the colors in use */
    this.paletteHex = {};
    const styles = new Uint32Array(PALETTE_SIZE * 4 + STYLE_COUNT * 4);
    const pal = new Float32Array(styles.buffer, 0, PALETTE_SIZE * 4);
    const color = (/** @type {string} */ token) => {
      let i = this.paletteTokens.indexOf(token);
      if (i >= 0) return i;
      const hex = tokens.get(token);
      if (hex === undefined) throw new Error(`renderer: palette token --c-${token} is not defined in ${style.palette}`);
      i = this.paletteTokens.length;
      if (i >= PALETTE_SIZE) throw new Error(`renderer: more than ${PALETTE_SIZE} palette colors`);
      this.paletteTokens.push(token);
      this.paletteHex[token] = hex;
      pal.set([((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255, 1], i * 4);
      return i;
    };
    const clear = tokens.get(style.clear);
    if (clear === undefined) throw new Error(`renderer: palette token --c-${style.clear} is not defined`);
    this.clear = { r: ((clear >> 16) & 255) / 255, g: ((clear >> 8) & 255) / 255, b: (clear & 255) / 255, a: 1 };
    const box = (/** @type {number} */ slot, /** @type {BoxStyle} */ b) => {
      for (const v of [b.w, b.d, b.h, b.z ?? 0]) if (!Number.isInteger(v) || v < 0 || v > 255) throw new Error('renderer: box sizes are whole pixels, 0–255');
      styles.set([b.w, b.d, b.h, color(b.top) | (color(b.front) << 8) | ((b.z ?? 0) << 16)], PALETTE_SIZE * 4 + slot * 4);
    };
    if (style.units.length > 16 || style.actors.length > 16) throw new Error('renderer: at most 16 unit and 16 actor styles');
    style.units.forEach((b, i) => box(UNIT_STYLES + i, b));
    style.actors.forEach((b, i) => box(ACTOR_STYLES + i, b));
    box(SHOT_STYLE, style.shot);
    const g = style.ground;
    this.groundColors = color(g.a) | (color(g.b) << 8) | (color(g.edge) << 16) | (color(g.outside) << 24);

    const U = GPUBufferUsage;
    this.frameBuffer = device.createBuffer({ label: 'render.frame', size: FRAME_WORDS * 4, usage: U.UNIFORM | U.COPY_DST });
    this.stylesBuffer = device.createBuffer({ label: 'render.styles', size: styles.byteLength, usage: U.UNIFORM | U.COPY_DST });
    device.queue.writeBuffer(this.stylesBuffer, 0, styles);
    this.upBuffer = device.createBuffer({ label: 'render.upscale', size: 32, usage: U.UNIFORM | U.COPY_DST });
    this.maxActors = style.maxActors ?? 64;
    /** Actor records for this frame, written by the game's extract. */
    this.actors = new Int32Array(this.maxActors * ACTOR_WORDS);
    this.actorBuffer = device.createBuffer({ label: 'render.actors', size: this.actors.byteLength, usage: U.STORAGE | U.COPY_DST });
    this.empty = device.createBuffer({ label: 'render.empty', size: 16, usage: U.STORAGE });
    this.frameWords = new ArrayBuffer(FRAME_WORDS * 4);
    this.frameF = new Float32Array(this.frameWords);
    this.frameU = new Uint32Array(this.frameWords);
    this.upWords = new Float32Array(8);

    const V = GPUShaderStage.VERTEX;
    const Fr = GPUShaderStage.FRAGMENT;
    const ro = /** @type {GPUBufferBindingLayout} */ ({ type: 'read-only-storage' });
    this.sceneLayout = device.createBindGroupLayout({
      label: 'render.scene',
      entries: [
        { binding: 0, visibility: V | Fr, buffer: { type: 'uniform' } },
        { binding: 1, visibility: V | Fr, buffer: { type: 'uniform' } },
        { binding: 2, visibility: V, buffer: ro },
        { binding: 3, visibility: V, buffer: ro },
        { binding: 4, visibility: V, buffer: ro },
      ],
    });
    this.upLayout = device.createBindGroupLayout({
      label: 'render.upscale',
      entries: [
        { binding: 0, visibility: Fr, buffer: { type: 'uniform' } },
        { binding: 1, visibility: Fr, texture: { sampleType: 'float' } },
      ],
    });
    /** Swarm source: GPU buffers (the GPU swarm) or buffers this renderer uploads (the JS reference). */
    this.swarm = { L: /** @type {Record<string, number> | null} */ (null), U: this.empty, P: this.empty, owned: false };
    /** @type {GPUBindGroup | null} */
    this.sceneGroup = null;
    /** @type {GPUBindGroup | null} */
    this.upGroup = null;
    /** @type {GPUTexture | null} */
    this.color = null;
    /** @type {GPUTexture | null} */
    this.depth = null;
    /** @type {FrameView} */
    this.view = { k: 1, iw: 1, ih: 1, halfW: 0, halfH: 0, snapU: 0, snapV: 0, cropX: 0, cropY: 0 };
    this.cache = new PipelineCache(device);
    /** @type {Record<string, GPURenderPipeline>} */
    this.pipelines = {};
    this.#bindScene();
  }

  /** @param {(path: string) => Promise<string>} load */
  async #compile(load) {
    const pre = new WgslPreprocessor(load);
    const header =
      [
        ['UNIT_ALIVE', UNIT_ALIVE],
        ['SHOT_ALIVE', SHOT_ALIVE],
        ['ACTOR_WORDS', ACTOR_WORDS],
        ['UNIT_STYLES', UNIT_STYLES],
        ['ACTOR_STYLES', ACTOR_STYLES],
        ['SHOT_STYLE', SHOT_STYLE],
        ['STYLE_COUNT', STYLE_COUNT],
      ]
        .map(([k, v]) => `const ${k}: u32 = ${Number(v) >>> 0}u;`)
        .join('\n') + '\n';
    const device = this.device;
    const sceneLayout = device.createPipelineLayout({ label: 'render.scene', bindGroupLayouts: [this.sceneLayout] });
    const upLayout = device.createPipelineLayout({ label: 'render.upscale', bindGroupLayouts: [this.upLayout] });
    const [ground, cubes, upscale] = await Promise.all(
      ['ground', 'cubes', 'upscale'].map(async (n) => this.cache.module(header + (await pre.process(`${SHADERS}${n}.wgsl`)), `render.${n}`)),
    );
    /** @type {GPUDepthStencilState} */
    const depthTest = { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' };
    const target = [{ format: /** @type {GPUTextureFormat} */ (COLOR_FORMAT) }];
    const cube = (/** @type {number} */ source) =>
      device.createRenderPipelineAsync({
        label: `render.cubes.${source}`,
        layout: sceneLayout,
        vertex: { module: cubes, entryPoint: 'vs', constants: { SOURCE: source } },
        fragment: { module: cubes, entryPoint: 'fs', targets: target },
        primitive: { topology: 'triangle-list' },
        depthStencil: depthTest,
      });
    const [g, units, shots, actors, up] = await Promise.all([
      device.createRenderPipelineAsync({
        label: 'render.ground',
        layout: sceneLayout,
        vertex: { module: ground, entryPoint: 'vs' },
        fragment: { module: ground, entryPoint: 'fs', targets: target },
        primitive: { topology: 'triangle-list' },
        depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'always' },
      }),
      cube(0),
      cube(1),
      cube(2),
      device.createRenderPipelineAsync({
        label: 'render.upscale',
        layout: upLayout,
        vertex: { module: upscale, entryPoint: 'vs' },
        fragment: { module: upscale, entryPoint: 'fs', targets: [{ format: this.format }] },
        primitive: { topology: 'triangle-list' },
      }),
    ]);
    this.pipelines = { ground: g, units, shots, actors, upscale: up };
  }

  /**
   * Draws the GPU swarm's buffers directly.
   * @param {import('../swarm/swarm-layout.js').SwarmLayout} layout @param {GPUBuffer} U @param {GPUBuffer} P
   */
  bindSwarm(layout, U, P) {
    this.#dropOwned();
    this.swarm = { L: layout.L, U, P, owned: false };
    this.#bindScene();
  }

  /**
   * Uploads the JS reference's buffers (small pools: `?swarm=cpu`). Call once per frame.
   * @param {import('../swarm/swarm-layout.js').SwarmLayout} layout @param {Uint32Array} U @param {Uint32Array} P
   */
  uploadSwarm(layout, U, P) {
    if (!this.swarm.owned || this.swarm.L !== layout.L) {
      this.#dropOwned();
      const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
      this.swarm = {
        L: layout.L,
        U: this.device.createBuffer({ label: 'render.swarmU', size: Math.max(16, U.byteLength), usage }),
        P: this.device.createBuffer({ label: 'render.swarmP', size: Math.max(16, P.byteLength), usage }),
        owned: true,
      };
      this.#bindScene();
    }
    this.device.queue.writeBuffer(this.swarm.U, 0, U);
    this.device.queue.writeBuffer(this.swarm.P, 0, P);
  }

  #dropOwned() {
    if (!this.swarm.owned) return;
    this.swarm.U.destroy();
    this.swarm.P.destroy();
  }

  #bindScene() {
    this.sceneGroup = this.device.createBindGroup({
      label: 'render.scene',
      layout: this.sceneLayout,
      entries: [
        { binding: 0, resource: { buffer: this.frameBuffer } },
        { binding: 1, resource: { buffer: this.stylesBuffer } },
        { binding: 2, resource: { buffer: this.swarm.U } },
        { binding: 3, resource: { buffer: this.swarm.P } },
        { binding: 4, resource: { buffer: this.actorBuffer } },
      ],
    });
  }

  /**
   * Reallocates the internal targets for a canvas size in device pixels.
   * @param {number} devW @param {number} devH @param {number} [zoomH]
   */
  resize(devW, devH, zoomH) {
    const vp = this.viewport.resize(devW, devH, zoomH);
    if (this.color && this.color.width === vp.internalW && this.color.height === vp.internalH) return;
    this.color?.destroy();
    this.depth?.destroy();
    const size = [vp.internalW, vp.internalH];
    this.color = this.device.createTexture({
      label: 'render.internal',
      size,
      format: COLOR_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    this.depth = this.device.createTexture({ label: 'render.depth', size, format: DEPTH_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    this.upGroup = this.device.createBindGroup({
      label: 'render.upscale',
      layout: this.upLayout,
      entries: [
        { binding: 0, resource: { buffer: this.upBuffer } },
        { binding: 1, resource: this.color.createView() },
      ],
    });
  }

  /**
   * Encodes the frame: the scene into the internal target, then the upscale into `target`.
   * @param {GPUCommandEncoder} encoder
   * @param {GPUTextureView} target the canvas texture
   * @param {import('./oblique-camera.js').ObliqueCamera} camera already following this frame's position
   * @param {number} alpha interpolation between the last two ticks, 0..1
   * @param {number} actorCount records in `this.actors`
   */
  encode(encoder, target, camera, alpha, actorCount) {
    const color = this.color;
    const depth = this.depth;
    if (!color || !depth || !this.sceneGroup || !this.upGroup || !this.pipelines.ground) return;
    const vp = this.viewport;
    const q = this.device.queue;
    const iw = vp.internalW;
    const ih = vp.internalH;
    const halfW = Math.floor(iw / 2);
    const halfH = Math.floor(ih / 2);
    const actors = Math.min(actorCount, this.maxActors);
    const L = this.swarm.L;
    const f = this.frameF;
    const u = this.frameU;
    f[0] = iw;
    f[1] = ih;
    f[2] = halfW;
    f[3] = halfH;
    f[4] = camera.snapU;
    f[5] = camera.snapV;
    f[6] = camera.y * camera.ppm;
    f[7] = camera.ppm;
    f[8] = alpha;
    f[9] = DEPTH_RANGE;
    f[10] = this.style.arenaHalf;
    f[11] = Math.max(1, Math.round(this.style.ground.tile * camera.ppm));
    u[12] = L ? L.uPosX : 0;
    u[13] = L ? L.uPosY : 0;
    u[14] = L ? L.uVel : 0;
    u[15] = L ? L.uInfo : 0;
    u[16] = L ? L.pPosX : 0;
    u[17] = L ? L.pPosY : 0;
    u[18] = L ? L.pVel : 0;
    u[19] = L ? L.pInfo : 0;
    u[20] = L ? L.unitCap : 0;
    u[21] = L ? L.shotCap : 0;
    u[22] = actors;
    u[23] = this.groundColors;
    q.writeBuffer(this.frameBuffer, 0, this.frameWords);
    if (actors) q.writeBuffer(this.actorBuffer, 0, this.actors, 0, actors * ACTOR_WORDS);
    const [ox, oy] = camera.offset(vp.k);
    const up = this.upWords;
    up[0] = vp.cropX;
    up[1] = vp.cropY;
    up[2] = ox;
    up[3] = oy;
    up[4] = vp.k;
    up[5] = PixelViewport.BORDER;
    up[6] = iw;
    up[7] = ih;
    q.writeBuffer(this.upBuffer, 0, up);
    const v = this.view;
    v.k = vp.k;
    v.iw = iw;
    v.ih = ih;
    v.halfW = halfW;
    v.halfH = halfH;
    v.snapU = camera.snapU;
    v.snapV = camera.snapV;
    v.cropX = vp.cropX;
    v.cropY = vp.cropY;

    const P = this.pipelines;
    const scene = encoder.beginRenderPass({
      label: 'render.scene',
      colorAttachments: [{ view: color.createView(), loadOp: 'clear', storeOp: 'store', clearValue: this.clear }],
      depthStencilAttachment: { view: depth.createView(), depthLoadOp: 'clear', depthStoreOp: 'discard', depthClearValue: 1 },
    });
    scene.setBindGroup(0, this.sceneGroup);
    scene.setPipeline(P.ground);
    scene.draw(3);
    if (L && L.unitCap) {
      scene.setPipeline(P.units);
      scene.draw(12, L.unitCap);
    }
    if (L && L.shotCap) {
      scene.setPipeline(P.shots);
      scene.draw(12, L.shotCap);
    }
    if (actors) {
      scene.setPipeline(P.actors);
      scene.draw(12, actors);
    }
    scene.end();
    const out = encoder.beginRenderPass({
      label: 'render.upscale',
      colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store', clearValue: this.clear }],
    });
    out.setPipeline(P.upscale);
    out.setBindGroup(0, this.upGroup);
    out.draw(3);
    out.end();
  }

  /**
   * Reads back the internal image of the last rendered frame, tightly packed RGBA, top row first.
   * @returns {Promise<{ width: number, height: number, data: Uint8Array, view: FrameView, palette: Record<string, number> }>}
   */
  async capture() {
    const color = this.color;
    if (!color) throw new Error('renderer: nothing rendered yet');
    const w = color.width;
    const h = color.height;
    const row = Math.ceil((w * 4) / 256) * 256;
    const buf = this.device.createBuffer({ label: 'render.capture', size: row * h, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = this.device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: color }, { buffer: buf, bytesPerRow: row }, [w, h]);
    this.device.queue.submit([enc.finish()]);
    const view = { ...this.view };
    await buf.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(buf.getMappedRange());
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) data.set(src.subarray(y * row, y * row + w * 4), y * w * 4);
    buf.unmap();
    buf.destroy();
    return { width: w, height: h, data, view, palette: { ...this.paletteHex } };
  }

  destroy() {
    this.#dropOwned();
    for (const b of [this.frameBuffer, this.stylesBuffer, this.upBuffer, this.actorBuffer, this.empty]) b.destroy();
    this.color?.destroy();
    this.depth?.destroy();
  }
}
