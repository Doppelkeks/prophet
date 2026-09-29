// @ts-check
// A small sample game for the ECS tests: components, systems that exercise every command kind, in-place
// writes, reads of other entities, change filters and provisional handles. Used on the engine thread and
// on job workers (tests/support/ecs-job-worker.js), so it must be identical on both.
import { Component } from '../../engine/ecs/component.js';
import { System } from '../../engine/ecs/system.js';
import { Rng } from '../../engine/core/rng.js';

export class Pos extends Component {
  static key = 'sample.pos';
  static schema = /** @type {const} */ ({ x: 'i32', y: 'i32' });
  /** @type {number} */ static x;
  /** @type {number} */ static y;
}

export class Vel extends Component {
  static key = 'sample.vel';
  static schema = /** @type {const} */ ({ vx: 'i32', vy: 'i32' });
  /** @type {number} */ static vx;
  /** @type {number} */ static vy;
}

export class Hp extends Component {
  static key = 'sample.hp';
  static schema = /** @type {const} */ ({ hp: 'i32', max: 'u16', armor: 'u8' });
  /** @type {number} */ static hp;
  /** @type {number} */ static max;
  /** @type {number} */ static armor;
}

export class Target extends Component {
  static key = 'sample.target';
  static schema = /** @type {const} */ ({ e: 'entity' });
  /** @type {number} */ static e;
}

export class Tagged extends Component {
  static key = 'sample.tagged';
}

export class Glow extends Component {
  static key = 'sample.glow';
  static schema = /** @type {const} */ ({ t: 'f32' });
  static renderOnly = true;
  /** @type {number} */ static t;
}

/** Archetype IDs the systems spawn into; the test creates them in this order at boot. */
export const SAMPLE_ARCHETYPES = /** @type {const} */ ({ empty: 0, fighter: 1, fighterGlow: 2 });
export const FIGHTER = [Pos, Vel, Hp, Target];

/** Moves every entity; bounces at the arena edge through a command (Vel is not in `writes`). */
export class MoveSystem extends System {
  static key = 'sample.a-move';
  static stage = /** @type {const} */ ('Sim');
  static reads = [Vel];
  static writes = [Pos];
  static query = { all: [Pos, Vel] };

  /** @type {System['run']} */
  run(c, cmd) {
    const i32 = this.heap.i32;
    const x = c.col(Pos.x);
    const y = c.col(Pos.y);
    const vx = c.col(Vel.vx);
    const vy = c.col(Vel.vy);
    for (let r = 0; r < c.count; r++) {
      i32[x + r] += i32[vx + r];
      i32[y + r] += i32[vy + r];
      if (i32[x + r] > 5000 || i32[x + r] < -5000) cmd.set(c.entity(r), Vel.vx, -i32[vx + r]);
      if (i32[y + r] > 5000 || i32[y + r] < -5000) cmd.set(c.entity(r), Vel.vy, -i32[vy + r]);
    }
  }
}

/** Damages the target (another entity) through commands: several attackers of one target resolve in key order. */
export class DamageSystem extends System {
  static key = 'sample.b-damage';
  static stage = /** @type {const} */ ('Sim');
  static reads = [Pos, Target, Hp];
  static after = [MoveSystem];
  static query = { all: [Pos, Target, Hp] };

  /** @type {System['run']} */
  run(c, cmd) {
    const i32 = this.heap.i32;
    const u32 = this.heap.u32;
    const reader = this.ecs.reader;
    const target = c.col(Target.e);
    const x = c.col(Pos.x);
    for (let r = 0; r < c.count; r++) {
      const t = u32[target + r];
      if (!reader.alive(t)) continue;
      const damage = 1 + (Rng.mix32(i32[x + r] ^ t) & 7);
      cmd.set(t, Hp.hp, reader.get(t, Hp.hp) - damage + reader.get(t, Hp.armor));
    }
  }
}

/** Dead entities despawn and leave one or two children that target each other (provisional handles). */
export class LifeSystem extends System {
  static key = 'sample.c-life';
  static stage = /** @type {const} */ ('PostSim');
  static reads = [Hp, Pos];
  static query = { all: [Hp, Pos], changed: [Hp] };

