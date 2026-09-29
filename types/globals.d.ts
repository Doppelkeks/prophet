// Global declarations shared by engine and game code.

/** True in development. esbuild defines it as `false` in release builds; see engine/core/dev-global.js. */
declare var DEV: boolean;

/** Present only in production bundles: hashed URLs of worker entries and inlined WGSL sources (ADR-025). */
declare var PX_BUILD:
  | {
      workers: Record<string, string>;
      shaders: Record<string, string>;
      buildHash: string;
    }
  | undefined;

/** Exposed by the Electron preload (platforms/electron/preload.cjs); absent in browsers. */
interface ProphetHost {
  platform: string;
  versions: Record<string, string>;
  gpuUnavailable(): void;
}

interface Window {
  prophetHost?: ProphetHost;
  /** Test and debug surface; see engine/app/main-host.js. */
  __px?: import('../engine/app/main-host.js').DebugSurface;
}

interface Navigator {
  /** Chromium only. */
  deviceMemory?: number;
}

interface Atomics {
  waitAsync(
    typedArray: Int32Array,
    index: number,
    value: number,
    timeout?: number,
  ): { async: false; value: 'not-equal' | 'timed-out' } | { async: true; value: Promise<'ok' | 'timed-out'> };
}
