// @ts-check

/**
 * Minimal WGSL preprocessor (docs/engine/03-rendering.md#render-graph).
 * - `#include "path"`: textual include, resolved relative to the including file; each file at most once.
 * - `#define NAME`, `#ifdef NAME`, `#ifndef NAME`, `#else`, `#endif`: feature flags.
 * Numeric parameters belong in WGSL `override` constants, not here.
 */
export class WgslPreprocessor {
  /** @param {(path: string) => Promise<string>} load returns the source of an absolute path such as `/engine/gpu/wgsl/fixed.wgsl` */
  constructor(load) {
    this.load = load;
    /** @type {Map<string, Promise<string>>} */
    this.cache = new Map();
  }

  /**
   * @param {string} path absolute path of the entry shader
   * @param {Iterable<string>} [defines] initially defined flags
   * @returns {Promise<string>}
   */
  async process(path, defines = []) {
    /** @type {Set<string>} */
    const flags = new Set(defines);
    /** @type {Set<string>} */
    const included = new Set();
    /** @type {string[]} */
    const out = [];
    await this.#expand(path, flags, included, out);
    return out.join('\n');
  }

  /** @param {string} path */
  #source(path) {
    let src = this.cache.get(path);
    if (!src) {
      src = this.load(path);
      this.cache.set(path, src);
    }
    return src;
  }

  /**
   * @param {string} path @param {Set<string>} flags @param {Set<string>} included @param {string[]} out
   */
  async #expand(path, flags, included, out) {
    if (included.has(path)) return;
    included.add(path);
    const lines = (await this.#source(path)).split('\n');
    /** @type {boolean[]} */
    const active = [];
    const on = () => active.every(Boolean);
    out.push(`// ---- ${path}`);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = /^\s*#(\w+)\s*(.*)$/.exec(line);
      if (!m) {
        if (on()) out.push(line);
        continue;
      }
      const [, directive, rest] = m;
      const arg = rest.trim();
      switch (directive) {
        case 'include': {
          const inc = /^"([^"]+)"$/.exec(arg);
          if (!inc) throw new Error(`${path}:${i + 1}: malformed #include`);
          if (on()) await this.#expand(WgslPreprocessor.resolve(path, inc[1]), flags, included, out);
          break;
        }
        case 'define':
          if (on()) flags.add(arg);
          break;
        case 'ifdef':
          active.push(flags.has(arg));
          break;
        case 'ifndef':
          active.push(!flags.has(arg));
          break;
        case 'else':
          if (!active.length) throw new Error(`${path}:${i + 1}: #else without #ifdef`);
          active[active.length - 1] = !active[active.length - 1];
          break;
        case 'endif':
          if (!active.length) throw new Error(`${path}:${i + 1}: #endif without #ifdef`);
          active.pop();
          break;
        default:
          throw new Error(`${path}:${i + 1}: unknown directive #${directive}`);
      }
    }
    if (active.length) throw new Error(`${path}: unterminated #ifdef`);
  }

  /** Resolves `target` relative to the directory of `from` (both absolute URL paths). @param {string} from @param {string} target */
  static resolve(from, target) {
    return new URL(target, `http://x${from}`).pathname;
  }

  /** Loader for browsers and workers: production bundles inline WGSL in PX_BUILD.shaders, dev fetches it. @param {string} path */
  static async fetchLoader(path) {
    if (typeof PX_BUILD !== 'undefined' && PX_BUILD && PX_BUILD.shaders[path] !== undefined) return PX_BUILD.shaders[path];
    const res = await fetch(path);
    if (!res.ok) throw new Error(`failed to load shader ${path}: ${res.status}`);
    return res.text();
  }
}
