// @ts-check
// GC pauses from Chrome trace events (the `v8` trace category), for the soak run (tools/soak/soak.js,
// docs/engine/10-tooling-testing.md#testing-strategy).
//
// A pause is time a JS thread (the page's main thread or a dedicated worker) spends inside the collector:
// - the atomic pauses: MinorGC (scavenges) and MajorGC (mark-compact finalization);
// - the incremental-marking steps V8 runs on the thread: V8.GCIncrementalMarking*, V8.GCFinalizeMC*.
// Their V8.GC* children nest inside them. Events are merged per thread, so each pause counts once.
// Background GC threads are not JS threads and never count.

/** @param {{ name: string, cat?: string }} e */
function isGc(e) {
  return e.name === 'MinorGC' || e.name === 'MajorGC' || (e.name.startsWith('V8.GC') && (e.cat ?? '').split(',').includes('v8'));
}

/** @param {string} thread */
function isJsThread(thread) {
  return thread === 'CrRendererMain' || thread.endsWith('Worker thread');
}

/** @param {number[]} values @param {number} q in [0, 1] */
export function percentile(values, q) {
  if (!values.length) return 0;
  const sorted = Float64Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

/** @param {number} v */
const r3 = (v) => Math.round(v * 1000) / 1000;

/**
 * @typedef {object} ThreadStats
 * @property {string} thread thread name and id
 * @property {number} pauses
 * @property {number} totalMs
 * @property {number} maxMs
 * @property {number} minor
 * @property {number} major
 * @property {number[]} heapAfter used heap after each MinorGC/MajorGC, in bytes
 * @property {number} freed bytes the MinorGCs freed: about what the thread allocated and dropped young
 */

export class GcStats {
  constructor() {
    /** Wall-clock pause durations, ms. @type {number[]} */
    this.pauses = [];
    /** Thread (CPU) time of the same pauses, ms: wall time minus descheduling. @type {number[]} */
    this.cpu = [];
    /** @type {Map<string, ThreadStats>} */
    this.threads = new Map();
    /** MajorGC reasons (the event's `type` argument) and how often each occurred. @type {Record<string, number>} */
    this.majorTypes = {};
    this.windows = 0;
    this.seconds = 0;
  }

  /**
   * Adds one trace window.
   * @param {{ traceEvents?: any[] } | any[]} trace a parsed Chrome trace
   * @param {number} seconds wall time the window covered
   */
  add(trace, seconds) {
    const events = Array.isArray(trace) ? trace : (trace.traceEvents ?? []);
    /** @type {Map<string, string>} pid:tid → thread name */
    const names = new Map();
    for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') names.set(`${e.pid}:${e.tid}`, e.args?.name ?? '');
    /** @type {Map<string, { s: number, e: number, cpu: number }[]>} GC spans per thread */
    const spans = new Map();
    for (const e of events) {
      if (e.ph !== 'X' || typeof e.name !== 'string' || !isGc(e)) continue;
      const name = names.get(`${e.pid}:${e.tid}`) ?? '';
      if (!isJsThread(name)) continue;
      const key = `${name} ${e.tid}`;
      const t = this.#thread(key);
      if (e.name === 'MinorGC' || e.name === 'MajorGC') {
        if (e.name === 'MinorGC') t.minor++;
        else {
          t.major++;
          const type = String(e.args?.type ?? 'unknown');
          this.majorTypes[type] = (this.majorTypes[type] ?? 0) + 1;
        }
        if (typeof e.args?.usedHeapSizeAfter === 'number') t.heapAfter.push(e.args.usedHeapSizeAfter);
        if (e.name === 'MinorGC' && typeof e.args?.usedHeapSizeBefore === 'number' && typeof e.args?.usedHeapSizeAfter === 'number') {
          t.freed += Math.max(0, e.args.usedHeapSizeBefore - e.args.usedHeapSizeAfter);
        }
      }
      let list = spans.get(key);
      if (!list) spans.set(key, (list = []));
      list.push({ s: e.ts, e: e.ts + (e.dur ?? 0), cpu: e.tdur ?? e.dur ?? 0 });
    }
    for (const [key, list] of spans) {
      const t = this.#thread(key);
      list.sort((a, b) => a.s - b.s || b.e - a.e); // outer events first
      let cur = null;
      for (const sp of list) {
        if (cur && sp.s < cur.e) {
          if (sp.e > cur.e) {
            cur.cpu += sp.cpu; // overlapping but not nested: both ran
            cur.e = sp.e;
          }
          continue; // nested: the outer event already covers it
        }
        if (cur) this.#pause(t, cur);
        cur = { ...sp };
      }
      if (cur) this.#pause(t, cur);
    }
    this.windows++;
    this.seconds += seconds;
  }

  /** @param {string} key */
  #thread(key) {
    let t = this.threads.get(key);
    if (!t) this.threads.set(key, (t = { thread: key, pauses: 0, totalMs: 0, maxMs: 0, minor: 0, major: 0, heapAfter: [], freed: 0 }));
    return t;
  }

  /** @param {ThreadStats} t @param {{ s: number, e: number, cpu: number }} span µs */
  #pause(t, span) {
    const ms = (span.e - span.s) / 1000;
    this.pauses.push(ms);
    this.cpu.push(span.cpu / 1000);
    t.pauses++;
    t.totalMs += ms;
    if (ms > t.maxMs) t.maxMs = ms;
  }

  summary() {
    const minutes = this.seconds / 60 || 1;
    let minor = 0;
    let major = 0;
    for (const t of this.threads.values()) {
      minor += t.minor;
      major += t.major;
    }
    const mb = (/** @type {number | undefined} */ b) => (b === undefined ? null : r3(b / 1048576));
    return {
      seconds: r3(this.seconds),
      windows: this.windows,
      pauses: {
        count: this.pauses.length,
        perMinute: r3(this.pauses.length / minutes),
        p50: r3(percentile(this.pauses, 0.5)),
        p99: r3(percentile(this.pauses, 0.99)),
        max: r3(this.pauses.reduce((m, v) => (v > m ? v : m), 0)),
        totalMs: r3(this.pauses.reduce((s, v) => s + v, 0)),
      },
      cpu: { p99: r3(percentile(this.cpu, 0.99)), max: r3(this.cpu.reduce((m, v) => (v > m ? v : m), 0)) },
      minor,
      major,
      majorTypes: this.majorTypes,
      threads: [...this.threads.values()]
        .sort((a, b) => b.totalMs - a.totalMs)
        .map((t) => ({
          thread: t.thread,
          pauses: t.pauses,
          totalMs: r3(t.totalMs),
          maxMs: r3(t.maxMs),
          minor: t.minor,
          major: t.major,
          freedMBPerMinute: r3(t.freed / 1048576 / minutes),
          heapAfterMB: { first: mb(t.heapAfter[0]), last: mb(t.heapAfter[t.heapAfter.length - 1]), max: mb(t.heapAfter.length ? t.heapAfter.reduce((m, v) => (v > m ? v : m), 0) : undefined) },
        })),
    };
  }
}
