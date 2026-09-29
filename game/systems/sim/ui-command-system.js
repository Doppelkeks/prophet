// @ts-check
import { Fixed } from '../../../engine/core/fixed.js';
import { UI_WORDS } from '../../../engine/input/command-log.js';
import { System } from '../../../engine/ecs/system.js';
import { Director, RunStats, Transform } from '../../components/index.js';
import { BURST_COUNT, MAX_STRESS, UiCommand } from '../../data/ui-commands.js';

/**
 * Applies the UI commands stamped on this tick (the stress keys of the tech demo). They come from the
 * command log, so replays apply them on the same tick. Reads engine resources, so it runs serially.
 */
export class UiCommandSystem extends System {
  static key = 'ui-commands';
  static stage = /** @type {const} */ ('Input');
  static reads = [Director, RunStats, Transform];

  /** @type {System['update']} */
  update(cmd) {
    const res = this.ecs.resources;
    const input = res.input;
    if (input.uiCount === 0) return;
    const reader = this.ecs.reader;
    const d = res.run;
    let stress = reader.get(d, Director.stress);
    const stressWas = stress;
    let room = reader.get(d, Director.cap) - reader.get(d, RunStats.alive);
    const ui = input.ui;
    for (let i = 0; i < input.uiCount; i++) {
      const at = input.uiAt + Math.imul(i, UI_WORDS);
      const code = ui[at];
      if (code === UiCommand.STRESS_UP) stress = Fixed.clamp(stress + 1, 0, MAX_STRESS);
      else if (code === UiCommand.STRESS_DOWN) stress = Fixed.clamp(stress - 1, 0, MAX_STRESS);
      else if (code === UiCommand.BURST && res.swarm) {
        const n = Fixed.clamp(ui[at + 1] === 0 ? BURST_COUNT : ui[at + 1] | 0, 0, room);
        if (n > 0) {
          const r1 = reader.get(d, Director.r1);
          res.swarm.spawnRing({ type: 0, count: n, cx: reader.get(res.patch, Transform.x), cy: reader.get(res.patch, Transform.y), r0: r1, r1: r1 + (r1 >> 1) });
          room -= n;
        }
      }
    }
    if (stress !== stressWas) cmd.set(d, Director.stress, stress);
  }
}
