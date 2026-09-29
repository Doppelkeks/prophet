// @ts-check
// The platform report (docs/engine/08-platforms.md#measured-on-the-reference-devices): the M1 exit data for
// one machine. `?report` (or `?report=<seconds>`, default 30) plays the demo for a while, then collects:
// - identity: shell, browser, OS, adapter, features and limits;
// - tiers: crossOriginIsolated, the threading tier, the frame driver, the performance tier;
// - timings: pipeline warm-up, readback latency p95 and p99 (ms, and p99 in ticks for the K − 1 rule),
//   swarm GPU ms per tick, frame-time p99;
// - device loss: one round trip through recovery. Only in dev builds: release bundles compile the hook out.
// It prints one row of the matrix (Markdown, for docs/engine/08) and the whole report as JSON, in a panel
// and in `window.__px.report`.
import { TICK_HZ } from '../core/units.js';

const TICK_MS = 1000 / TICK_HZ;

/** The header of the "Measured" table in docs/engine/08-platforms.md; `row` fills one line of it. */
export const REPORT_HEADER =
  '| Date | Shell / browser | OS | Adapter | COI | Threading / driver | Tier | Warm-up | Readback p95 / p99 | Swarm GPU p95 | Frame p99 | Device loss |';

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polls `ok` every 50 ms until it holds or `timeout` ms passed. @param {() => boolean} ok @param {number} timeout */
async function until(ok, timeout) {
  const end = performance.now() + timeout;
  while (!ok()) {
    if (performance.now() > end) return false;
    await sleep(50);
  }
  return true;
}

/** @param {number | null | undefined} v @param {number} digits */
const fixed = (v, digits) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '?');

export class PlatformReport {
  /**
   * Runs the report once the engine is up.
   * @param {import('./main-host.js').MainHost} host
   * @param {{ seconds?: number, deviceLoss?: boolean, panel?: boolean }} [o]
   * @returns {Promise<Record<string, any>>}
   */
  static async run(host, o = {}) {
    const d = host.debug;
    const seconds = o.seconds ?? 30;
    const panel = o.panel === false ? null : PlatformReport.#panel(host);
    panel?.show(`Measuring this machine for ${seconds} s… keep the window in front.`);
    await until(() => d.status !== 'booting' && (d.status !== 'ok' || d.frames > 10), 120_000);
    if (d.status !== 'ok' || !d.engine) {
      const failed = { ok: false, error: d.error ?? `status ${d.status}`, probes: d.probes };
      d.report = failed;
      panel?.show(JSON.stringify(failed, null, 2));
      return failed;
    }
    const f0 = d.frames;
    const stalls0 = d.hud?.stalls ?? 0;
    const t0 = performance.now();
    await sleep(seconds * 1000);
    const elapsed = (performance.now() - t0) / 1000;
    const frames = d.frames - f0;
    const stalls = (d.hud?.stalls ?? 0) - stalls0;
    const perf = /** @type {Record<string, any>} */ (d.perf ?? {});
    const e = d.engine;
    const identity = await PlatformReport.identity();
    const deviceLoss = o.deviceLoss === false ? { tested: false, note: 'skipped' } : await PlatformReport.deviceLoss(host);
    const p95 = perf.readbackP95 ?? null;
    const p99 = perf.readbackP99 ?? null;
    /** @type {Record<string, any>} */
    const report = {
      ok: true,
      date: new Date().toISOString().slice(0, 10),
      shell: d.probes.electron ? 'Electron' : 'browser',
      browser: identity.browser,
      os: identity.os,
      userAgent: identity.userAgent,
      adapter: e.adapter,
      features: e.features,
      coi: d.probes.coi,
      threading: d.threading,
      driver: e.driver,
      rafInWorker: e.rafInWorker,
      perfTier: e.perfTier,
      jobWorkers: e.jobWorkers,
      cores: d.probes.cores,
      dpr: globalThis.devicePixelRatio || 1,
      render: e.render,
      swarm: e.swarm,
      warmup: e.warmup,
      seconds: Math.round(elapsed),
      fps: Math.round((frames / elapsed) * 10) / 10,
      frameMs: { p50: perf.frameP50 ?? null, p99: perf.frameP99 ?? null },
      readback: { p95Ms: p95, p99Ms: p99, p99Ticks: typeof p99 === 'number' ? Math.round((p99 / TICK_MS) * 100) / 100 : null, K: e.swarm?.K ?? null },
      swarmGpu: perf.swarmGpu ?? null,
      stalls,
      deviceLoss,
    };
    report.row = PlatformReport.row(report);
    d.report = report;
    panel?.show(`${REPORT_HEADER}\n${report.row}\n\n${JSON.stringify(report, null, 2)}`, report.row);
    return report;
  }

