// The scheduler: plan validation, and serial vs chunk-parallel runs on real worker threads
// (docs/engine/02-core-ecs-jobs.md#testing: serial vs parallel).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { Heap } from '../../engine/core/heap.js';
import { EcsEnv } from '../../engine/ecs/ecs-env.js';
import { Manifest } from '../../engine/ecs/registry.js';
import { Scheduler } from '../../engine/ecs/scheduler.js';
import { System } from '../../engine/ecs/system.js';
import { World } from '../../engine/ecs/world.js';
import { JobSystem } from '../../engine/jobs/job-system.js';
import { WorkerPorts } from '../../engine/jobs/worker-port.js';
import { FIGHTER, Glow, Hp, Pos, SAMPLE_ARCHETYPES, SAMPLE_MANIFEST, Target, Vel } from '../support/ecs-sample.js';
import { TestRandom } from '../support/vectors.js';

const ECS_WORKER = new URL('../support/ecs-job-worker.js', import.meta.url);
const COMPONENTS = SAMPLE_MANIFEST.components;

/** @param {string} key @param {Partial<typeof System>} statics */
function sys(key, statics) {
  const S = class extends System {};
  Object.assign(S, { key, ...statics });
  return S;
}

test('the serial order is Kahn with the lowest system ID first, per stage', () => {
  const A = sys('p.a', { stage: 'Sim' });
  const B = sys('p.b', { stage: 'Sim', before: ['p.a'] });
  const C = sys('p.c', { stage: 'Sim' });
  const D = sys('p.d', { stage: 'Sim', after: [C] });
  const E = sys('p.e', { stage: 'PreSim', before: [A] }); // across stages: already ordered, no edge
  const m = new Manifest({ components: COMPONENTS, systems: [E, D, C, B, A] });
  const plan = Scheduler.plan(m);
  const keys = (/** @type {number[]} */ ids) => ids.map((id) => m.systems[id].key);
  assert.deepEqual(keys(plan.order.Sim), ['p.b', 'p.a', 'p.c', 'p.d']);
  assert.deepEqual(keys(plan.order.PreSim), ['p.e']);
  assert.deepEqual(plan.order.Input, []);
  assert.deepEqual(plan.warnings, []);
});

