// @ts-check
import { Fixed } from '../../../engine/core/fixed.js';
import { System } from '../../../engine/ecs/system.js';
import { InputRecord, MOVE_MAX } from '../../../engine/input/input-record.js';
import { Motion, Pilot } from '../../components/index.js';

/** Turns the tick's input record into the pilot's velocity. Reads engine resources, so it runs serially. */
export class PilotInputSystem extends System {
  static key = 'pilot-input';
  static stage = /** @type {const} */ ('Input');
  static reads = [Pilot];
  static writes = [Motion];
  static query = { all: [Pilot, Motion] };
  static parallel = /** @type {const} */ ('serial');

  /** @type {System['run']} */
  run(c) {
    const i32 = this.heap.i32;
    const w0 = this.ecs.resources.input.w0;
    const mx = InputRecord.moveX(w0);
    const my = InputRecord.moveY(w0);
    const speed = c.col(Pilot.speed);
    const vx = c.col(Motion.vx);
    const vy = c.col(Motion.vy);
    for (let r = 0; r < c.count; r++) {
      i32[vx + r] = Fixed.idiv(Math.imul(mx, i32[speed + r]), MOVE_MAX);
      i32[vy + r] = Fixed.idiv(Math.imul(my, i32[speed + r]), MOVE_MAX);
    }
  }
}
