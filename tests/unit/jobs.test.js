// The job system on real threads: node:worker_threads over a shared WebAssembly.Memory
// (docs/engine/02-core-ecs-jobs.md#testing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { Heap } from '../../engine/core/heap.js';
import { BumpArena } from '../../engine/core/arenas.js';
import { JobQueue } from '../../engine/jobs/job-queue.js';
import { JobSystem } from '../../engine/jobs/job-system.js';
import { KernelRegistry } from '../../engine/jobs/kernel.js';
import { WorkerPorts } from '../../engine/jobs/worker-port.js';
import { CountKernel, SquareKernel, TEST_KERNELS, ThrowKernel, testRegistry } from '../support/test-kernels.js';
import { JobScenario } from '../support/job-scenario.js';

const JOB_WORKER = new URL('../support/test-job-worker.js', import.meta.url);
const STRESS_WORKER = new URL('../support/queue-stress-worker.js', import.meta.url);

/** @param {Record<string, unknown>} [workerData] */
const spawner = (workerData = {}) => (/** @type {number} */ i) => WorkerPorts.wrapNode(new Worker(JOB_WORKER, { workerData, name: `px-job-${i}` }));

/**
 * @param {{ tier: 'shared' | 'transfer' | 'inline', workers?: number, stale?: boolean, onJobError?: (job: number, key: string, err: unknown) => void }} o
 */
async function jobSystem(o) {
  const heap = Heap.create('test', o.tier === 'shared');
  return JobSystem.create({
    tier: o.tier,
    heap,
    registry: testRegistry(),
    workers: o.workers ?? 0,
    spawn: spawner({ stale: !!o.stale }),
    waitMs: Infinity, // no safety-net timeout: a lost wake-up would hang the test
    onJobError: o.onJobError ?? (() => {}),
  });
}

