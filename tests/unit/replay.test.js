// Replay documents: a live run with UI commands (the stress keys), exported and played back headless,
// reproduces the hash stream exactly; a changed UI command is caught.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Replay } from '../../engine/app/replay.js';
import { SimBoot } from '../../engine/app/sim-boot.js';
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
