// @ts-check
// Command buffers (docs/engine/02-core-ecs-jobs.md#command-buffers). Structural changes, and writes to
// other entities, are recorded during a stage and applied at the next sync point, sorted by
// (system ID, chunk index). Inside a segment, records keep their recording order (row, sequence), so the
// effective order never depends on which thread recorded what, or when it finished.
//
// Each participant (the engine thread, then one per job worker) owns one buffer in the jobs arena:
//   word 0: words used; words 16..: segments = [system ID, chunk index, record words, ...records]
// Records (32-bit words):
//   SPAWN   archetype, provisional     DESPAWN entity          REMOVE entity, component
//   ADD     entity, component, n, v0..v(n-1)                   SET    entity, field, value
// Provisional handles (1..65535, generation 0) are local to their segment; the applier maps them to the
// real handles it creates, in apply order.
import { Field, FieldType } from './component.js';

export const Op = Object.freeze({ SPAWN: 1, DESPAWN: 2, ADD: 3, REMOVE: 4, SET: 5 });
const DATA = 16;
const SEGMENT = 3;

const f32 = new Float32Array(1);
const f32Bits = new Int32Array(f32.buffer);

export class CommandWriter {
  /**
   * @param {import('../core/heap.js').Heap} heap
   * @param {number} baseW first word of this participant's buffer
   * @param {number} strideW words in the buffer
   */
  constructor(heap, baseW, strideW) {
    this.i32 = heap.i32;
    this.base = baseW;
    this.data = baseW + DATA;
    this.cap = strideW - DATA;
    this.len = 0;
    this.seg = -1;
    this.provisional = 0;
  }

  /** Opens a segment. @param {number} system @param {number} chunk */
  begin(system, chunk) {
    if (this.seg >= 0) throw new Error('command-buffer: segment already open');
    const len = this.i32[this.base]; // the engine clears the buffer at sync points
    if (len + SEGMENT > this.cap) throw new Error('command-buffer-overflow');
    this.i32[this.data + len] = system;
    this.i32[this.data + len + 1] = chunk;
    this.i32[this.data + len + 2] = 0;
    this.seg = len;
    this.len = len + SEGMENT;
    this.provisional = 0;
  }

  /** Closes the segment and publishes it. */
  end() {
    if (this.seg < 0) return;
    this.i32[this.data + this.seg + 2] = this.len - this.seg - SEGMENT;
    this.i32[this.base] = this.len;
    this.seg = -1;
  }

  /** Drops an open segment (its system threw). */
  abort() {
    this.seg = -1;
  }

  /** @param {number} words */
  #put(words) {
    if (this.seg < 0) throw new Error('command-buffer: no open segment');
    const at = this.len;
    if (at + words > this.cap) throw new Error('command-buffer-overflow');
    this.len = at + words;
    return this.data + at;
  }

  /**
   * Records a spawn and returns its provisional handle (valid in later records of this segment).
   * @param {number} archetype
   */
  spawn(archetype) {
    const p = ++this.provisional;
    if (p > 0xffff) throw new Error('command-buffer: more than 65,535 spawns in one segment');
    const at = this.#put(3);
    this.i32[at] = Op.SPAWN;
    this.i32[at + 1] = archetype;
    this.i32[at + 2] = p;
    return p;
  }

  /** @param {number} e */
  despawn(e) {
    const at = this.#put(2);
    this.i32[at] = Op.DESPAWN;
    this.i32[at + 1] = e;
  }

  /**
   * Adds a component, or overwrites its values if the entity already has it.
   * @param {number} e @param {import('./component.js').ComponentClass} K @param {ArrayLike<number>} [values] integer fields, in schema order
   */
  add(e, K, values = []) {
    this.addId(e, K.id, values);
  }

  /** @param {number} e @param {number} componentId @param {ArrayLike<number>} [values] */
  addId(e, componentId, values = []) {
    const n = values.length;
    const at = this.#put(4 + n);
    this.i32[at] = Op.ADD;
    this.i32[at + 1] = e;
    this.i32[at + 2] = componentId;
    this.i32[at + 3] = n;
    for (let v = 0; v < n; v++) this.i32[at + 4 + v] = values[v];
  }

  /** @param {number} e @param {import('./component.js').ComponentClass} K */
  remove(e, K) {
    this.removeId(e, K.id);
  }

  /** @param {number} e @param {number} componentId */
  removeId(e, componentId) {
    const at = this.#put(3);
    this.i32[at] = Op.REMOVE;
    this.i32[at + 1] = e;
    this.i32[at + 2] = componentId;
  }

  /** Writes a field of any entity at apply time. @param {number} e @param {number} field @param {number} value */
  set(e, field, value) {
    const at = this.#put(4);
    this.i32[at] = Op.SET;
    this.i32[at + 1] = e;
    this.i32[at + 2] = field;
    if (Field.type(field) === FieldType.f32) {
      f32[0] = value;
      this.i32[at + 3] = f32Bits[0];
    } else {
      this.i32[at + 3] = value;
    }
  }
}

