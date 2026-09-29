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
import { RunStats, Transform } from '../../game/components/index.js';
import { SwarmReference } from '../../engine/swarm/reference/swarm-reference.js';
import { ARENA_HALF, PATCH_SPEED } from '../../game/data/arena.js';
import { SCRAPWAKE } from '../../game/app/game.js';
import { TestRandom } from '../support/vectors.js';

const GAME_WORKER = new URL('../support/game-job-worker.js', import.meta.url);
const TICKS = 1200;

/**
 * @param {{ tier?: 'inline' | 'shared', workers?: number, log?: CommandLog, swarm?: boolean, delay?: (tick: number) => number }} [o]
 */
async function boot(o = {}) {
  const tier = o.tier ?? 'inline';
  /** @type {SwarmReference | null} */
  let reference = null;
  const booted = await SimBoot.create({
    game: SCRAPWAKE,
    heap: Heap.create('test', tier === 'shared'),
    tier,
    workers: o.workers ?? 0,
    spawn: (i) => WorkerPorts.wrapNode(new Worker(GAME_WORKER, { name: `px-game-${i}` })),
    log: o.log,
    hashEvery: 10,
    parallel: tier === 'shared' ? 'always' : 'never',
    swarm: o.swarm ? (layout, tables, seed) => (reference = new SwarmReference(layout, tables, { seed, delay: o.delay })) : undefined,
    swarmProfile: 'test',
  });
  return { ...booted, reference: /** @type {SwarmReference | null} */ (reference) };
}

/** Runs a sim through its log; stalled ticks let the reference swarm deliver. @param {Awaited<ReturnType<typeof boot>>} b */
async function replay(b) {
  return b.sim.replay(0x7fffffff, () => b.reference?.pump());
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

test('a command log replays a run exactly: readback delays and the threading tier do not change it', { timeout: 120000 }, async () => {
  const live = await boot({ swarm: true });
  const rnd = new TestRandom(4242);
  let move = [0, 0];
  for (let t = 0; t < TICKS; t++) {
    if (rnd.below(20) === 0) move = rnd.below(4) ? [0, 0] : [rnd.below(255) - 127, rnd.below(255) - 127];
    const [w0, w1] = InputRecord.pack(move[0], move[1], 0, 0, 0, 0);
    live.sim.stamp(w0, w1);
    assert.equal(await live.sim.step(), true, 'no delay, no stall');
  }
  assert.equal(live.sim.hashes.length, 2 * (TICKS / 10), "flat [tick, hash] pairs every 10 ticks");
  const world = live.sim.world;
  const run = live.sim.resources.run;
  assert.ok(world.get(run, RunStats.kills) > 0, `the swarm spawned, got shot and died (${world.get(run, RunStats.kills)} kills)`);
  assert.ok(world.get(run, RunStats.damage) > 0, 'contact damage reached PATCH');
  const json = JSON.parse(JSON.stringify(live.sim.log));
  const swarmHash = live.reference?.hash();

  const delayed = await boot({ swarm: true, log: CommandLog.fromJSON(json), delay: (t) => (Math.imul(t ^ 0x5bd1e995, 0x9e3779b1) >>> 28) % 7 });
  assert.equal(await replay(delayed), TICKS);
  assert.ok(delayed.sim.stalls > 0, 'late blocks stalled some ticks');
  assert.deepEqual(delayed.sim.hashes, live.sim.hashes);
  assert.equal(delayed.reference?.hash(), swarmHash);

  const threaded = await boot({ swarm: true, tier: 'shared', workers: 2, log: CommandLog.fromJSON(json) });
  try {
    await replay(threaded);
    assert.deepEqual(threaded.sim.hashes, live.sim.hashes);
    assert.ok(threaded.sim.scheduler.stats.parallelChunks > 0, 'movement ran through the job system');
  } finally {
    await threaded.jobs.shutdown();
  }
  await assert.rejects(delayed.sim.step(), new RegExp(`no input record for tick ${TICKS}`));
});
