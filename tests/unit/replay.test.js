// Replay documents: a live run with UI commands (the stress keys), exported and played back headless,
// reproduces the hash stream exactly; a changed UI command is caught.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Replay } from '../../engine/app/replay.js';
import { SimBoot } from '../../engine/app/sim-boot.js';
import { EngineCommand } from '../../engine/app/sim-core.js';
import { SwarmTables } from '../../engine/swarm/swarm-contract.js';
import { Heap } from '../../engine/core/heap.js';
import { UI_WORDS } from '../../engine/input/command-log.js';
import { InputRecord } from '../../engine/input/input-record.js';
import { SwarmReference } from '../../engine/swarm/reference/swarm-reference.js';
import { SCRAPWAKE } from '../../game/app/game.js';
import { Director, RunStats } from '../../game/components/index.js';
import { UiCommand } from '../../game/data/ui-commands.js';

const TICKS = 900;

test('a run with UI commands exports as a replay document and replays to the same hash stream', { timeout: 120000 }, async () => {
  const boot = await SimBoot.create({
    game: SCRAPWAKE,
    heap: Heap.create('test', false),
    tier: 'inline',
    hashEvery: 60,
    swarm: (layout, tables, seed) => new SwarmReference(layout, tables, { seed }),
    swarmProfile: 'test',
  });
  const sim = boot.sim;
  const ui = new Uint32Array(4 * UI_WORDS);
  /** @type {Record<number, number[]>} UI commands (code, a, b) by tick */
  const script = {
    30: [UiCommand.STRESS_UP, 0, 0, UiCommand.STRESS_UP, 0, 0],
    200: [UiCommand.BURST, 300, 0],
    400: [UiCommand.STRESS_DOWN, 0, 0],
  };
  let requested = 0;
  for (let t = 0; t < TICKS; t++) {
    const phase = (t >> 7) & 3;
    const [w0, w1] = InputRecord.pack(phase === 0 ? 127 : phase === 2 ? -127 : 0, phase === 1 ? 127 : phase === 3 ? -127 : 0, 0, 0, 0, 0);
    const cmds = script[t] ?? [];
    ui.set(cmds);
    sim.stamp(w0, w1, ui, cmds.length / UI_WORDS);
    assert.equal(await sim.step(), true);
    requested += sim.resources.swarm.requests;
  }
  const run = sim.resources.run;
  assert.equal(sim.world.get(run, Director.stress), 1, 'two up, one down');
  assert.ok(requested >= 300, 'the burst requested its units');
  assert.ok(sim.world.get(run, RunStats.kills) > 0);

  const header = {
    build: boot.manifest.hash,
    heapProfile: /** @type {const} */ ('test'),
    seed: SCRAPWAKE.swarm?.seed ?? 0,
    K: boot.swarm?.K ?? 0,
    swarmCaps: boot.swarm ? { ...boot.swarm.backend.layout.caps } : null,
    hashEvery: 60,
  };
  const doc = JSON.parse(JSON.stringify(Replay.document(sim, header)));
  assert.equal(doc.hashes.length, 2 * (TICKS / 60));
  const same = await Replay.run(SCRAPWAKE, doc);
  assert.equal(same.ticks, TICKS);
  assert.equal(same.mismatch, null);
  assert.deepEqual(same.hashes, sim.hashes);

  // Drop the burst: the replay diverges, and the first mismatch comes after tick 200.
  const edited = structuredClone(doc);
  const burstAt = 2 * UI_WORDS; // the two STRESS_UP records come first
  assert.equal(edited.log.ui[burstAt], UiCommand.BURST);
  edited.log.ui[burstAt + 1] = 1;
  const diverged = await Replay.run(SCRAPWAKE, edited);
  assert.ok(diverged.mismatch, 'the edited log diverges');
  assert.ok(diverged.mismatch.tick > 200, `first mismatch at ${diverged.mismatch.tick}`);

  await assert.rejects(Replay.run(SCRAPWAKE, { ...doc, build: doc.build ^ 1 }), /recorded by build/);
  await boot.jobs.shutdown();
});

test('a device loss becomes a logged swarm reset: the stalled tick resumes on a fresh swarm, and the replay matches', { timeout: 120000 }, async () => {
  const LOST = 290; // blocks from this tick on never arrive, as if the device died here
  const boot = await SimBoot.create({
    game: SCRAPWAKE,
    heap: Heap.create('test', false),
    tier: 'inline',
    hashEvery: 60,
    swarm: (layout, tables, seed) => new SwarmReference(layout, tables, { seed, delay: (t) => (t >= LOST ? 1e9 : 0) }),
    swarmProfile: 'test',
  });
  const sim = boot.sim;
  const link = /** @type {import('../../engine/app/sim-core.js').SwarmLink} */ (sim.swarm);
  const K = link.K;
  const [still] = InputRecord.pack(0, 0, 0, 0, 0, 0);
  let t = 0;
  for (; t < 600; t++) {
    sim.stamp(still, 0);
    if (!(await sim.step())) break;
  }
  assert.equal(sim.tick, LOST + K, 'the first tick that needs a lost block stalls');
  assert.ok(sim.log.has(sim.tick), 'and it is already stamped');

  // Recovery: a fresh swarm (new buffers) and a reset logged on the stalled tick.
  const layout = link.backend.layout;
  const gs = /** @type {import('../../engine/app/game-module.js').GameSwarm} */ (SCRAPWAKE.swarm);
  link.backend = new SwarmReference(layout, SwarmTables.build(layout, gs.types, gs.statuses, gs.cost?.(layout) ?? null), { seed: gs.seed });
  sim.requestSwarmReset();
  assert.equal(sim.log.uiCount(sim.tick), 1);
  assert.equal(sim.log.uiWords[sim.log.uiAt(sim.tick)], EngineCommand.SWARM_RESET);
  while (sim.tick < 600) {
    sim.stamp(still, 0);
    assert.equal(await sim.step(), true, `tick ${sim.tick} runs`);
  }
  assert.equal(sim.resets, 1);
  assert.ok(sim.world.get(sim.resources.run, RunStats.alive) > 0, 'the director respawned the swarm');

  const header = {
    build: boot.manifest.hash,
    heapProfile: /** @type {const} */ ('test'),
    seed: SCRAPWAKE.swarm?.seed ?? 0,
    K,
    swarmCaps: { ...layout.caps },
    hashEvery: 60,
  };
  const r = await Replay.run(SCRAPWAKE, JSON.parse(JSON.stringify(Replay.document(sim, header))));
  assert.equal(r.mismatch, null, 'one reference swarm, reset in place, matches the fresh one');
  assert.equal(r.ticks, 600);
  await boot.jobs.shutdown();
});
