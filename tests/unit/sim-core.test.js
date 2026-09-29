// SimCore runs the real game module headless: PATCH moves from input records, a command log replays
// a run exactly, and the threading tier doesn't change the result.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { SimBoot } from '../../engine/app/sim-boot.js';
import { Heap } from '../../engine/core/heap.js';
import { CommandLog } from '../../engine/input/command-log.js';
import { InputRecord } from '../../engine/input/input-record.js';
import { WorkerPorts } from '../../engine/jobs/worker-port.js';
import { Transform } from '../../game/components/index.js';
import { ARENA_HALF, PATCH_SPEED } from '../../game/data/arena.js';
import { SCRAPWAKE } from '../../game/app/game.js';
import { TestRandom } from '../support/vectors.js';

const GAME_WORKER = new URL('../support/game-job-worker.js', import.meta.url);

/** @param {{ tier?: 'inline' | 'shared', workers?: number, log?: CommandLog }} [o] */
async function boot(o = {}) {
  const tier = o.tier ?? 'inline';
  return SimBoot.create({
    game: SCRAPWAKE,
    heap: Heap.create('test', tier === 'shared'),
    tier,
    workers: o.workers ?? 0,
    spawn: (i) => WorkerPorts.wrapNode(new Worker(GAME_WORKER, { name: `px-game-${i}` })),
    log: o.log,
    hashEvery: 10,
    parallel: tier === 'shared' ? 'always' : 'never',
  });
}

/** @param {import('../../engine/app/sim-core.js').SimCore} sim */
const patch = (sim) => [sim.world.get(sim.resources.patch, Transform.x), sim.world.get(sim.resources.patch, Transform.y)];

test('PATCH moves by its speed per tick and stays inside the arena', async () => {
  const { sim } = await boot();
  const [right] = InputRecord.pack(127, 0, 0, 0, 0, 0);
  for (let t = 0; t < 60; t++) {
    sim.stamp(right, 0);
    await sim.step();
  }
  assert.deepEqual(patch(sim), [60 * PATCH_SPEED, 0], 'one second at full speed');
  const [downLeft] = InputRecord.pack(-90, -90, 0, 0, 0, 0);
  for (let t = 0; t < 60 * 60; t++) {
    sim.stamp(downLeft, 0);
    await sim.step();
  }
  assert.deepEqual(patch(sim), [-ARENA_HALF, -ARENA_HALF], 'clamped at the arena edge');
  assert.equal(sim.tick, 60 * 61);
});

test('a command log replays a run exactly, and the threading tier does not change it', { timeout: 60000 }, async () => {
  const live = await boot();
  const rnd = new TestRandom(4242);
  let move = [0, 0];
  for (let t = 0; t < 600; t++) {
    if (rnd.below(20) === 0) move = [rnd.below(255) - 127, rnd.below(255) - 127];
    const [w0, w1] = InputRecord.pack(move[0], move[1], 0, 0, 0, 0);
    live.sim.stamp(w0, w1);
    await live.sim.step();
  }
  assert.equal(live.sim.hashes.length, 2 * 60);
  const json = JSON.parse(JSON.stringify(live.sim.log));

  const replay = await boot({ log: CommandLog.fromJSON(json) });
  assert.equal(await replay.sim.replay(), 600);
  assert.deepEqual(replay.sim.hashes, live.sim.hashes);
  assert.deepEqual(patch(replay.sim), patch(live.sim));

  const threaded = await boot({ tier: 'shared', workers: 2, log: CommandLog.fromJSON(json) });
  try {
    await threaded.sim.replay();
    assert.deepEqual(threaded.sim.hashes, live.sim.hashes);
    assert.ok(threaded.sim.scheduler.stats.parallelChunks > 0, 'movement ran through the job system');
  } finally {
    await threaded.jobs.shutdown();
  }
  await assert.rejects(replay.sim.step(), /no input record for tick 600/);
});
