// SCRAPWAKE's navigation: the player flow field commits on fixed ticks, and obstacles stop PATCH.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SimBoot } from '../../engine/app/sim-boot.js';
import { Heap } from '../../engine/core/heap.js';
import { InputRecord } from '../../engine/input/input-record.js';
import { SwarmReference } from '../../engine/swarm/reference/swarm-reference.js';
import { SCRAPWAKE } from '../../game/app/game.js';
import { Transform } from '../../game/components/index.js';
import { ARENA_COST, L_FIELD, navCell } from '../../game/data/arena.js';

async function boot() {
  return SimBoot.create({
    game: SCRAPWAKE,
    heap: Heap.create('test', false),
    tier: 'inline',
    swarm: (layout, tables, seed) => new SwarmReference(layout, tables, { seed }),
    swarmProfile: 'test',
  });
}

test('the player field is requested on tick 0, committed L_FIELD ticks later, and re-requested as PATCH moves', async () => {
  const b = await boot();
  const sim = b.sim;
  const [right] = InputRecord.pack(127, 0, 0, 0, 0, 0);
  /** @type {number[]} */
  const commits = [];
  for (let t = 0; t < 150; t++) {
    sim.stamp(right, 0);
    assert.equal(await sim.step(), true);
    if (/** @type {import('../../engine/swarm/swarm-contract.js').SwarmInbound} */ (sim.resources.swarm).field) commits.push(t);
  }
  assert.equal(commits[0], L_FIELD, 'the tick-0 request commits on tick 15');
  assert.ok(commits.length >= 3, `PATCH keeps changing cells: ${commits}`);
  for (let k = 1; k < commits.length; k++) assert.ok(commits[k] - commits[k - 1] >= L_FIELD, 'at most one commit per L_FIELD ticks');
  await b.jobs.shutdown();
});

test('PATCH slides along a pillar instead of walking into it', async () => {
  const b = await boot();
  const sim = b.sim;
  const patch = sim.resources.patch;
  const [right] = InputRecord.pack(127, 0, 0, 0, 0, 0); // straight at the pillar at x 22..26 m, y −2..2 m
  for (let t = 0; t < 300; t++) {
    sim.stamp(right, 0);
    await sim.step();
    const x = sim.world.get(patch, Transform.x);
    const y = sim.world.get(patch, Transform.y);
    assert.notEqual(ARENA_COST[navCell(x, y)], 0, `tick ${t}: inside an obstacle`);
  }
  assert.ok(sim.world.get(patch, Transform.x) < 22 * 1024, 'stopped at the pillar');
  const [upRight] = InputRecord.pack(90, 90, 0, 0, 0, 0);
  for (let t = 0; t < 120; t++) {
    sim.stamp(upRight, 0);
    await sim.step();
  }
  assert.ok(sim.world.get(patch, Transform.x) > 26 * 1024, 'and slides past it moving diagonally');
  await b.jobs.shutdown();
});
