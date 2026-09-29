// @ts-check
// The manifest (docs/engine/02-core-ecs-jobs.md#component-manifest): components, systems and kernels,
// each numbered by sorted `static key`, identically on every thread. Its hash goes into the kernel
// registry, so a job worker built from a different list refuses to start (manifest-mismatch).
import { Hash32 } from '../core/hash32.js';
import { KernelRegistry } from '../jobs/kernel.js';
import { Field, FieldType } from './component.js';
import { SystemChunkKernel } from './ecs-env.js';

/** @typedef {import('./component.js').ComponentClass} ComponentClass */
/** @typedef {import('./system.js').SystemClass} SystemClass */

/** Statics a field name may not shadow. */
const RESERVED = new Set(['key', 'schema', 'renderOnly', 'id', 'name', 'length', 'prototype', 'caller', 'arguments']);

/** @param {{ key: string }} a @param {{ key: string }} b */
const byKey = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** @param {number} h @param {string} s */
function hashString(h, s) {
  for (let i = 0; i < s.length; i++) h = Hash32.step(h, s.charCodeAt(i));
  return Hash32.step(h, 0);
}

/**
 * Numbers components by key and installs their field handles as statics (`Health.hp`).
 * Installing is idempotent, so every thread (and every test) can build its own registry.
 */
export class ComponentRegistry {
  /** @param {ComponentClass[]} components */
  constructor(components) {
    /** @type {ComponentClass[]} */
    this.list = [...components].sort(byKey);
    /** @type {{ name: string, type: number, handle: number }[][]} fields per component ID */
    this.fields = [];
    let h = Hash32.begin(0x434f4d50); // 'COMP'
    for (let id = 0; id < this.list.length; id++) {
      const K = this.list[id];
      if (!K.key) throw new Error(`component ${K.name} has no static key`);
      if (id > 0 && this.list[id - 1].key === K.key) throw new Error(`duplicate component key ${K.key}`);
      const names = Object.keys(K.schema);
      if (names.length > Field.MAX_FIELDS) throw new Error(`component ${K.key} has more than ${Field.MAX_FIELDS} fields`);
      /** @type {{ name: string, type: number, handle: number }[]} */
      const fields = [];
      h = hashString(h, K.key);
      h = Hash32.step(h, K.renderOnly ? 1 : 0);
      for (let f = 0; f < names.length; f++) {
        const name = names[f];
        const type = FieldType[K.schema[name]];
        if (type === undefined) throw new Error(`component ${K.key}.${name}: unknown type ${K.schema[name]}`);
        if (type === FieldType.f32 && !K.renderOnly) throw new Error(`component ${K.key}.${name}: f32 is only allowed in render-only components`);
        if (RESERVED.has(name)) throw new Error(`component ${K.key}: field name ${name} is reserved`);
        fields.push({ name, type, handle: Field.make(id, f, type) });
        h = Hash32.step(hashString(h, name), type);
      }
      this.fields.push(fields);
    }
    this.hash = Hash32.end(h, this.list.length);
    this.install();
  }

  /** (Re)installs IDs and field handles on the component classes. */
  install() {
    for (let id = 0; id < this.list.length; id++) {
      const K = /** @type {any} */ (this.list[id]);
      Object.defineProperty(K, 'id', { value: id, writable: true, configurable: true });
      for (const f of this.fields[id]) Object.defineProperty(K, f.name, { value: f.handle, writable: true, configurable: true });
    }
  }

  /** @param {ComponentClass} K */
  id(K) {
    const id = this.list.indexOf(K);
    if (id < 0) throw new Error(`component ${K.key || K.name} is not in the manifest`);
    return id;
  }
}

/**
 * @typedef {object} ManifestSpec
 * @property {ComponentClass[]} components
 * @property {SystemClass[]} systems
 * @property {(typeof import('../jobs/kernel.js').Kernel)[]} [kernels] app kernels; the ECS adds its own
 */

export class Manifest {
  /** @param {ManifestSpec} spec */
  constructor(spec) {
    this.components = new ComponentRegistry(spec.components);
    /** @type {SystemClass[]} systems in ID order */
    this.systems = [...spec.systems].sort(byKey);
    /** @type {Map<SystemClass, number>} */
    this.systemIds = new Map();
    let h = Hash32.begin(this.components.hash);
    for (let id = 0; id < this.systems.length; id++) {
      const S = this.systems[id];
      if (!S.key) throw new Error(`system ${S.name} has no static key`);
      if (id > 0 && this.systems[id - 1].key === S.key) throw new Error(`duplicate system key ${S.key}`);
      this.systemIds.set(S, id);
      h = hashString(h, S.key);
    }
    this.kernels = new KernelRegistry([SystemChunkKernel, ...(spec.kernels ?? [])], Hash32.end(h, this.systems.length));
    this.hash = this.kernels.hash;
  }

  /** @param {SystemClass} S */
  systemId(S) {
    const id = this.systemIds.get(S);
    if (id === undefined) throw new Error(`system ${S.key || S.name} is not in the manifest`);
    return id;
  }
}
