// @ts-check
// Base class of every UI custom element (docs/engine/07-ui.md#uielement-base-class): template cloning
// into a shadow root, shared constructable stylesheets, and signal bindings that are disposed when the
// element disconnects. Main thread only.
import { Signals } from './signal.js';

/** @typedef {import('./signal.js').Signal<any> | import('./signal.js').Computed<any>} Readable */

/** @type {Map<string, CSSStyleSheet>} */
const sheets = new Map();
/** @type {Map<string, HTMLTemplateElement>} */
const templates = new Map();

export class UiElement extends HTMLElement {
  /** Custom-element tag name. */
  static tag = '';
  /** Shadow-root markup. */
  static template = '';
  /** Stylesheet texts; each distinct text becomes one shared CSSStyleSheet. */
  static styles = /** @type {string[]} */ ([]);

  /** @type {(() => void)[]} */
  #disposers = [];

  connectedCallback() {
    const K = /** @type {typeof UiElement} */ (this.constructor);
    if (!this.shadowRoot) {
      const root = this.attachShadow({ mode: 'open' });
      root.adoptedStyleSheets = K.styles.map((css) => UiElement.sheet(css));
      root.append(UiElement.#template(K).content.cloneNode(true));
    }
    this.connected();
  }

  disconnectedCallback() {
    for (const d of this.#disposers) d();
    this.#disposers = [];
    this.disconnected();
  }

  /** Called after the shadow root exists; set up bindings here. */
  connected() {}

  /** Called after the bindings were disposed. */
  disconnected() {}

  /** @template {Element} T @param {string} selector @returns {T} */
  $(selector) {
    const el = /** @type {ShadowRoot} */ (this.shadowRoot).querySelector(selector);
    if (!el) throw new Error(`${this.localName}: no ${selector} in the template`);
    return /** @type {T} */ (/** @type {unknown} */ (el));
  }

  /**
   * Calls `fn` with the source's value now and whenever it changes (at most once per frame).
   * @template T
   * @param {{ value: T }} source a Signal or Computed
   * @param {(value: T) => void} fn
   */
  bind(source, fn) {
    /** @type {{ v: T } | null} */
    let last = null;
    this.#disposers.push(
      Signals.effect(() => {
        const v = source.value;
        if (last && Object.is(last.v, v)) return;
        last = { v };
        fn(v);
      }),
    );
  }

  /** A shared stylesheet for a CSS text. @param {string} css */
  static sheet(css) {
    let s = sheets.get(css);
    if (!s) {
      s = new CSSStyleSheet();
      s.replaceSync(css);
      sheets.set(css, s);
    }
    return s;
  }

  /** @param {typeof UiElement} K */
  static #template(K) {
    let t = templates.get(K.tag);
    if (!t) {
      t = document.createElement('template');
      t.innerHTML = K.template;
      templates.set(K.tag, t);
    }
    return t;
  }

  /** Registers an element class once. @param {typeof UiElement} K */
  static define(K) {
    if (!K.tag) throw new Error(`${K.name} has no static tag`);
    if (!customElements.get(K.tag)) customElements.define(K.tag, /** @type {CustomElementConstructor} */ (/** @type {unknown} */ (K)));
  }
}
