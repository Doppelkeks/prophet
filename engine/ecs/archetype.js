// @ts-check
// An archetype: one set of components, and the column layout its ECS chunks share
// (docs/engine/02-core-ecs-jobs.md#archetype-chunks). Engine-thread object; the chunks describe
// themselves in the heap, so job workers never need it.
import { FIELD_BYTES, FieldType } from './component.js';
import { ENTITY_COLUMN, H } from './chunk-view.js';

/** @param {number} n */
const align16 = (n) => (n + 15) & ~15;

export class Archetype {
  /**
   * @param {number} id
   * @param {number[]} components sorted component IDs
   * @param {import('./registry.js').ComponentRegistry} registry
   * @param {number} chunkBytes
   */
  constructor(id, components, registry, chunkBytes) {
    this.id = id;
    this.components = components;
    this.sig = new Uint32Array(Math.max(1, Math.ceil(registry.list.length / 32)));
    for (const c of components) this.sig[c >>> 5] |= 1 << (c & 31);

    /** @type {number[]} field handle per column; column 0 holds the entity handles */
    this.fields = [ENTITY_COLUMN];
    /** @type {number[]} type code per column */
    this.types = [FieldType.entity];
    /** @type {boolean[]} whether a column is render-only (left out of state hashes) */
    this.renderOnly = [false];
    for (const c of components) {
      const K = registry.list[c];
      for (const f of registry.fields[c]) {
        this.fields.push(f.handle);
        this.types.push(f.type);
        this.renderOnly.push(K.renderOnly);
      }
    }
    /** @type {Map<number, number>} field handle → column */
    this.fieldColumn = new Map();
    for (let col = 1; col < this.fields.length; col++) this.fieldColumn.set(this.fields[col], col);

    const cols = this.fields.length;
    this.headerWords = align16((H.COL0 + cols * H.COL_STRIDE) * 4) >> 2;
    let rowBytes = 0;
    for (const t of this.types) rowBytes += FIELD_BYTES[t];
    let capacity = Math.floor((chunkBytes - this.headerWords * 4) / rowBytes);
    while (capacity > 0 && this.#layoutBytes(capacity) > chunkBytes) capacity--;
    if (capacity < 1) throw new Error(`archetype [${components.join(',')}] does not fit an ECS chunk of ${chunkBytes} bytes`);
    this.capacity = Math.min(capacity, 0xffff);
    /** Byte offset of each column from the chunk base. */
    this.offsets = [];
    let off = this.headerWords * 4;
    for (const t of this.types) {
      this.offsets.push(off);
      off += align16(this.capacity * FIELD_BYTES[t]);
    }

    /** Chunk byte offsets in creation order (the iteration order). */
    this.chunks = /** @type {number[]} */ ([]);
    this.nextSeq = 0;
    /** @type {Map<number, number>} cached archetype edges: +componentId / -(componentId + 1) → archetype ID */
    this.edges = new Map();
  }

  /** @param {number} componentId */
  has(componentId) {
    return (this.sig[componentId >>> 5] & (1 << (componentId & 31))) !== 0;
  }

  /** @param {number} capacity */
  #layoutBytes(capacity) {
    let bytes = this.headerWords * 4;
    for (const t of this.types) bytes += align16(capacity * FIELD_BYTES[t]);
    return bytes;
  }
}