/** Polls `cond` until it holds (at most 5 s). @param {() => boolean} cond @param {string} what */
async function until(cond, what) {
  for (let t = 0; t < 500 && !cond(); t++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(cond(), what);
}

/** A zeroed counter per item at the start of the ECS arena. @param {JobSystem} jobs @param {number} n */
function hitsRegion(jobs, n) {
  const off = new BumpArena(jobs.heap.arena('ecs')).alloc(n * 4, 64);
  jobs.heap.i32.fill(0, off >> 2, (off >> 2) + n);
  return { off, at: (/** @type {number} */ i) => jobs.heap.i32[(off >> 2) + i] };
}

test('the kernel registry numbers kernels by key, whatever the import order', () => {
  const a = new KernelRegistry(TEST_KERNELS);
  const b = new KernelRegistry([...TEST_KERNELS].reverse());
  assert.equal(a.hash, b.hash);
  for (const K of TEST_KERNELS) assert.equal(a.id(K), b.id(K));
  assert.notEqual(new KernelRegistry(TEST_KERNELS.slice(1)).hash, a.hash);
  class Unkeyed extends SquareKernel {
    static key = '';
  }
  assert.throws(() => new KernelRegistry([Unkeyed]), /static key/);
  assert.throws(() => new KernelRegistry([SquareKernel, SquareKernel]), /duplicate kernel key/);
});

test('JobQueue: many producers and consumers, every descriptor popped exactly once, no lost wake-up', { timeout: 60000 }, async () => {
  const producers = 4;
  const consumers = 4;
  const items = 25000;
  const total = producers * items;
  for (const lane of [JobQueue.CRIT, JobQueue.BG]) {
    const heap = Heap.create('test', true);
    const queue = new JobQueue(heap, heap.arena('jobs'));
    queue.format();
    const scratch = new BumpArena(heap.arena('ecs'));
    const seenOff = scratch.alloc(total * 4, 64);
    const doneWord = scratch.alloc(64, 64) >> 2;
    const threads = [];
    for (let c = 0; c < consumers; c++) {
      threads.push(new Worker(STRESS_WORKER, { workerData: { buffer: heap.buffer, role: 'consumer', index: c, items, total, lane, seenOff, doneWord } }));
    }
    for (let p = 0; p < producers; p++) {
      threads.push(new Worker(STRESS_WORKER, { workerData: { buffer: heap.buffer, role: 'producer', index: p, items, total, lane, seenOff, doneWord } }));
    }
    await Promise.all(
      threads.map(
        (w) =>
          new Promise((resolve, reject) => {
            w.on('message', resolve);
            w.on('error', reject);
          }),
      ),
    );
    await Promise.all(threads.map((w) => w.terminate()));
    assert.equal(Atomics.load(heap.i32, doneWord), total);
    let wrong = 0;
    for (let i = 0; i < total; i++) if (heap.i32[(seenOff >> 2) + i] !== 1) wrong++;
    assert.equal(wrong, 0, `lane ${lane}: items popped zero or several times`);
    assert.equal(queue.pop(lane, new Int32Array(16)), false, 'the lane is empty');
  }
});

test('parallel-for runs every item exactly once, for any worker count and grain', { timeout: 60000 }, async () => {
  for (const workers of [0, 1, 3]) {
    const jobs = await jobSystem({ tier: 'shared', workers });
    try {
      for (const [begin, end, grain] of [
        [0, 1, 1],
        [5, 5000, 1],
        [17, 40017, 7],
        [0, 9999, 64],
        [100, 60000, 20000],
        [3, 4, 100],
      ]) {
        const hits = hitsRegion(jobs, end);
        await jobs.wait(jobs.parallelFor(CountKernel, [hits.off, 0x9e3779b9 ^ grain], begin, end, grain));
        for (let i = 0; i < end; i++) {
          if (hits.at(i) !== (i >= begin ? 1 : 0)) assert.fail(`workers=${workers} grain=${grain}: item ${i} ran ${hits.at(i)} times`);
        }
      }
      assert.equal(jobs.slotsInUse, 0, 'waiting frees every slot');
    } finally {
      await jobs.shutdown();
    }
  }
});

test('hundreds of jobs in flight on both lanes each complete exactly once', { timeout: 60000 }, async () => {
  const jobs = await jobSystem({ tier: 'shared', workers: 3 });
  try {
    const n = 400;
    const width = 50;
    const hits = hitsRegion(jobs, n * width);
    const handles = [];
    for (let j = 0; j < n; j++) {
      handles.push(
        j % 3 === 0
          ? jobs.parallelFor(CountKernel, [hits.off, j + 1], j * width, (j + 1) * width, 1 + (j % 13))
          : jobs.submit(CountKernel, { args: [hits.off, j + 1], begin: j * width, end: (j + 1) * width }),
      );
    }
    assert.equal(jobs.slotsInUse, n);
    // Wait in a scrambled order: completion must not depend on the order of waits.
    for (let k = 0; k < n; k++) await jobs.wait(handles[(k * 7919) % n]);
    for (let i = 0; i < n * width; i++) if (hits.at(i) !== 1) assert.fail(`item ${i} ran ${hits.at(i)} times`);
    assert.equal(jobs.slotsInUse, 0);
  } finally {
    await jobs.shutdown();
  }
});

test('shared, transfer and inline tiers produce byte-identical outputs', { timeout: 60000 }, async () => {
  /** @type {Record<string, number>} */
  const hashes = {};
  for (const [tier, workers] of /** @type {const} */ ([
    ['inline', 0],
    ['shared', 0],
    ['shared', 1],
    ['shared', 3],
    ['transfer', 0],
    ['transfer', 2],
  ])) {
    const jobs = await jobSystem({ tier, workers });
    try {
      hashes[`${tier}/${workers}`] = await JobScenario.run(jobs);
    } finally {
      await jobs.shutdown();
    }
  }
  const distinct = new Set(Object.values(hashes));
  assert.equal(distinct.size, 1, `tier hashes differ: ${JSON.stringify(hashes)}`);
});

test('a kernel that throws fails its own job only, in every tier', { timeout: 60000 }, async () => {
  for (const [tier, workers] of /** @type {const} */ ([
    ['inline', 0],
    ['shared', 2],
    ['transfer', 2],
  ])) {
    /** @type {string[]} */
    const reported = [];
    const jobs = await jobSystem({ tier, workers, onJobError: (job, key) => reported.push(key) });
    try {
      const bad = jobs.parallelFor(ThrowKernel, [500], 0, 1000, 100);
      await assert.rejects(jobs.wait(bad), /job-failed/);
      const badAsync = jobs.submit(ThrowKernel, { args: [0], begin: 0, end: 10 });
      await assert.rejects(jobs.wait(badAsync), /job-failed/);
      // Job workers report failures by message, which can land after the counter reached zero.
      await until(() => reported.filter((k) => k === 'test.throw').length >= 2, `${tier}: both failures are reported`);
      // The system keeps working.
      const hits = hitsRegion(jobs, 1000);
      await jobs.wait(jobs.parallelFor(CountKernel, [hits.off, 0], 0, 1000, 10));
      for (let i = 0; i < 1000; i++) assert.equal(hits.at(i), 1);
      await assert.rejects(jobs.wait(bad), /already waited/);
    } finally {
      await jobs.shutdown();
    }
  }
});

test('job workers built from a stale kernel list are refused (manifest-mismatch)', { timeout: 30000 }, async () => {
  for (const tier of /** @type {const} */ (['shared', 'transfer'])) {
    await assert.rejects(jobSystem({ tier, workers: 2, stale: true }), /manifest-mismatch/);
  }
});

test('shutdown stops shared-tier workers through the stop flag', { timeout: 30000 }, async () => {
  const jobs = await jobSystem({ tier: 'shared', workers: 3 });
  await jobs.shutdown();
  assert.equal(jobs.stopped, 3);
  assert.equal(jobs.workers.length, 0);
});

test('the transfer tier pools its buffers', { timeout: 30000 }, async () => {
  const jobs = await jobSystem({ tier: 'transfer', workers: 2 });
  try {
    const hits = hitsRegion(jobs, 1000);
    for (let r = 0; r < 50; r++) {
      await jobs.wait(
        jobs.submit(CountKernel, { args: [hits.off, 0], begin: 0, end: 1000, regions: [{ arg: 0, bytes: 4000, access: 'readwrite' }] }),
      );
    }
    for (let i = 0; i < 1000; i++) assert.equal(hits.at(i), 50);
    assert.equal(jobs.dispatcher?.buffersCreated, 1);
    assert.throws(
      () => jobs.submit(CountKernel, { args: [jobs.heap.bytes - 16, 0], regions: [{ arg: 0, bytes: 64, access: 'read' }] }),
      /outside the heap/,
    );
  } finally {
    await jobs.shutdown();
  }
});
