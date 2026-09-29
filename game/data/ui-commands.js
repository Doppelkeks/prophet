// @ts-check
// SCRAPWAKE's UI commands (docs/engine/07-ui.md#state-bridge): sent by the main thread, stamped into the
// command log by the engine, applied by UiCommandSystem on their tick. Codes are part of the replay format.

export const UiCommand = Object.freeze({
  /** Director stress +1: every wave spawns (1 + stress) × its base count. */
  STRESS_UP: 1,
  /** Director stress −1. */
  STRESS_DOWN: 2,
  /** An immediate ring of `a` Scrubbers around PATCH (0 = BURST_COUNT). */
  BURST: 3,
});

export const MAX_STRESS = 15;
export const BURST_COUNT = 512;
