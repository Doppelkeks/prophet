// The flow-field solver (docs/engine/06-world.md#navigation): Dial's Dijkstra, 8 neighbours without corner
// cutting, then directions toward the lowest neighbour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FlowField, NO_PATH } from '../../engine/nav/sim/flow-field.js';

/** @param {string[]} rows map rows, top row = highest y: '.' open, '#' blocked, '2'..'9' slow, 'G' goal */
function grid(rows) {
  const h = rows.length;
  const w = rows[0].length;
  const cost = new Uint8Array(w * h);
  let goal = -1;
  rows.forEach((row, r) => {
    const y = h - 1 - r;
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      const c = y * w + x;
      cost[c] = ch === '#' ? 0 : ch >= '2' && ch <= '9' ? Number(ch) : 1;
      if (ch === 'G') goal = c;
    }
  });
  return { w, h, cost, goal };
}

const dist = (/** @type {number} */ v) => v >>> 16;
const angle = (/** @type {number} */ v) => v & 0xffff;

test('open ground: 10 per straight step, 14 per diagonal, directions toward the goal', () => {
  const g = grid(['.....', '.....', '..G..', '.....', '.....']);
  const f = new FlowField(g.w, g.h).solve(g.cost, g.goal);
  const at = (/** @type {number} */ x, /** @type {number} */ y) => f[y * g.w + x];
  assert.equal(dist(at(2, 2)), 0);
  assert.equal(dist(at(3, 2)), 10);
  assert.equal(dist(at(3, 3)), 14);
  assert.equal(dist(at(4, 4)), 28);
  assert.equal(dist(at(4, 3)), 24);
  assert.equal(angle(at(3, 2)), 32768, 'east of the goal points west');
  assert.equal(angle(at(2, 3)), 49152, 'north of it points south');
  assert.equal(angle(at(3, 3)), 40960, 'north-east points south-west');
});

test('walls: paths go through the gap, blocked and enclosed cells have no path, diagonals never cut corners', () => {
  const g = grid([
    '..#....',
    '..#.##.',
    'G.#.#.#',
    '..#.##.',
    '.......',
  ]);
  const f = new FlowField(g.w, g.h).solve(g.cost, g.goal);
  const at = (/** @type {number} */ x, /** @type {number} */ y) => f[y * g.w + x];
  assert.equal(dist(at(2, 2)), NO_PATH, 'blocked');
  assert.equal(dist(at(5, 2)), NO_PATH, 'enclosed pocket');
  // (3, 4) sits right of the wall; its path runs down and around the wall's foot at y = 0.
  assert.ok(dist(at(3, 4)) > 60, `around the wall: ${dist(at(3, 4))}`);
  // Following the directions from any reachable cell reaches the goal without entering a blocked cell.
  for (let c = 0; c < f.length; c++) {
    if (dist(f[c]) === NO_PATH) continue;
    let x = c % g.w;
    let y = Math.floor(c / g.w);
    for (let steps = 0; dist(at(x, y)) !== 0; steps++) {
      assert.ok(steps < 40, 'reaches the goal');
      const a = angle(at(x, y));
      x += a === 0 || a === 8192 || a === 57344 ? 1 : a === 32768 || a === 24576 || a === 40960 ? -1 : 0;
      y += a === 16384 || a === 8192 || a === 24576 ? 1 : a === 49152 || a === 57344 || a === 40960 ? -1 : 0;
      assert.notEqual(g.cost[y * g.w + x], 0, 'never through a wall');
    }
  }
  const d = grid(['#.', 'G#']); // (1, 1) touches the goal only diagonally, between two walls
  assert.equal(dist(new FlowField(d.w, d.h).solve(d.cost, d.goal)[1 * 2 + 1]), NO_PATH, 'a diagonal between two walls is closed');
});

test('slow ground costs its multiple; solves are deterministic and reuse their buffers', () => {
  const g = grid(['G3.', '...']);
  const ff = new FlowField(g.w, g.h);
  const f = ff.solve(g.cost, g.goal);
  assert.equal(dist(f[1 * 3 + 1]), 30, 'straight into slow ground: 10 × 3');
  assert.equal(dist(f[1 * 3 + 2]), 28, 'two diagonals through the open row are cheaper than crossing it');
  const copy = f.slice();
  assert.strictEqual(ff.solve(g.cost, g.goal), f, 'the same output buffer');
  assert.deepEqual(f, copy);
});
