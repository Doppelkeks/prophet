// @ts-check
import { Fixed } from '../../../engine/core/fixed.js';
import { System } from '../../../engine/ecs/system.js';
import { InputRecord, MOVE_MAX } from '../../../engine/input/input-record.js';
import { Abilities, Motion, Pilot } from '../../components/index.js';
import { OVERCLOCK } from '../../data/abilities.js';

/** Turns the tick's input record into the pilot's velocity. Reads engine resources, so it runs serially. */
export class PilotInputSystem extends System {
  static key = 'pilot-input';
  static stage = /** @type {const} */ ('Input');
  static reads = [Pilot, Abilities];
  static writes = [Motion];
  static query = { all: [Pilot, Motion, Abilities] };
  static parallel = /** @type {const} */ ('serial');

  /** @type {System['run']} */
  run(c) {
    const i32 = this.heap.i32;
    const w0 = this.ecs.resources.input.w0;
    const mx = InputRecord.moveX(w0);
    const my = InputRecord.moveY(w0);
    const speed = c.col(Pilot.speed);
    const oc = c.col(Abilities.overclock);
    const vx = c.col(Motion.vx);
    const vy = c.col(Motion.vy);
    for (let r = 0; r < c.count; r++) {
      const top = i32[oc + r] > 0 ? Fixed.idiv(Math.imul(i32[speed + r], OVERCLOCK.moveNum), OVERCLOCK.moveDen) : i32[speed + r];
      i32[vx + r] = Fixed.idiv(Math.imul(mx, top), MOVE_MAX);
      i32[vy + r] = Fixed.idiv(Math.imul(my, top), MOVE_MAX);
    }
  }
}
