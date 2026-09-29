// @ts-check

/**
 * How the engine worker learns that a new frame should start (ADR-007).
 * - `worker-raf`: requestAnimationFrame inside the worker (Chromium, Firefox).
 * - `message-ping`: the main thread's rAF posts a message (Safari; no shared memory).
 * - `atomics-ping`: the main thread's rAF bumps a shared word; the worker awaits it with Atomics.waitAsync.
 * @typedef {'worker-raf' | 'message-ping' | 'atomics-ping'} FrameDriverMode
 */

export class FrameDriver {
  /**
   * @param {FrameDriverMode} mode
   * @param {(timeMs: number) => void} onFrame
   * @param {{ pingWords?: Int32Array, pingIndex?: number }} [options] shared word for `atomics-ping`
   */
  constructor(mode, onFrame, options = {}) {
    this.mode = mode;
    this.onFrame = onFrame;
    this.running = false;
    this.frames = 0;
    this.pingWords = options.pingWords ?? null;
    this.pingIndex = options.pingIndex ?? 0;
    this.lastPing = 0;
    this.tick = this.tick.bind(this);
  }

  /** Picks the best mode available in this worker. @param {boolean} sharedPing */
  static detect(sharedPing) {
    if (typeof requestAnimationFrame === 'function') return 'worker-raf';
    return sharedPing && typeof Atomics.waitAsync === 'function' ? 'atomics-ping' : 'message-ping';
  }

  start() {
    if (this.running) return;
    this.running = true;
    if (this.mode === 'worker-raf') requestAnimationFrame(this.tick);
    else if (this.mode === 'atomics-ping') this.#waitPing();
  }

  stop() {
    this.running = false;
  }

  /** Message-ping entry point, called by the host's message handler. @param {number} timeMs */
  ping(timeMs) {
    if (this.running && this.mode === 'message-ping') this.tick(timeMs);
  }

  /** @param {number} timeMs */
  tick(timeMs) {
    if (!this.running) return;
    this.frames++;
    this.onFrame(timeMs);
    if (this.mode === 'worker-raf') requestAnimationFrame(this.tick);
  }

  async #waitPing() {
    const words = this.pingWords;
    if (!words) throw new Error('atomics-ping needs a shared ping word');
    while (this.running) {
      const seen = Atomics.load(words, this.pingIndex);
      if (seen === this.lastPing) {
        const r = Atomics.waitAsync(words, this.pingIndex, seen, 250);
        if (r.async) await r.value;
        continue;
      }
      this.lastPing = seen;
      this.tick(performance.now());
    }
  }
}
