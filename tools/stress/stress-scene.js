// @ts-check
// The swarm stress scene (docs/BUDGETS.md#stress-ceiling-scene-m2-exit): SCRAPWAKE's swarm types in its arena,
// with the unit pool kept full and the shot pool fed at the fire-command cap. It is sustained churn, not a
// frozen crowd:
// - Kills are refilled from the arena rim, going by the latest harvested block, so drops, pickups and
//   death events keep flowing.
// - A moving player proxy pushes and collects, and the flow field toward it is re-solved every 30 ticks.
// - Turrets around the player fire 1024 commands per tick:
//   - 1 in 16 is a STRONGEST sniper shot, which kills brutes and so produces death events;
//   - 1 in 16 is NEAREST;
//   - the rest are AIMED, piercing shots that mostly live out their lifetime.
// - Every few ticks there is a stomp (knockback + stun) and a burning ring.
// The run is deterministic for a given pool size and seed; only the refill lags the GPU by K ticks.
import { Policy, ProxyFlag, Status, EffectShape, Team } from '../../engine/swarm/swarm-contract.js';
import { FlowField } from '../../engine/nav/sim/flow-field.js';
import { ARENA_COST, NAV } from '../../game/data/arena.js';

const M = 1024;
/** Turrets around the player, and fire commands per turret per tick. */
const TURRETS = 64;
/** Shot lifetime in ticks: fires × life ≈ the 50k shot pool. */
const SHOT_LIFE = 48;
/** Re-solve the flow field every this many ticks (≥ L_FIELD). */
const FIELD_EVERY = 30;

export class StressScene {
  /**
   * @param {import('../../engine/swarm/swarm-layout.js').SwarmLayout} layout
   * @param {{ units: number }} o target alive units
   */
  constructor(layout, o) {
    this.layout = layout;
    this.target = o.units;
    this.solver = new FlowField(NAV.w, NAV.w);
    /** Alive units in the latest harvested block, and the tick it belongs to. */
    this.alive = 0;
    this.aliveTick = -1;
    /** Units requested per tick, to estimate the pool between blocks. @type {Int32Array} */
    this.spawned = new Int32Array(1024);
  }

  /** The harvested block of `tick` says `alive` units live. @param {number} tick @param {number} alive */
  observe(tick, alive) {
    if (tick > this.aliveTick) {
      this.aliveTick = tick;
      this.alive = alive;
    }
  }

  /** The player position at tick t (Q10). @param {number} t */
  static player(t) {
    return [Math.round(Math.cos(t / 90) * 12 * M), Math.round(Math.sin(t / 70) * 10 * M)];
  }

  /** Fills this tick's inbound block. @param {import('../../engine/swarm/swarm-contract.js').SwarmInbound} i @param {number} t */
  fill(i, t) {
    const L = this.layout.L;
    const [px, py] = StressScene.player(t);
    let requested = 0;
    if (t === 0) {
      // 50 rings on a 10 × 5 grid over the arena. Brutes: the two center rings, where the player starts, and
      // the east column.
      const per = Math.floor(this.target / 50);
      for (let g = 0; g < 50; g++) {
        const cx = ((g % 10) - 4.5) * 11 * M;
        const cy = (Math.floor(g / 10) - 2) * 22 * M;
        if (i.spawnRing({ type: g === 24 || g === 25 || g % 10 === 9 ? 2 : g % 2, count: per, cx: Math.round(cx), cy, r0: 0, r1: 9 * M }) >= 0) requested += per;
      }
    } else {
      // Refill from the rim: the latest block's count plus what was requested after it.
      let estimate = this.alive;
      for (let k = this.aliveTick + 1; k < t; k++) estimate += this.spawned[k & 1023];
      const deficit = this.target - estimate;
      if (deficit >= 64) {
        for (let g = 0; g < 4; g++) {
          const count = deficit >> 2;
          if (count > 0 && i.spawnRing({ type: (t + g) % 7 === 0 ? 2 : g & 1, count, cx: 0, cy: 0, r0: 52 * M, r1: 60 * M }) >= 0) requested += count;
        }
      }
    }
    this.spawned[t & 1023] = requested;
    i.proxy({ entity: 1, x: px, y: py, radius: 512, team: Team.PLAYER, flags: ProxyFlag.PUSHES | ProxyFlag.TARGETABLE | ProxyFlag.COLLECTOR, aux: 3 * M });
    if (t % FIELD_EVERY === 0) {
      const cx = Math.max(0, Math.min(L.gridW - 1, (px - L.originX) >> L.cellShift));
      const cy = Math.max(0, Math.min(L.gridW - 1, (py - L.originY) >> L.cellShift));
      i.setField(this.solver.solve(ARENA_COST, cy * L.gridW + cx));
    }
    if (t % 20 === 0) i.effect({ x: px, y: py, radius: 3 * M, impulse: 600, damage: 512, status: Status.STUNNED, tier: 1, source: 1 });
    if (t % 20 === 10) i.effect({ shape: EffectShape.RING, x: px, y: py, radius: 14 * M, inner: 10 * M, damage: 128, status: Status.BURNING, tier: 2, source: 2 });
    const perTurret = L.fireCap / TURRETS;
    for (let f = 0; f < L.fireCap; f++) {
      const turret = f % TURRETS;
      const a = (turret * 1024 + t * 97) & 0xffff; // the turrets orbit the player at 6 m
      const x = px + Math.round(Math.cos((a / 65536) * 2 * Math.PI) * 6 * M);
      const y = py + Math.round(Math.sin((a / 65536) * 2 * Math.PI) * 6 * M);
      const kind = f & 15;
      const sniper = kind === 0;
      i.fire({
        source: turret,
        x,
        y,
        range: 10 * M,
        damage: sniper ? 1024 : 256,
        speed: 420,
        life: SHOT_LIFE,
        pierce: sniper ? 0 : 6,
        policy: sniper ? Policy.STRONGEST : kind === 8 ? Policy.NEAREST : Policy.AIMED,
        aim: (Math.imul(f, 40503) + t * 1777 + Math.floor(f / TURRETS) * (65536 / perTurret)) & 0xffff,
      });
    }
  }
}
