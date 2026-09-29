// Worker thread for the bridge tests: an input-ring producer, or a state-block writer that races the reader.
import '../../engine/core/dev-global.js';
import { parentPort, workerData } from 'node:worker_threads';
import { InputRing } from '../../engine/input/input-ring.js';
import { StateBlockWriter, StateSchema } from '../../engine/ui/state-block.js';

const { role, buffer } = workerData;
const i32 = new Int32Array(buffer);
if (role === 'producer') {
  const ring = new InputRing(i32, 0, workerData.capacity);
  for (let n = 0; n < workerData.count; ) {
    if (ring.push(1, n, ~n, Math.imul(n, 3))) n++;
  }
} else {
  const schema = new StateSchema(Object.fromEntries(Array.from({ length: workerData.fields }, (_, i) => [`f${i}`, 'i32'])));
  const writer = new StateBlockWriter(i32, 0, schema);
  const stop = workerData.fields + 8; // a word after the block
  for (let v = 1; Atomics.load(i32, stop) === 0; v++) {
    writer.begin();
    for (let w = 1; w <= workerData.fields; w++) writer.set(w, v);
    writer.end();
  }
}
parentPort?.postMessage('done');
