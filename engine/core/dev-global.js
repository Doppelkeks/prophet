// @ts-check
// First import of every entry point (game/app/*). Defines the DEV flag in development builds.
// Release builds are bundled by esbuild with `define: { DEV: 'false' }`, which replaces every
// bare `DEV` identifier at build time; they also carry PX_BUILD, so the global says false there too.
const g = /** @type {{ DEV?: boolean }} */ (/** @type {unknown} */ (globalThis));
if (typeof g.DEV === 'undefined') g.DEV = typeof PX_BUILD === 'undefined';

export {};
