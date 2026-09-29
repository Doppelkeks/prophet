// @ts-check
import { Probes } from '../platform/probes.js';
import { Tiers } from '../platform/tiers.js';
import { DevReload } from './dev-reload.js';

/**
 * @typedef {object} DebugSurface  Read by tests and dev tools as `window.__px`.
 * @property {'booting' | 'ok' | 'unsupported' | 'error'} status
 * @property {import('../platform/probes.js').MainProbes} probes
 * @property {import('../platform/tiers.js').ThreadingTier} threading
 * @property {Record<string, any> | null} engine   engine-reported info (adapter, driver, tiers)
 * @property {number} frames                       frames rendered by the engine worker
 * @property {string | null} error
 */

/**
 * Main-thread host (ADR-007): probes capabilities, owns the DOM and input, and starts the engine
 * worker with the canvas transferred to it as an OffscreenCanvas.
 */
export class MainHost {
  /**
   * @param {{ canvas: HTMLCanvasElement, overlay: HTMLElement, engineWorkerUrl: URL }} options
   */
  constructor(options) {
    this.canvas = options.canvas;
    this.overlay = options.overlay;
    this.engineWorkerUrl = options.engineWorkerUrl;
    this.params = new URLSearchParams(globalThis.location ? location.search : '');
    this.probes = Probes.main();
    this.threading = Tiers.threading(this.probes, this.params.get('threading'));
    /** @type {DebugSurface} */
    this.debug = { status: 'booting', probes: this.probes, threading: this.threading, engine: null, frames: 0, error: null };
    /** @type {Worker | null} */
    this.worker = null;
    this.pinging = false;
    this.bootPanel = document.createElement('div');
    this.bootPanel.className = 'panel boot';
    this.ping = this.ping.bind(this);
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
    const worker = new Worker(this.engineWorkerUrl, { type: 'module', name: 'px-engine' });
    this.worker = worker;
    worker.onmessage = (e) => this.onMessage(e.data);
    worker.onerror = (e) => this.fail(`engine worker error: ${e.message}`);
    worker.postMessage(
      { type: 'init', canvas: offscreen, width, height, dpr, threading: this.threading, driver: this.params.get('driver') ?? 'auto' },
      { transfer: [offscreen] },
    );
  }

  /** @param {any} msg */
  onMessage(msg) {
    switch (msg.type) {
      case 'ready':
        this.debug.engine = msg.engine;
        this.debug.status = 'ok';
        if (msg.engine.driver === 'message-ping') this.startPinging();
        break;
      case 'stats':
        this.debug.frames = msg.frames;
        break;
      case 'error':
        this.fail(msg.message);
        break;
    }
    this.render();
  }

  startPinging() {
    if (this.pinging) return;
    this.pinging = true;
    requestAnimationFrame(this.ping);
  }

  /** @param {number} t */
  ping(t) {
    if (!this.pinging || !this.worker) return;
    this.worker.postMessage({ type: 'ping', t });
    requestAnimationFrame(this.ping);
  }

  /** @param {string} message */
  fail(message) {
    this.debug.status = 'error';
    this.debug.error = message;
    this.pinging = false;
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
      lines.push(`perf=${e.perfTier} driver=${e.driver} frames=${d.frames}`);
    }
    if (d.error) lines.push(`error: ${d.error}`);
    this.bootPanel.textContent = lines.join('\n');
  }
}
