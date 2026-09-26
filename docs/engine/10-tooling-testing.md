# Tooling & Testing

This doc covers how Prophet and SCRAPWAKE are developed, built, checked and measured. There is no build step in the development loop, and hot reload covers shaders, CSS and data. The whole test pyramid runs without a GPU in CI (using SwiftShader), with a device lab for real hardware.

## Goals

- **Fast iteration.** Save a WGSL, CSS or JSON file and see the change in under a second, without restarting the run.
- **Reproducible builds.** Same commit + same toolchain lock = the same bundle bytes.
- **Automated guardrails** for the things that silently rot: frame budgets, determinism, the combat HUD rules, and bans on non-deterministic APIs in sim code.
- **A small toolchain.** Node, esbuild and Playwright, plus TypeScript for checking only ([ADR-002](../DECISIONS.md#adr-002-zero-runtime-dependencies)).

## Non-goals

- A full scene or level editor. Procedural generation and data files replace hand-built levels, and in-game dev tools cover inspection and tweaking.
- Bundling in development; the browser loads native ES modules.
- Test frameworks beyond `node:test` and Playwright.

## Game requirements served

| Need | Tooling |
|---|---|
| Tune pacing, balance and feel quickly | Hot-reloaded JSON data, director timeline scrubber, spawn menu |
| Iterate the pixel-art look | Hot-reloaded WGSL, crawl tests, golden images |
| Keep the swarm deterministic and fast | JS reference implementation, replay hashes, perf scenes |
| Ship on five platforms without regressions | Browser and Electron smoke tests, device-lab matrix |

---

## Dev server

`tools/dev-server.js` is a zero-dependency Node script built on `node:http`, `node:fs` and `node:path`.

- **Serves** the repo root as static files with correct MIME types, including `.wgsl` (text) and `.vox` (binary).
- **Sends COOP/COEP/CORP on every response**, so `crossOriginIsolated` is true in development and the `shared` threading tier works exactly as in production.
- **Live events** go over Server-Sent Events at `/__events`, with no WebSocket dependency. A recursive `fs.watch` classifies each change:

| Change | Reaction |
|---|---|
| `*.wgsl` | Recompile the affected pipelines asynchronously and swap them at a frame boundary. The run continues. |
| `*.css` | `replaceSync` on the shared constructable stylesheet ([07](07-ui.md#css-architecture)). Instant; the run continues. |
| `game/data/*.json` | Reload the data tables. Values that are safe to hot-swap (costs, rates) apply live; structural changes restart the run. |
| `*.vox`, source art | Re-cook through the [asset pipeline](#asset-pipeline), then reload the affected models or kits |
| `*.js` | Full reload, then **restart the run with the same seed and replay the command log** up to the current tick. Determinism lets you keep testing from roughly where you were ([09](09-determinism-coop.md#replays-and-hashes)). |

- **Testing on phones.** Shared memory needs a secure context:
  - **Android:** `adb reverse tcp:PORT tcp:PORT`, then open `http://localhost:PORT` in Chrome on the device.
  - **iOS:** the dev build of the host app can point its web view at the dev server (a debug-only setting). Remote inspection works through Safari Web Inspector.

## Build

- **Bundler:** esbuild, a dev dependency, configured as follows:
  - Entry points: `main`, `engine-worker` and `job-worker`.
  - Output: ES modules with code splitting, minification and content-hashed filenames.
  - `define: { DEV: false }`, which strips asserts and dev tools.
  - WGSL files are imported as text.
- **Outputs:**
  - `dist/web/`, the static site ([08](08-platforms.md#web)).
  - The Electron app, which copies `dist/web/` into its resources and adds the main and preload scripts.
  - Mobile shell payloads: the iOS host bundle and the Android TWA project (Bubblewrap).
- **Reproducibility.** Every build pins its inputs:
  - `package-lock.json`
  - Node, from `.nvmrc`
  - Electron, as an exact version
  - the Playwright browsers

  Build metadata records the git SHA and a hash of the cooked assets.
- **Build hash.** This hash goes into saves and replays, so incompatible replays are detected ([09](09-determinism-coop.md#replays-and-hashes)).

---

## Asset pipeline

| Source | Tool | Cooked output |
|---|---|---|
| MagicaVoxel `.vox`: PATCH parts, enemies, towers, props | `tools/cook.js` (our own `.vox` parser) | Meshed part models (palette-indexed quads, socket markers, pivots) |
| MagicaVoxel `.vox`: prefab kits for buildings | `tools/cook.js` | Prefab kits with voxel data, structural elements, sockets and tags ([06](06-world.md#procedural-generation)), validated for structure and caps |
| Palette definition (art bible) | `tools/cook.js` | 32³ colour-grading LUT, and CSS tokens for the UI ([game/03-art-audio](../game/03-art-audio.md#palette)) |
| PNG: UI images, pixel-font atlases | `tools/cook.js` | Atlases plus metadata |
| WOFF2 fonts (OFL) | Copied | Preloaded font files |
| WAV/FLAC audio | External encoder in the pipeline | Compressed audio. The codec per platform is chosen in M1 by probing what Safari, Chrome and Electron decode. |
| JSON game data: parts, chips, towers, enemies, waves, districts | `tools/validate.js` (our own small schema checker) | Validated, minified tables |
| Component schemas | `tools/gen-manifest.js` | The **component manifest** with stable IDs and a schema hash ([02](02-core-ecs-jobs.md#memory-heap-and-arenas)) |
| State-block schema | `tools/gen-state-block.js` | Shared field offsets for the engine and UI ([07](07-ui.md#state-bridge)) |

- **Incremental.** Content hashes skip unchanged inputs. A `manifest.json` maps logical names to hashed files.
- **Validation is strict.** Missing sockets, palette-locking violations, prefab kits without structural elements, or data referencing unknown IDs fail the cook, and with it the CI run.

---

## Dev tools

Dev tools ship in dev builds only. They are DOM custom elements, loaded lazily with `import()`, and toggled with a hotkey or a gamepad chord.

| Tool | What it shows or does |
|---|---|
| **Perf overlay** | CPU time per system and job, GPU time per pass (via `timestamp-query` when present), a frame-time graph, heap arena usage, JS heap size, long tasks, entity and swarm counts, event-buffer fill %, and readback latency, all against the [BUDGETS](../BUDGETS.md) targets |
| **ECS inspector** | Archetypes, entities and component values, with live editing of non-deterministic-safe fields in paused mode |
| **Swarm debug views** | Spatial-bin heat map, flow-field vectors, unit IDs and types, status overlays, the event log |
| **World tools** | Voxel brush (carve, place, damage by material), structural-graph view, collapse trigger, nav cost-grid view |
| **Director tools** | Timeline scrubber (jump to minute N), spawn-budget graph, force an assault, a spawn menu for enemies, parts and towers |
| **Replay controls** | Record, play back and step; state-hash display; desync diff viewer |
| **Platform tools** | Tier override, threading-tier override, simulated K-latency and readback delay, a "lose device" button (calls `device.destroy()`), a pseudo-locale toggle |

---

## Testing strategy

| Layer | Runner | What it covers |
|---|---|---|
| **Unit** | `node --test`, pure JS, fast | Fixed-point math and trig LUT; RNG hash; arena allocators; ECS (archetype moves, queries, change ticks); command-buffer ordering; scheduler (serial vs parallel give identical results); job system on `worker_threads` + SharedArrayBuffer; seqlock; signals; flow fields on known maps; voxel edits; structural collapse scenarios; PCG determinism (hash per seed) |
| **GPU** | Playwright + Chromium headless (`--enable-unsafe-webgpu`, SwiftShader in CI) | Every pipeline variant compiles; **swarm kernels vs the JS reference implementation** give bit-identical state hashes ([05](05-gpu-swarm.md#reference-implementation)); readback-ring behaviour; device-loss recovery |
| **Visual** | Playwright golden images | Pixel pipeline stages; **crawl tests**: sub-pixel camera pans must produce pure integer translations ([04](04-pixel-art-pipeline.md#look-dev-tests)) |
| **UI** | Playwright | Screenshots per screen and device profile; keyboard, touch and synthetic-gamepad flows; pseudo-locale; combat-HUD performance ([07](07-ui.md#testing)) |
| **Replay** | Playwright + headless build | Recorded runs replayed; state hashes every N ticks must match the recorded ones (level L1 in CI; L2 on the device lab; [09](09-determinism-coop.md#determinism-levels)) |
| **Performance** | Bench scenes in headless builds | Swarm stress, destruction stress, UI stress, district generation, flow-field solve, compared with [BUDGETS](../BUDGETS.md) |
| **Soak** | Nightly | 30-minute scripted runs: memory growth, GC pauses, event overflow, arena high-water marks |
| **Device lab** | Manual or semi-automated | The M1 matrix and milestone exit metrics on the [reference devices](../BUDGETS.md#reference-devices) |
| **Playtests** | Humans | M2′ loop prototype KPIs ([game/01-gdd](../game/01-gdd.md#kpis)) |

**Rules:**
- Tests are deterministic: fixed seeds, fixed tick counts, and no wall-clock dependencies in sim tests.
- A flaky test is a bug. There are no automatic retries.
- Performance thresholds come from BUDGETS.md.
  - On CI hardware without a GPU, only CPU-side timings and relative trends are asserted.
  - Absolute GPU budgets are asserted on the device lab and on an optional self-hosted GPU runner.

**Sim-code API lint.** A small zero-dependency script enforces the [rules for sim code](09-determinism-coop.md#rules-for-sim-code) ([ADR-012](../DECISIONS.md#adr-012-integer-deterministic-simulation)).

- **Scope:** only simulation code.
  - `engine/**/sim/`
  - `game/systems/sim/`
  - the WGSL kernels in `game/shaders/sim/` and `engine/swarm/`

  Render-only code (`game/systems/view/`, `game/shaders/render/`) may use floats and is not scanned.
- **Banned in JS sim code:**
  - `Math.random` and every transcendental or float helper: `sin`, `cos`, `tan`, `atan2`, `exp`, `log`, `pow`, `sqrt`, `hypot`, `cbrt`
  - `Date.now`, `performance.now`, `crypto.getRandomValues`
  - `Intl` and `localeCompare`
  - `WeakRef` and `FinalizationRegistry`
  - float typed arrays (`Float32Array`, `Float64Array`) on sim state
- **Banned in WGSL sim kernels:** float types and literals, float atomics, and non-integer built-ins.
- **Enforcement:** any hit fails CI. An exception needs an explicit, reviewed `// sim-allow: <reason>` comment on the line.

---

## Continuous integration

GitHub Actions workflows:

| Workflow | Trigger | Steps | Target time |
|---|---|---|---|
| `check` | Every push and PR | `tsc --checkJs --noEmit`, sim-code API lint, data validation, unit tests | < 5 min |
| `browser` | Every PR | Playwright WebGPU (SwiftShader) tests, golden images, UI screenshots, replay hashes (L1) | < 15 min |
| `build` | Merge to main | Web bundle; Electron packages on Windows, macOS and Linux runners; asset cook | < 20 min |
| `preview` | Every PR (web) | Deploy the web build to a preview host **with COOP/COEP headers**; post the link | < 5 min |
| `nightly` | Scheduled | Soak tests, perf-trend scenes, full replay corpus, optional self-hosted GPU runner | — |

- Playwright browsers are cached, so the dev container's preinstalled Chromium is reused.
- Test artifacts are stored for failed runs: golden-image diffs, replay desync reports, perf traces.
- Branch protection requires `check` and `browser` to pass.

## Release process

- **Versioning:**
  - The engine uses semver tags (`engine-vX.Y.Z`).
  - The game uses build numbers plus a public version string.
  - Saves and replays carry the build hash.
- **Channels:**
  - Steam: branches (`beta`, `default`), with depots uploaded via `steamcmd`, scripted in CI from M7.
  - Web: preview → staging → production.
  - Mobile: TestFlight and a Play internal track.
- **Changelogs** are generated from conventional commit messages and edited by hand for players.

---

## Thread ownership

The tools themselves run in Node (dev server, cooker, validators, CI scripts). The in-game dev tools are DOM elements on the main thread that read engine data through the same bridges as the UI ([07](07-ui.md#state-bridge)), plus a dev-only debug channel.

## Budgets

The runtime budgets that the tooling checks all live in [BUDGETS.md](../BUDGETS.md). The CI target times above are process goals, not runtime budgets.

## Fallbacks & failure modes

| Situation | Behaviour |
|---|---|
| No GPU in CI | SwiftShader WebGPU. GPU performance is asserted only on the lab or a GPU runner. |
| `fs.watch` recursive watching unsupported on a dev OS | Fall back to polling for the watched directories |
| Hot-swapped shader fails to compile | Keep the old pipeline, show the error in the overlay, keep running |
| Data hot reload would break invariants | Restart the run with the same seed and replay the command log |

## Testing

This doc *is* the testing strategy. Meta-tests keep the tooling honest:
- the dev server's headers (`crossOriginIsolated` in a Playwright check)
- the cooker's idempotence (cooking twice gives identical hashes)
- the manifest generator's stability (adding a component doesn't renumber existing ones)

## Open questions

- Should we add a self-hosted GPU runner for absolute GPU budget checks? Decide in M2 based on how noisy the device-lab numbers are.
- Our own lint script or ESLint for the sim-code API bans? Default is our own script (zero dependencies); revisit if the rules grow.
- Should the replay corpus store full command logs or periodic checkpoints plus logs, to keep CI time bounded?
