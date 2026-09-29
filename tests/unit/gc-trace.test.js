// The soak run's GC statistics from Chrome trace events (tools/soak/gc-trace.js): nested GC events count
// once, background threads never, and every JS thread (page and workers) keeps its own numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GcStats, percentile } from '../../tools/soak/gc-trace.js';

const meta = (/** @type {number} */ tid, /** @type {string} */ name) => ({ ph: 'M', name: 'thread_name', pid: 1, tid, args: { name } });
const X = (/** @type {number} */ tid, /** @type {string} */ name, /** @type {number} */ ts, /** @type {number} */ dur, cat = 'devtools.timeline,v8', args = {}) => ({ ph: 'X', pid: 1, tid, name, cat, ts, dur, tdur: dur / 2, args });

test('GC pauses: nested events merge, background threads are skipped, heap and major reasons are kept', () => {
  const trace = {
    traceEvents: [
      meta(10, 'CrRendererMain'),
      meta(20, 'DedicatedWorker thread'),
      meta(30, 'ThreadPoolForegroundWorker'),
      X(20, 'MinorGC', 1000, 2000, 'devtools.timeline,v8', { usedHeapSizeAfter: 2 << 20 }),
      X(20, 'V8.GCScavenger', 1100, 1500, 'v8'), // inside the MinorGC
      X(20, 'V8.GCIncrementalMarking', 10000, 500, 'v8'),
      X(20, 'MajorGC', 20000, 4000, 'devtools.timeline,v8', { type: 'finalize incremental marking via task', usedHeapSizeAfter: 3 << 20 }),
      X(20, 'V8.GCFinalizeMC', 23500, 1000, 'v8'), // overlaps the MajorGC's end: one pause 20000..24500
      X(10, 'MinorGC', 5000, 1000, 'devtools.timeline,v8', { usedHeapSizeAfter: 1 << 20 }),
      X(30, 'V8.GCScavenger', 1000, 9000, 'v8'), // a background thread
      X(20, 'v8.callFunction', 0, 90000, 'v8'), // not GC
    ],
  };
  const g = new GcStats();
  g.add(trace, 60);
  g.add({ traceEvents: [meta(20, 'DedicatedWorker thread'), X(20, 'MinorGC', 0, 3000, 'devtools.timeline,v8', { usedHeapSizeAfter: 2 << 20 })] }, 60);
  const s = g.summary();
  assert.equal(s.pauses.count, 5, 'minor, incremental step, major (+ overlapping finalize), main-thread minor, window 2 minor');
  assert.deepEqual([...g.pauses].sort((a, b) => a - b), [0.5, 1, 2, 3, 4.5]);
  assert.equal(s.pauses.max, 4.5);
  assert.equal(s.pauses.perMinute, 2.5);
  assert.equal(s.minor, 3);
  assert.equal(s.major, 1);
  assert.deepEqual(s.majorTypes, { 'finalize incremental marking via task': 1 });
  assert.equal(s.windows, 2);
  const worker = s.threads.find((t) => t.thread === 'DedicatedWorker thread 20');
  assert.deepEqual(worker?.heapAfterMB, { first: 2, last: 2, max: 3 });
  assert.equal(s.threads.length, 2, 'the background thread is not a JS thread');
  assert.equal(percentile([], 0.99), 0);
  assert.equal(percentile([5, 1, 3], 0.5), 3);
});