test('boot errors: cycles, render-only data in sim systems, edges against the stage order', () => {
  const A = sys('c.a', { stage: 'Sim', after: ['c.b'] });
  const B = sys('c.b', { stage: 'Sim', after: ['c.a'] });
  assert.throws(() => Scheduler.plan(new Manifest({ components: COMPONENTS, systems: [A, B] })), /system cycle in stage Sim: c\.a, c\.b/);
  const R = sys('r.sim', { stage: 'Sim', reads: [Glow] });
  assert.throws(() => Scheduler.plan(new Manifest({ components: COMPONENTS, systems: [R] })), /render-only component sample\.glow/);
  const X = sys('r.extract', { stage: 'Extract', reads: [Glow], writes: [Glow] });
  assert.doesNotThrow(() => Scheduler.plan(new Manifest({ components: COMPONENTS, systems: [X] })));
  const Late = sys('o.late', { stage: 'PostSim', before: ['o.early'] });
  const Early = sys('o.early', { stage: 'PreSim' });
  assert.throws(() => Scheduler.plan(new Manifest({ components: COMPONENTS, systems: [Late, Early] })), /can't run before/);
  const Bad = sys('o.bad', { stage: /** @type {any} */ ('Physics') });
  assert.throws(() => Scheduler.plan(new Manifest({ components: COMPONENTS, systems: [Bad] })), /unknown stage/);
});

test('conflicting systems get conflict edges, and a warning when their order is implicit', () => {
  const W = sys('w.writer', { stage: 'Sim', writes: [Pos] });
  const R = sys('w.reader', { stage: 'Sim', reads: [Pos] });
  const O = sys('w.ordered', { stage: 'Sim', reads: [Pos], after: [W] });
  const m = new Manifest({ components: COMPONENTS, systems: [W, R, O] });
  const plan = Scheduler.plan(m);
  const conflicts = plan.edges.filter((e) => e[2] === 'conflict').map(([a, b]) => `${m.systems[a].key}>${m.systems[b].key}`);
  assert.deepEqual(conflicts.sort(), ['w.reader>w.writer', 'w.writer>w.ordered']);
  assert.equal(plan.warnings.length, 1);
  assert.match(plan.warnings[0], /w\.reader and w\.writer both touch sample\.pos/);
});

/**
 * The sample game with 1,200 fighters.
 * @param {{ workers?: number | null, grain?: number }} [o] workers = null: serial, no job system
 */
async function sampleSim(o = {}) {
  const workers = o.workers ?? null;
  const manifest = new Manifest(SAMPLE_MANIFEST);
  const shared = workers !== null;
  const heap = Heap.create('test', shared);
  const world = new World(heap, manifest, { capacity: 8192, chunkBytes: 2048, participants: (workers ?? 0) + 1 });
  assert.equal(world.archetype(FIGHTER), SAMPLE_ARCHETYPES.fighter);
  assert.equal(world.archetype([...FIGHTER, Glow]), SAMPLE_ARCHETYPES.fighterGlow);
  const env = new EcsEnv(heap, manifest, 0, {});
  const jobs = shared
    ? await JobSystem.create({
        tier: 'shared',
        heap,
        registry: manifest.kernels,
        workers: /** @type {number} */ (workers),
        env,
        waitMs: Infinity,
        spawn: (i) => WorkerPorts.wrapNode(new Worker(ECS_WORKER, { name: `px-ecs-${i}` })),
      })
    : null;
  const scheduler = new Scheduler({ world, env, jobs, parallel: shared ? 'always' : 'never', grain: o.grain ?? 1 });
  const rnd = new TestRandom(99);
  const es = [];
  for (let i = 0; i < 1200; i++) {
    const e = world.spawn(i % 5 ? SAMPLE_ARCHETYPES.fighter : SAMPLE_ARCHETYPES.fighterGlow);
    world.set(e, Pos.x, rnd.below(8000) - 4000);
    world.set(e, Pos.y, rnd.below(8000) - 4000);
    world.set(e, Vel.vx, rnd.below(41) - 20);
    world.set(e, Vel.vy, rnd.below(41) - 20);
    world.set(e, Hp.hp, 50 + rnd.below(100));
    world.set(e, Hp.armor, rnd.below(2));
    es.push(e);
  }
  for (const e of es) world.set(e, Target.e, es[rnd.below(es.length)]);
  return { world, scheduler, jobs };
}

/** @param {Awaited<ReturnType<typeof sampleSim>>} sim @param {number} ticks */
async function run(sim, ticks) {
  const hashes = [];
  const sizes = [];
  for (let t = 0; t < ticks; t++) {
    await sim.scheduler.tick();
    await sim.scheduler.extract();
    hashes.push(sim.world.hash());
    sizes.push(sim.world.size);
  }
  return { hashes, sizes };
}

test('serial and chunk-parallel runs produce the same state hash on every tick', { timeout: 120000 }, async () => {
  const TICKS = 150;
  const serial = await sampleSim();
  const expected = await run(serial, TICKS);
  assert.equal(serial.scheduler.stats.parallelChunks, 0);
  assert.ok(new Set(expected.hashes).size > TICKS * 0.9, 'the state changes every tick');
  assert.ok(Math.min(...expected.sizes) !== Math.max(...expected.sizes), 'entities die and spawn');
  assert.ok(serial.world.archetypes.length > 3, 'tags moved rows into new archetypes');

  for (const [workers, grain] of [
    [0, 1],
    [1, 1],
    [3, 1],
    [3, 3],
  ]) {
    const sim = await sampleSim({ workers, grain });
    try {
      const got = await run(sim, TICKS);
      const first = got.hashes.findIndex((h, t) => h !== expected.hashes[t]);
      assert.equal(first, -1, `workers=${workers} grain=${grain}: first divergence at tick ${first}`);
      assert.ok(sim.scheduler.stats.parallelChunks > 0, 'chunks ran through the job system');
      assert.equal(sim.scheduler.stats.serialChunks, 0);
    } finally {
      await sim.jobs?.shutdown();
    }
  }
});

test('a system that throws on a job worker fails the stage with job-failed', { timeout: 30000 }, async () => {
  const sim = await sampleSim({ workers: 2 });
  try {
    // Corrupt one chunk header so that every thread's ChunkView.col() throws on it.
    const arch = sim.world.archetypes[SAMPLE_ARCHETYPES.fighter];
    const w = arch.chunks[0] >> 2;
    const saved = sim.world.heap.i32[w + 4];
    sim.world.heap.i32[w + 4] = 1; // column count: only the entity column is left
    sim.jobs.onJobError = () => {};
    await assert.rejects(sim.scheduler.tick(), /job-failed/);
    sim.world.heap.i32[w + 4] = saved;
  } finally {
    await sim.jobs?.shutdown();
  }
});
