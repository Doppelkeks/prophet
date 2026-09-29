// @ts-check
// Archetype IDs. The game's setup creates them in this order before tick 0, so they are constants that
// systems on any thread can use in command buffers.
export const ARCHETYPES = Object.freeze({
  empty: 0,
  pilot: 1,
  run: 2,
});
