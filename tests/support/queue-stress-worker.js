// Producer or consumer thread for the JobQueue stress test (tests/unit/jobs.test.js).
// Consumers sleep on the wake word WITHOUT a timeout, so a lost wake-up hangs the test instead of
// being hidden by a retry.
import '../../engine/core/dev-global.js';
import { parentPort, workerData } from 'node:worker_threads';
import { Heap } from '../../engine/core/heap.js';
import { D, JobQueue } from '../../engine/jobs/job-queue.js';
import { Rng } from '../../engine/core/rng.js';
import { spin } from './test-kernels.js';

const { buffer, role, index, items, total, lane, seenOff, doneWord } = workerData;
const heap = Heap.attach(buffer);
const queue = new JobQueue(heap, heap.arena('jobs'));
const i32 = heap.i32;

if (role === 'producer') {
  const args = new Int32Array(6);
  for (let k = 0; k < items; k++) {
    const item = index * items + k;
    args[0] = item;
    while (!queue.push(lane, 0, 0, args, 0, 0, 0, 0, item)) spin(64); // lane full: back off and retry
    queue.wake(1);
    spin(Rng.mix32(item) & 127);
  }
} else {
  const desc = new Int32Array(16);
  for (;;) {
    const wake = Atomics.load(i32, queue.wakeW);
    if (queue.pop(lane, desc)) {
      const item = desc[D.ARGS];
      if (desc[D.JOB] !== item) throw new Error(`torn descriptor: job ${desc[D.JOB]} carries item ${item}`);
      Atomics.add(i32, (seenOff >> 2) + item, 1);
      spin(Rng.mix32(item ^ 0x5bd1e995) & 127);
      if (Atomics.add(i32, doneWord, 1) + 1 === total) {
        Atomics.store(i32, queue.stopW, 1);
        queue.wake(1 << 20);
      }
      continue;
    }
    if (Atomics.load(i32, queue.stopW)) break;
    Atomics.wait(i32, queue.wakeW, wake);
  }
}
parentPort?.postMessage('done');
