// Chromium switches per OS/GPU (docs/engine/08-platforms.md#desktop-electron).
// All switches must be appended before `app.ready`, and all enable-features values go into ONE switch.
import { existsSync, readdirSync, readFileSync } from 'node:fs';

/** @typedef {'none' | 'unsafe' | 'amd' | 'swiftshader'} SwitchSet */

export class GpuSwitches {
  /** Always applied: keep the game running at full speed when in the background. */
  static BASE = ['disable-renderer-backgrounding', 'disable-background-timer-throttling', 'force_high_performance_gpu'];

  /** @type {Record<SwitchSet, { switches: [string, string?][], features: string[] }>} */
  static SETS = {
    none: { switches: [], features: [] },
    unsafe: { switches: [['enable-unsafe-webgpu']], features: [] },
    // Linux AMD incl. Steam Deck / Steam Machine: WebGPU is still behind a flag there (Chromium 152).
    amd: {
      switches: [['enable-unsafe-webgpu'], ['ozone-platform', 'x11'], ['use-angle', 'vulkan']],
      features: ['Vulkan', 'VulkanFromANGLE'],
    },
    // CI / containers without a GPU (verified under xvfb): software GL via ANGLE + SwiftShader Vulkan for WebGPU.
    swiftshader: {
      switches: [['enable-unsafe-webgpu'], ['enable-unsafe-swiftshader'], ['use-angle', 'swiftshader'], ['use-webgpu-adapter', 'swiftshader']],
      features: [],
    },
  };

  /**
   * @param {string} platform process.platform
   * @param {string} arch process.arch
   * @returns {SwitchSet}
   */
  static detect(platform, arch) {
    if (platform === 'win32' && arch === 'arm64') return 'unsafe';
    if (platform === 'linux' && GpuSwitches.isAmdOrSteamDevice()) return 'amd';
    return 'none';
  }

  /** Linux: AMD GPU (PCI vendor 0x1002) or a Valve board (Steam Deck, Steam Machine). */
  static isAmdOrSteamDevice() {
    try {
      const board = '/sys/class/dmi/id/board_vendor';
      if (existsSync(board) && /valve/i.test(readFileSync(board, 'utf8'))) return true;
      const drm = '/sys/class/drm';
      if (!existsSync(drm)) return false;
      for (const name of readdirSync(drm)) {
        const vendorFile = `${drm}/${name}/device/vendor`;
        if (/^card\d+$/.test(name) && existsSync(vendorFile) && readFileSync(vendorFile, 'utf8').trim() === '0x1002') return true;
      }
    } catch {
      /* unreadable sysfs: assume no special handling */
    }
    return false;
  }

  /**
   * @param {Electron.App} app
   * @param {{ override?: string, alternate?: boolean }} options
   * @returns {SwitchSet} the applied set
   */
  static apply(app, options) {
    /** @type {SwitchSet} */
    let set = GpuSwitches.isSet(options.override) ? options.override : GpuSwitches.detect(process.platform, process.arch);
    // Relaunch after "no adapter": try the other set once.
    if (options.alternate) set = set === 'amd' ? 'unsafe' : 'amd';
    for (const name of GpuSwitches.BASE) app.commandLine.appendSwitch(name);
    const { switches, features } = GpuSwitches.SETS[set];
    for (const [name, value] of switches) {
      if (value === undefined) app.commandLine.appendSwitch(name);
      else app.commandLine.appendSwitch(name, value);
    }
    // Diagnostics: PX_EXTRA_SWITCHES="name,name=value,..." (enable-features values are merged, not appended).
    const merged = [...features];
    for (const item of (process.env.PX_EXTRA_SWITCHES ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
      const eq = item.indexOf('=');
      const name = eq < 0 ? item : item.slice(0, eq);
      const value = eq < 0 ? undefined : item.slice(eq + 1);
      if (name === 'enable-features' && value) merged.push(...value.split('+'));
      else if (value === undefined) app.commandLine.appendSwitch(name);
      else app.commandLine.appendSwitch(name, value);
    }
    if (merged.length) app.commandLine.appendSwitch('enable-features', merged.join(','));
    return set;
  }

  /** @param {string | undefined} value @returns {value is SwitchSet} */
  static isSet(value) {
    return value === 'none' || value === 'unsafe' || value === 'amd' || value === 'swiftshader';
  }
}
