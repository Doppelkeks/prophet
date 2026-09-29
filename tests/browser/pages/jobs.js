// @ts-check
// Browser side of tests/browser/jobs.spec.js. Like the real engine, the job system runs in a worker
// (jobs-engine.js) that spawns nested job workers; the page only relays requests.
const engine = new Worker(new URL('./jobs-engine.js', import.meta.url), { type: 'module', name: 'px-jobs-engine' });
let nextId = 1;
/** @type {Map<number, (result: any) => void>} */
const pending = new Map();
engine.onmessage = (e) => {
  const resolve = pending.get(e.data.id);
  pending.delete(e.data.id);
  resolve?.(e.data);
};
engine.onerror = (e) => {
  for (const resolve of pending.values()) resolve({ error: e.message || 'the engine worker failed to load' });
  pending.clear();
};

/** @param {'shared' | 'transfer' | 'inline'} tier @param {number} workers */
function runJobs(tier, workers) {
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    engine.postMessage({ id, tier, workers });
  });
}

Object.assign(window, { runJobs, __jobsReady: true });
