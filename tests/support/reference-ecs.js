// @ts-check
// A deliberately naive ECS built on Maps, for fuzzing the real one (docs/engine/02-core-ecs-jobs.md#testing).
// Same observable semantics: FIFO index reuse with generations, add overwrites, remove/despawn/set on
// dead entities are no-ops, spawns beyond the capacity are refused.
import { Field, FieldType } from '../../engine/ecs/component.js';

export class ReferenceEcs {
  /**
   * @param {import('../../engine/ecs/registry.js').ComponentRegistry} registry
   * @param {number} capacity
   */
  constructor(registry, capacity) {
    this.registry = registry;
    this.capacity = capacity;
    this.gen = new Uint16Array(capacity).fill(1);
    /** @type {number[]} */
    this.free = [];
    for (let i = 1; i < capacity; i++) this.free.push(i);
    /** @type {Map<number, { comps: Set<number>, values: Map<number, number> }>} */
    this.alive = new Map();
    this.refused = 0;
  }

  /** @param {number[]} comps */
  spawn(comps) {
    if (!this.free.length) {
      this.refused++;
      return 0;
    }
    const index = /** @type {number} */ (this.free.shift());
    const e = ((this.gen[index] << 16) | index) >>> 0;
    const rec = { comps: new Set(), values: new Map() };
    this.alive.set(e, rec);
    for (const c of comps) this.#attach(rec, c);
    return e;
  }

  /** @param {number} e */
  despawn(e) {
    if (!this.alive.delete(e)) return;
    const index = e & 0xffff;
    this.gen[index] = this.gen[index] === 0xffff ? 1 : this.gen[index] + 1;
    this.free.push(index);
  }

  /** @param {number} e @param {number} comp @param {number[] | null} values */
  add(e, comp, values) {
    const rec = this.alive.get(e);
    if (!rec) return;
    if (!rec.comps.has(comp)) this.#attach(rec, comp);
    if (values) {
      const fields = this.registry.fields[comp];
      for (let f = 0; f < fields.length; f++) rec.values.set(fields[f].handle, ReferenceEcs.norm(fields[f].type, f < values.length ? values[f] : 0));
    }
  }

  /** @param {number} e @param {number} comp */
  remove(e, comp) {
    const rec = this.alive.get(e);
    if (!rec || !rec.comps.has(comp)) return;
    rec.comps.delete(comp);
    for (const f of this.registry.fields[comp]) rec.values.delete(f.handle);
  }

  /** @param {number} e @param {number} field @param {number} value */
  set(e, field, value) {
    const rec = this.alive.get(e);
    if (!rec || !rec.comps.has(Field.component(field))) return;
    rec.values.set(field, ReferenceEcs.norm(Field.type(field), value));
  }

  /** @param {{ comps: Set<number>, values: Map<number, number> }} rec @param {number} comp */
  #attach(rec, comp) {
    rec.comps.add(comp);
    for (const f of this.registry.fields[comp]) rec.values.set(f.handle, 0);
  }

  /** What a typed column stores for a value. @param {number} type @param {number} v */
  static norm(type, v) {
    switch (type) {
      case FieldType.i32:
        return v | 0;
      case FieldType.u16:
        return v & 0xffff;
      case FieldType.u8:
        return v & 0xff;
      case FieldType.f32:
        return Math.fround(v);
      default:
        return v >>> 0;
    }
  }
}