  /** Browser (or Electron) and OS, from UA client hints where the browser has them. */
  static async identity() {
    const ua = navigator.userAgent;
    let browser = '';
    let os = '';
    const uad = /** @type {any} */ (navigator).userAgentData;
    if (uad?.getHighEntropyValues) {
      try {
        const h = await uad.getHighEntropyValues(['platform', 'platformVersion', 'architecture', 'fullVersionList']);
        /** @type {{ brand: string, version: string }[]} */
        const brands = (h.fullVersionList ?? []).filter((/** @type {{ brand: string }} */ b) => !/not.?a.?brand/i.test(b.brand));
        const pick = brands.find((b) => b.brand !== 'Chromium') ?? brands[0];
        if (pick) browser = `${pick.brand} ${pick.version}`;
        let platform = [h.platform, h.platformVersion].filter(Boolean).join(' ');
        // UA-CH reports Windows 11 as platform version 13 or higher.
        if (h.platform === 'Windows') platform = Number(String(h.platformVersion).split('.')[0]) >= 13 ? 'Windows 11' : 'Windows 10';
        os = [platform, h.architecture].filter(Boolean).join(' ');
      } catch {
        // no client hints: fall back to the UA string
      }
    }
    const electron = /Electron\/([\d.]+)/.exec(ua);
    if (electron) browser = `Electron ${electron[1]}${browser ? ` (${browser})` : ''}`;
    if (!browser) {
      const firefox = /Firefox\/([\d.]+)/.exec(ua);
      const safari = /Version\/([\d.]+).*Safari/.exec(ua);
      browser = firefox ? `Firefox ${firefox[1]}` : safari ? `Safari ${safari[1]}` : ua;
    }
    if (!os) os = /\(([^)]+)\)/.exec(ua)?.[1] ?? '';
    return { browser, os, userAgent: ua };
  }

  /**
   * One device loss and the recovery after it: the time until the new device, swarm and renderer run,
   * and a second of frames after that.
   * @param {import('./main-host.js').MainHost} host
   */
  static async deviceLoss(host) {
    const d = host.debug;
    if (!DEV) return { tested: false, note: 'release build: no device-loss hook' };
    const before = d.device.recovered;
    const t0 = performance.now();
    d.loseDevice();
    const back = await until(() => d.device.recovered > before && d.device.state === 'ok', 30_000);
    const ms = Math.round(performance.now() - t0);
    if (!back) return { tested: true, recovered: false, reason: d.device.reason, ms };
    const f = d.frames;
    const running = await until(() => d.frames > f + 30, 15_000);
    return { tested: true, recovered: running, reason: d.device.reason, ms };
  }

  /** The report as one row of REPORT_HEADER. @param {Record<string, any>} r */
  static row(r) {
    const a = r.adapter ?? {};
    const adapter = `${a.vendor || '?'} ${a.architecture || '?'}${a.description ? ` (${a.description})` : ''}${a.isFallback ? ' (fallback)' : ''}`;
    const rb = r.readback;
    const loss = r.deviceLoss;
    const cells = [
      r.date,
      r.browser,
      r.os,
      adapter,
      r.coi ? 'yes' : '**no**',
      `${r.threading} / ${r.driver}`,
      r.perfTier,
      r.warmup ? `${Math.round(r.warmup.ms)} ms (${r.warmup.pipelines} pipelines)` : '?',
      `${fixed(rb.p95Ms, 1)} / ${fixed(rb.p99Ms, 1)} ms (p99 ${fixed(rb.p99Ticks, 2)} ticks, K = ${rb.K ?? '?'})`,
      r.swarmGpu ? `${fixed(r.swarmGpu.p95, 2)} ms` : 'no timestamps',
      `${fixed(r.frameMs.p99, 1)} ms`,
      loss.tested ? (loss.recovered ? `recovered in ${loss.ms} ms` : `**failed** (${loss.reason})`) : 'n/a (release build)',
    ];
    return `| ${cells.map((c) => String(c).replace(/\|/g, '/')).join(' | ')} |`;
  }

  /** A panel in the overlay, with a copy button once the row exists. @param {import('./main-host.js').MainHost} host */
  static #panel(host) {
    const panel = document.createElement('div');
    panel.className = 'panel report';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = 'Platform report';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = 'Copy row';
    copy.hidden = true;
    const text = document.createElement('pre');
    panel.append(title, copy, text);
    host.overlay.append(panel);
    return {
      /** @param {string} body @param {string} [row] */
      show(body, row) {
        text.textContent = body;
        copy.hidden = !row;
        copy.onclick = () => {
          if (row) navigator.clipboard?.writeText(row).then(() => (copy.textContent = 'Copied'), () => (copy.textContent = 'Copy failed'));
        };
      },
    };
  }
}
