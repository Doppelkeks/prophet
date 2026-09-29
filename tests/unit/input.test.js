import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ActionMap } from '../../engine/input/action-map.js';
import { CommandLog } from '../../engine/input/command-log.js';
import { InputCodes } from '../../engine/input/input-codes.js';
import { Buttons, InputFlags, InputRecord } from '../../engine/input/input-record.js';
import { InputKind } from '../../engine/input/input-ring.js';
import { InputState } from '../../engine/input/input-state.js';

/** @param {InputState} s @param {string} key @param {number} down */
const key = (s, key, down) => s.apply(InputKind.KEY, InputCodes.key(key), down, 0);

test('input records pack and unpack every field, including negative moves', () => {
  for (const [mx, my, aim, buttons, flags, ui] of [
    [0, 0, 0, 0, 0, 0],
    [127, -127, 65535, 0xffff, 0xff, 0xff],
    [-90, 90, 16384, Buttons.DASH | Buttons.PAUSE, InputFlags.GAMEPAD, 3],
  ]) {
    const [w0, w1] = InputRecord.pack(mx, my, aim, buttons, flags, ui);
    assert.deepEqual(
      [InputRecord.moveX(w0), InputRecord.moveY(w0), InputRecord.aim(w0), InputRecord.buttons(w1), InputRecord.flags(w1), InputRecord.ui(w1)],
      [mx, my, aim, buttons, flags, ui],
    );
  }
});

test('the action map quantizes keys, diagonals and sticks', () => {
  const map = new ActionMap();
  const s = new InputState();
  const move = () => {
    const [w0] = map.sample(s);
    return [InputRecord.moveX(w0), InputRecord.moveY(w0)];
  };
  assert.deepEqual(move(), [0, 0]);
  key(s, 'KeyD', 1);
  assert.deepEqual(move(), [127, 0]);
  key(s, 'KeyW', 1);
  assert.deepEqual(move(), [90, 90], 'diagonals keep the same speed');
  key(s, 'KeyA', 1);
  assert.deepEqual(move(), [0, 127], 'opposite keys cancel, leaving a straight move');
  s.apply(InputKind.BLUR, 0, 0, 0);
  assert.deepEqual(move(), [0, 0], 'losing focus releases everything');
  // Sticks: +y is down in the Gamepad API and up in the record; a radial deadzone of 0.2.
  const pad = (/** @type {number} */ x, /** @type {number} */ y, buttons = 0) => s.apply(InputKind.GAMEPAD, (x & 0xffff) | (y << 16), 0, buttons);
  pad(3000, -3000);
  assert.deepEqual(move(), [0, 0]);
  pad(32767, 0);
  assert.deepEqual(move(), [127, 0]);
  pad(0, -32767);
  assert.deepEqual(move(), [0, 127]);
  pad(0, 16384, 1 << 0 /* A */);
  const [w0, w1] = map.sample(s);
  assert.ok(InputRecord.moveY(w0) < 0 && InputRecord.moveY(w0) > -127);
  assert.equal(InputRecord.buttons(w1) & Buttons.DASH, Buttons.DASH);
  assert.equal(InputRecord.flags(w1) & InputFlags.GAMEPAD, InputFlags.GAMEPAD);
});

test('the command log records ticks in order and round-trips through JSON', () => {
  const log = new CommandLog();
  for (let t = 0; t < 10000; t++) log.set(t, t * 7, ~t >>> 0);
  assert.throws(() => log.set(5, 0, 0), /out of order/);
  const copy = CommandLog.fromJSON(JSON.parse(JSON.stringify(log)));
  assert.equal(copy.length, 10000);
  assert.equal(copy.hash(), log.hash());
  assert.equal(copy.w1(9999), ~9999 >>> 0);
});