export class CommandApplier {
  /** @param {import('./world.js').World} world */
  constructor(world) {
    this.world = world;
    this.i32 = world.heap.i32;
    /** provisional → real handle, for the segment being applied */
    this.spawned = new Uint32Array(0x10000);
    /** @type {number[]} */
    this.values = [];
    this.records = 0;
  }

  /**
   * Applies every recorded segment in (system ID, chunk index) order, then clears all buffers.
   * @returns {number} segments applied
   */
  apply() {
    const i32 = this.i32;
    const w = this.world;
    /** @type {number[][]} [system, chunk, participant, first record word, words] */
    const segments = [];
    for (let p = 0; p < w.cmdParticipants; p++) {
      const base = w.cmdW + p * w.cmdStride;
      const data = base + DATA;
      const len = i32[base];
      for (let pos = 0; pos < len; ) {
        const words = i32[data + pos + 2];
        segments.push([i32[data + pos], i32[data + pos + 1], p, data + pos + SEGMENT, words]);
        pos += SEGMENT + words;
      }
    }
    if (!segments.length) return 0;
    segments.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    w.bumpClock();
    for (const s of segments) this.#segment(s[3], s[4]);
    for (let p = 0; p < w.cmdParticipants; p++) i32[w.cmdW + p * w.cmdStride] = 0;
    return segments.length;
  }

  /** @param {number} start @param {number} words */
  #segment(start, words) {
    const i32 = this.i32;
    const w = this.world;
    const spawned = this.spawned;
    let maxProvisional = 0;
    const end = start + words;
    for (let at = start; at < end; ) {
      this.records++;
      switch (i32[at]) {
        case Op.SPAWN: {
          const p = i32[at + 2];
          spawned[p] = w.spawn(i32[at + 1]);
          if (p > maxProvisional) maxProvisional = p;
          at += 3;
          break;
        }
        case Op.DESPAWN:
          w.despawn(this.#real(i32[at + 1]));
          at += 2;
          break;
        case Op.ADD: {
          const e = this.#real(i32[at + 1]);
          const componentId = i32[at + 2];
          const n = i32[at + 3];
          const fields = w.registry.fields[componentId];
          if (!fields) throw new Error(`command-buffer: unknown component ${componentId}`);
          const values = this.values;
          values.length = n;
          for (let v = 0; v < n; v++) {
            const raw = i32[at + 4 + v];
            values[v] = v < fields.length && fields[v].type === FieldType.entity ? this.#real(raw) : raw;
          }
          w.addId(e, componentId, n ? values : null);
          at += 4 + n;
          break;
        }
        case Op.REMOVE:
          w.removeId(this.#real(i32[at + 1]), i32[at + 2]);
          at += 3;
          break;
        case Op.SET: {
          const field = i32[at + 2];
          const type = Field.type(field);
          let value = i32[at + 3];
          if (type === FieldType.entity) value = this.#real(value);
          else if (type === FieldType.f32) {
            f32Bits[0] = value;
            value = f32[0];
          }
          w.set(this.#real(i32[at + 1]), field, value);
          at += 4;
          break;
        }
        default:
          throw new Error(`command-buffer: corrupt record ${i32[at]} at word ${at}`);
      }
    }
    spawned.fill(0, 0, maxProvisional + 1);
  }

  /** Maps a provisional handle of the current segment to its real handle; real handles pass through. @param {number} h */
  #real(h) {
    h >>>= 0;
    return h !== 0 && h < 0x10000 ? this.spawned[h] : h;
  }
}