  /** @type {System['run']} */
  run(c, cmd) {
    const i32 = this.heap.i32;
    const hp = c.col(Hp.hp);
    const x = c.col(Pos.x);
    const y = c.col(Pos.y);
    for (let r = 0; r < c.count; r++) {
      if (i32[hp + r] > 0) continue;
      const e = c.entity(r);
      cmd.despawn(e);
      const h = Rng.mix32(e);
      const a = cmd.spawn(SAMPLE_ARCHETYPES.fighter);
      cmd.set(a, Pos.x, i32[x + r]);
      cmd.set(a, Pos.y, i32[y + r]);
      cmd.set(a, Vel.vx, (h & 31) - 16);
      cmd.set(a, Vel.vy, ((h >>> 5) & 31) - 16);
      cmd.add(a, Hp, [60 + (h & 63), 200, (h >>> 12) & 3]);
      if (h & 0x100) {
        const b = cmd.spawn(SAMPLE_ARCHETYPES.fighterGlow);
        cmd.set(b, Pos.x, -i32[x + r]);
        cmd.set(b, Pos.y, i32[y + r]);
        cmd.set(b, Hp.hp, 40);
        cmd.set(b, Target.e, a); // entity field holding a provisional handle
        cmd.set(a, Target.e, b);
      }
    }
  }
}

/** Tags entities in one half of the arena... */
export class TagSystem extends System {
  static key = 'sample.d-tag';
  static stage = /** @type {const} */ ('PostSim');
  static reads = [Pos];
  static query = { all: [Pos], none: [Tagged] };

  /** @type {System['run']} */
  run(c, cmd) {
    const i32 = this.heap.i32;
    const x = c.col(Pos.x);
    for (let r = 0; r < c.count; r++) if (i32[x + r] > 0) cmd.add(c.entity(r), Tagged);
  }
}

/** ...and untags them when they leave it. */
export class UntagSystem extends System {
  static key = 'sample.e-untag';
  static stage = /** @type {const} */ ('PostSim');
  static reads = [Pos];
  static query = { all: [Pos, Tagged] };

  /** @type {System['run']} */
  run(c, cmd) {
    const i32 = this.heap.i32;
    const x = c.col(Pos.x);
    for (let r = 0; r < c.count; r++) if (i32[x + r] <= 0) cmd.remove(c.entity(r), Tagged);
  }
}

/** Retargets in place (own row only) when the target died: the next entity in the same chunk. */
export class RetargetSystem extends System {
  static key = 'sample.f-retarget';
  static stage = /** @type {const} */ ('PreSim');
  static writes = [Target];
  static query = { all: [Target] };

  /** @type {System['run']} */
  run(c, cmd) {
    const u32 = this.heap.u32;
    const target = c.col(Target.e);
    for (let r = 0; r < c.count; r++) {
      if (!this.ecs.reader.alive(u32[target + r])) u32[target + r] = c.entity((r + 1) % c.count);
    }
  }
}

/** Render-only: floats allowed in Extract. */
export class GlowSystem extends System {
  static key = 'sample.g-glow';
  static stage = /** @type {const} */ ('Extract');
  static reads = [Hp];
  static writes = [Glow];
  static query = { all: [Hp, Glow] };

  /** @type {System['run']} */
  run(c, cmd) {
    const hp = c.col(Hp.hp);
    const t = c.col(Glow.t);
    for (let r = 0; r < c.count; r++) this.heap.f32[t + r] = this.heap.i32[hp + r] / 100;
  }
}

/** A system without a query: runs once per tick on the engine thread and spawns a wanderer every 7 ticks. */
export class WaveSystem extends System {
  static key = 'sample.h-wave';
  static stage = /** @type {const} */ ('Input');

  /** @type {System['update']} */
  update(cmd) {
    const res = this.ecs.resources;
    res.tick = (res.tick ?? 0) + 1;
    if (res.tick % 7 !== 0) return;
    const e = cmd.spawn(SAMPLE_ARCHETYPES.fighter);
    cmd.set(e, Pos.x, (res.tick * 37) % 4000 - 2000);
    cmd.set(e, Vel.vx, 3);
    cmd.set(e, Hp.hp, 90);
  }
}

export const SAMPLE_MANIFEST = {
  components: [Pos, Vel, Hp, Target, Tagged, Glow],
  systems: [MoveSystem, DamageSystem, LifeSystem, TagSystem, UntagSystem, RetargetSystem, GlowSystem, WaveSystem],
  kernels: [],
};
