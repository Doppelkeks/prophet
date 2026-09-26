# Architecture & Design Decisions

This file is the ADR log (Architecture Decision Records). Each record states the **context**, the **decision** and its **consequences**, and says when to **revisit** it. Numbers referenced here live in [BUDGETS.md](BUDGETS.md).

Status values:
- **Accepted**: we build on it.
- **Proposed**: a hypothesis. A named milestone must validate it.
- **Superseded**: replaced by a later record.

| ID | Decision | Status | Validated in |
|---|---|---|---|
| [ADR-001](#adr-001-pure-class-based-javascript) | Pure class-based JavaScript | Accepted | — |
| [ADR-002](#adr-002-zero-runtime-dependencies) | Zero runtime dependencies | Accepted | — |
| [ADR-003](#adr-003-webgpu-only) | WebGPU only, core feature level | Accepted | M1 |
| [ADR-004](#adr-004-one-web-build-electron-for-desktop) | One web build; Electron for desktop | Accepted | M1 |
| [ADR-005](#adr-005-mobile-shells) | Mobile shells: iOS host + localhost server, Android TWA | Accepted | M1, M8 |
| [ADR-006](#adr-006-real-htmlcss-ui) | Real HTML/CSS UI; world-space UI in WebGPU | Accepted | M5 |
| [ADR-007](#adr-007-runtime-topology-and-framedriver) | Runtime topology and FrameDriver | Accepted | M1 |
| [ADR-008](#adr-008-threading-tiers) | Threading tiers: shared / transfer / inline | Accepted | M1 |
| [ADR-009](#adr-009-fixed-size-shared-heap) | Fixed-size shared heap with arenas | Accepted | M1 |
| [ADR-010](#adr-010-archetype-ecs-with-profile-driven-parallelism) | Archetype ECS, profile-driven parallelism | Accepted | M5 |
| [ADR-011](#adr-011-two-tier-simulation) | Two-tier simulation (CPU actors + GPU swarm) | Accepted | M2 |
| [ADR-012](#adr-012-integer-deterministic-simulation) | Integer, deterministic simulation | Proposed | M5 |
| [ADR-013](#adr-013-60-hz-fixed-tick) | 60 Hz fixed tick | Accepted | M2′, M5 |
| [ADR-014](#adr-014-voxel-world-format-and-district-size) | Voxel format and district size | Accepted | M3 |
| [ADR-015](#adr-015-structural-graphs-for-collapse) | Structural graphs for collapse | Proposed | M3 |
| [ADR-016](#adr-016-cpu-binary-greedy-meshing) | CPU binary greedy meshing by default | Proposed | M4 |
| [ADR-017](#adr-017-25d-navigation-with-flow-fields) | 2.5D navigation with flow fields | Accepted | M3 |
| [ADR-018](#adr-018-pixel-exact-projection) | Pixel-exact oblique projection | Proposed | M4 |
| [ADR-019](#adr-019-fodder-is-not-saved) | Fodder is not saved | Accepted | M6 |
| [ADR-020](#adr-020-minimum-spec) | Minimum spec | Accepted | M1 |
| [ADR-021](#adr-021-steam-via-a-thin-ffi-shim) | Steam via a thin FFI shim | Proposed | M7 |
| [ADR-022](#adr-022-scrap-is-both-xp-and-currency) | Scrap is both XP and currency | Proposed | M2′ |
| [ADR-023](#adr-023-banked-level-ups-and-real-time-building) | Banked level-ups; real-time building | Proposed | M2′ |

---

## ADR-001: Pure class-based JavaScript

**Status:** Accepted (user decision).

**Context:** We evaluated four stacks:

| Stack | Strength | Why it lost |
|---|---|---|
| Rust → WASM, with `wgpu` on native | Best performance ceiling | Needs a custom UI renderer |
| C#/.NET | Familiar language | WASM multithreading is still immature; native builds would need webview-overlay UI plumbing |
| TypeScript | Type safety | Adds a build step |
| Plain JavaScript | Real HTML/CSS UI, one runtime everywhere | Chosen, with desktop shipped via Electron |

**Decision:**
- ES2023+ modules and classes (`#private` fields, `static` blocks). No TypeScript syntax, and no transpilation in development.
- Types are written as JSDoc and checked in CI with `tsc --checkJs --noEmit`. TypeScript is a dev dependency only.

**Consequences:**
- ➕ No build step in development. We get browser DevTools, trivial hot reload, and a single language across engine, game, UI and tools.
- ➖ JS has no SIMD, its JIT behaviour varies, and it has a garbage collector. Mitigations:
  - data-oriented typed arrays ([ADR-009](#adr-009-fixed-size-shared-heap))
  - GPU-first simulation ([ADR-011](#adr-011-two-tier-simulation))
  - WASM SIMD kernels running on the same heap, as an escape hatch

**Revisit when:** a profiled hotspot over 2 ms can't move to the GPU. Even then the answer is a WASM kernel, not a language change.

## ADR-002: Zero runtime dependencies

**Status:** Accepted.

**Decision:** The shipped engine and game code has **no npm dependencies**.

Allowed:
- **Dev and packaging tools:** `esbuild`, `electron`, `electron-builder`, `@playwright/test`, `typescript` (type-checking only), `@bubblewrap/cli`.
- **Platform-edge code, isolated in `platforms/`:** a Steam FFI shim and, optionally, Capacitor on iOS.

**Consequences:**
- We own and maintain every runtime piece: ECS, jobs, render graph, UI runtime (signals, components), audio mixer, `.vox` parser, procedural generation (PCG), math, save format.
- Licensing is simple, and we can profile everything.

**Revisit when:** someone proposes a runtime dependency. It is admitted only through a new ADR that justifies its size, maintenance and security.

## ADR-003: WebGPU only

**Status:** Accepted. The support matrix is validated in M1.

**Context:** The design is compute-heavy: swarm simulation, GPU culling, particles, light binning and procedural animation. That is not feasible on WebGL2 at our [entity caps](BUDGETS.md#entity-caps). WebGPU ships in:
- Chrome and Edge
- Safari 26 (macOS, iOS, iPadOS)
- Firefox on Windows and Apple Silicon

Electron gives us a known Chromium on desktop.

**Decision:**
- WebGPU at the **core** feature level. No WebGL2 fallback, and no compatibility mode.
- We stay within the **default limits** (see [engine/03-rendering.md](engine/03-rendering.md#webgpu-limits-policy)).
- Optional features (`subgroups`, `shader-f16`, `timestamp-query`, `texture-compression-*`) are used only when present, and always have a fallback path.

**Consequences:** This excludes:
- iOS < 26
- Firefox on Linux and Android (Nightly only as of Sep 2026)
- Android devices without Vulkan or with not-yet-supported GPUs, roughly 10 % of Android users by Google's estimate

See [ADR-020](#adr-020-minimum-spec).

**Revisit when:** web-demo or Android analytics (M7/M8) show material audience loss. The first lever is WebGPU **compatibility mode** (shipped in Chrome 146; opt in with `featureLevel: "compatibility"`), which reaches OpenGL ES 3.1 Android devices. It forbids vertex-stage storage buffers and caps workgroups at 128 invocations, so it would need an alternate vertex path and reduced caps. A reduced WebGL2 *demo* renderer is the last resort, never one for the full game.

## ADR-004: One web build, Electron for desktop

**Status:** Accepted.

**Decision:**
- One web build is the product.
- Desktop ships it inside **Electron 44** (Chromium 152):
  - A privileged custom scheme is served via `protocol.handle`, which adds COOP/COEP/CORP headers to every response, worker scripts included. This is what makes `crossOriginIsolated` true.
  - Per-OS GPU switches handle Linux/AMD and the Steam Deck.

  Details: [engine/08-platforms.md](engine/08-platforms.md#desktop-electron).

**Consequences:**
- ➕ One known Chromium on every desktop.
- ➖ An installer of ~100 MB. The GPU sandbox trade-offs around the Steam overlay are covered in [ADR-021](#adr-021-steam-via-a-thin-ffi-shim).

**Revisit when:** Electron's Linux GPU issues block the Steam Deck. The alternatives would be CEF, or a per-OS webview shell.

## ADR-005: Mobile shells

**Status:** Accepted. Validated on real devices in M1 and shipped in M8.

**Decision:**
- **iOS 26+:** a thin WKWebView host app. It is our own Swift template; Capacitor 8 is acceptable if we need its plugins.
  - It serves the *bundled* build from an **in-app `http://localhost` server** that sends COOP/COEP/CORP headers. WebKit ignores these headers on custom schemes such as `capacitor://`.
  - The server restarts when the app returns to the foreground.
- **Android:** a **Trusted Web Activity** (Bubblewrap). It runs our build in Chrome, which gives us WebGPU and SharedArrayBuffer. It requires:
  - a verified domain (Digital Asset Links)
  - a service worker that precaches all assets
  - a cloud backup of meta saves, because a TWA's storage is shared with Chrome
- **Android fallback:** our own WebView host. Android System WebView never supports cross-origin isolation, so this host runs only the `transfer` threading tier.

**Consequences:**
- Android needs hosting and a first-launch download.
- iOS needs a small native host that we maintain.
- Apple guideline 2.5.2 forbids downloaded code, so all JS is bundled into the app.
- Digital goods on Android go through Play Billing.

**Revisit when:** Android WebView gains cross-origin isolation, or the M1 matrix shows TWA hosts vary too much between devices.

## ADR-006: Real HTML/CSS UI

**Status:** Accepted.

**Decision:**
- UI is a DOM overlay built from custom elements, written as classes, with our own small signal store.
- Engine → UI data flows through a **seqlocked** shared-memory state block (at ≤ 30 Hz) plus `postMessage` events.
- High-count, world-anchored UI is drawn in WebGPU: health bars, damage numbers, tower ranges, blueprint ghosts.
- The combat HUD has strict CSS rules (see [engine/07-ui.md](engine/07-ui.md#combat-hud-rules)).

**Consequences:**
- ➕ All of modern CSS (flexbox, grid, container queries, `:has()`, View Transitions) is available.
- ➖ DOM work must never block the simulation, which is why the engine runs in a worker.
- ➖ A console port would need a different UI backend.

**Revisit when:** the mobile HUD budget can't be met. The response is to move more of the HUD into WebGPU.

## ADR-007: Runtime topology and FrameDriver

**Status:** Accepted.

**Decision:**
- **Main thread:** DOM, input capture, gamepad polling, Web Audio and the platform bridge.
- **Engine worker:** owns the simulation and the WebGPU device (via OffscreenCanvas). It **never blocks**: it helps drain the job queue, then yields to its event loop.
- **Job workers:** block in `Atomics.wait`.
- **FrameDriver:** uses `requestAnimationFrame` inside the worker where it exists, and otherwise main-thread rAF pings (Safari has no rAF in workers).
- **Fallback:** if WebGPU in workers is unavailable, the engine runs on the main thread.

Details: [engine/01-overview.md](engine/01-overview.md#runtime-topology).

**Consequences:**
- Input crosses a thread boundary through a shared-memory ring buffer.
- The Gamepad API exists only on the main thread, so main-thread jank shows up as input latency. This is why the combat HUD rules exist.

## ADR-008: Threading tiers

**Status:** Accepted.

**Decision:** The engine picks a threading tier at startup, based on `crossOriginIsolated` and feature probes:

| Tier | What runs in parallel |
|---|---|
| `shared` | SharedArrayBuffer job system: parallel ECS plus async jobs |
| `transfer` | Coarse async jobs only (PCG, flow fields, connectivity, meshing), passed as transferable `ArrayBuffer`s |
| `inline` | Nothing; everything on one thread. For tests only. |

**Consequences:**
- Every async job must be written as a pure function over byte buffers, so the same code runs in the `shared` and `transfer` tiers.
- Chunk-parallel ECS systems exist only in the `shared` tier.

## ADR-009: Fixed-size shared heap

**Status:** Accepted.

**Decision:**
- One `WebAssembly.Memory` holds all hot data. It is shared when the page is cross-origin isolated.
- Its size is fixed per tier: initial = maximum, and it is **never grown**. It is split into per-subsystem arenas; see [BUDGETS.md](BUDGETS.md#shared-heap).
- Every thread creates its typed-array views once.
- Component IDs come from a **generated manifest**. The archetype and column tables live in the heap together with an **epoch** counter.

**Context:** Growing a memory detaches every non-shared view. With shared memory, growth leaves stale-length views in every worker. Large `maximum` reservations fail on mobile.

**Consequences:**
- Caps are fixed up front, and every arena needs an overflow policy.
- WASM kernels can later run on the same memory with zero copies.

## ADR-010: Archetype ECS with profile-driven parallelism

**Status:** Accepted.

**Decision:**
- Archetype SoA chunks. Systems are classes that declare `reads` and `writes`, and the scheduler builds stages from those declarations.
- By default, systems run on the sim thread (the engine worker).
- A system that measures over the [parallelism threshold](BUDGETS.md#engine-worker-per-frame) is split into chunk jobs, in the `shared` tier.
- Async work always runs on job workers: PCG, flow fields, connectivity, meshing.

**Context:**
- Waking a thread costs ~50–500 µs on mobile, so fork/join doesn't pay off for small systems.
- CPU actor counts are small because fodder lives on the GPU ([ADR-011](#adr-011-two-tier-simulation)).

**Consequences:**
- Multithreading is real, but applied only where it pays.
- The scheduler must run both modes transparently. A system must never know which thread it runs on.

## ADR-011: Two-tier simulation

**Status:** Accepted. Stress-tested in M2.

**Decision:**
- **CPU actors (ECS):** PATCH, towers, specialists, bosses, caches, the Forge, the director.
- **GPU swarm:** fodder, projectiles and pickups, all deterministic. Cosmetic GPU particles and debris voxel particles run alongside, excluded from determinism.
- **Contract:** the **CPU decides *when/what*; the GPU decides *who/where*.**
- **CPU → GPU, each tick:**
  - spawns
  - area effects
  - fire commands carrying a target policy (nearest, strongest, first, chain)
  - actor proxies
- **GPU → CPU:**
  - tick-stamped events, applied at tick *T+K*
  - exact GPU-side counters
  - low-resolution density and threat maps

Details: [engine/05-gpu-swarm.md](engine/05-gpu-swarm.md).

**Consequences:**
- ➕ Towers and weapons never aim at stale readback positions.
- ➕ Hit feedback (flashes, damage numbers) is spawned on the GPU, so it is instant.
- ➖ Swarm units have a fixed behaviour and status vocabulary; they cannot run arbitrary scripts.
- ➖ Save/suspend skips fodder ([ADR-019](#adr-019-fodder-is-not-saved)).

## ADR-012: Integer deterministic simulation

**Status:** Proposed. Validated in M5 by replay hashes across browsers and GPUs.

**Decision:**
- The **simulation is integer-only**, in both JS and WGSL:
  - `i32` fixed-point numbers
  - our own trigonometry lookup table and `isqrt`
  - ID tie-breaks wherever order matters
  - integer atomics, which are order-independent
- Floats are used only in rendering.
- Randomness comes from a stateless hash RNG.
- CI runs replay-hash tests.

Rules: [engine/09-determinism-coop.md](engine/09-determinism-coop.md).

**Consequences:**
- ➕ Lockstep co-op becomes possible.
- ➕ Replays, bug reproduction and regression tests come for free.
- ➖ `Math.sin`, `Math.pow` and float atomics are banned in sim code. Code review checks this, and a lint rule enforces it.

**Revisit when:** cross-GPU hashes can't be made identical. We would then keep per-device determinism (for replays and tests) and plan co-op as host-authoritative with a capped swarm.

## ADR-013: 60 Hz fixed tick

**Status:** Accepted.

**Decision:**
- The simulation runs at a 60 Hz fixed tick, and rendering is interpolated between ticks.
- At most a fixed number of ticks run per rendered frame. Past that, the game slows down instead of spiralling.
- On mobile, the swarm can run at half rate.

Values: [BUDGETS.md](BUDGETS.md#simulation-constants).

**Alternative considered:** a 30 Hz tick. It is cheaper, but adds latency to dash-heavy action and aim override.

**Consequences:** Every system has a per-tick budget.

## ADR-014: Voxel world format and district size

**Status:** Accepted.

**Decision:**
- Voxels are 0.25 m, encoded as 1 byte: a 6-bit material and a 2-bit damage stage.
- Voxels are stored in 32³ chunks, with a smaller district size on mobile and a cap on dense chunks.
- Untouched chunks are regenerated from the seed, so saves store only deltas.

Values: [BUDGETS.md](BUDGETS.md#world-constants).

**Consequences:**
- PCG must be deterministic and fast.
- Height is capped, which keeps both memory and occlusion under control.

## ADR-015: Structural graphs for collapse

**Status:** Proposed. Validated in M3.

**Decision:**
- Prefab kits carry structural elements (pillars, slabs, walls), so every generated building is a **graph** of those elements.
- A building collapses when graph connectivity to the ground is lost.
- Debris is **kinematic**: no rigid-body solver. It falls, lands, and shatters into GPU voxel particles.
- Player-built walls and small freeform chunks are handled by a flood fill capped at one chunk.

**Context:** Flood-filling a large building takes about 5–20 ms, and capping the search leaves buildings floating.

**Consequences:** Artists author structure metadata alongside the prefab kits. The asset cooker validates it.

## ADR-016: CPU binary greedy meshing

**Status:** Proposed. Validated in M4.

**Decision:**
- The default mesher is **binary greedy meshing** in job workers. It uses 32-bit column masks, which map naturally onto JS's 32-bit bitwise operators.
- Remeshes are capped per frame.
- In look-dev we spike a **brickmap compute raymarch** at internal resolution as the alternative.

**Context:** GPU meshing needs a count → scan → emit pass chain, a GPU-side allocator and a compaction step.

**Consequences:** The render pipeline stays simple. Meshing costs a worker budget.

## ADR-017: 2.5D navigation with flow fields

**Status:** Accepted.

**Decision:**
- The world has a single walkable layer.
- **Base field:** bucket-queue Dijkstra. Wall costs are quantized into a few HP buckets, and the field is re-solved at a capped rate, double-buffered.
- **Player field:** a coarser grid covering the whole map.
- A breach opens a path only once it is at least the minimum width.

Values: [BUDGETS.md](BUDGETS.md#world-constants). Details: [engine/06-world.md](engine/06-world.md#navigation).

**Consequences:** Ground units get no multi-storey interiors. Flyers ignore walls and steer directly, optionally blended with the fields.

## ADR-018: Pixel-exact projection

**Status:** Proposed. Decided in M4 with golden-image "crawl" tests.

**Decision:**
- The default hypothesis is a **3/4 oblique projection** at a constant pixel density on every axis, so one world voxel is exactly 2×2 px.
- Camera yaw snaps in 90° steps.
- The internal resolution comes from an integer scale.
- Characters face 16 quantized directions and animate their poses at 12 fps.

Values: [BUDGETS.md](BUDGETS.md#pixel--camera-constants).

**Alternative:** orthographic projection at 40–50° pitch, with texel snapping. Snapping fixes shimmer while panning, but projected voxel heights stay non-integer (about 0.64–0.77 px per character voxel), so rows come out uneven and characters "boil" as they rotate. A 30° pitch is worse on both counts and also hides 1.73× a building's height of ground. The comparison table is in [04](engine/04-pixel-art-pipeline.md#projection).

**Consequences:** The camera is not free-orbit, except in an optional photo mode that accepts crawl.

## ADR-019: Fodder is not saved

**Status:** Accepted.

**Decision:**
- Mid-run checkpoints store CPU actors, the economy, voxel deltas and the director's state. They are taken after each assault and on a timer.
- Fodder, projectiles and particles are dropped. On resume, the director respawns fodder at the district's spawn edges.

**Consequences:**
- A resumed run is not bit-identical to the moment of suspend. That is acceptable.
- Resume stays fast.

## ADR-020: Minimum spec

**Status:** Accepted. Re-checked in M1 and before each launch.

**Decision:**
- **Browsers:**
  - Chrome/Edge 113+ on Windows, macOS and ChromeOS.
  - Chrome on Linux where WebGPU is enabled by default (144+ with Intel Gen12+; 147+ with NVIDIA on Wayland).
  - Chrome on Android 12+:
    - 121+ for Qualcomm and ARM GPUs
    - 139+ for Imagination
    - Samsung Xclipse expected around 154
  - Safari 26+ on macOS, iOS and iPadOS (Safari 27 shipped in September 2026).
  - Firefox 141+ on Windows, and 145+ on Apple Silicon with macOS 26 (147+ on every macOS version).
- **Desktop app:** Electron 44 on the OS versions Electron supports, including SteamOS with the switches from [ADR-004](#adr-004-one-web-build-electron-for-desktop).
- **Phones:** iPhone 13 (A15) or newer on iOS 26, and Android phones with Chrome-supported WebGPU GPUs.

**Consequences:** The store pages and the web demo's "unsupported" screen must state these requirements clearly.

## ADR-021: Steam via a thin FFI shim

**Status:** Proposed. Implemented in M7.

**Decision:**
- Steam integration covers achievements, stats, cloud saves and rich presence.
- It goes through a thin FFI binding to the `steam_api` flat C API. We will evaluate `steamworks-ffi-node` against our own shim.
- The Steam overlay is **optional**, for three reasons:
  - It requires `--in-process-gpu`, so a GPU crash takes down the whole app.
  - It is broken in native Linux builds.
  - On the Deck, gamescope provides the overlay anyway.

**Context:** `steamworks.js` is stale; its last release was in August 2024.

## ADR-022: Scrap is both XP and currency

**Status:** Proposed. Validated in the M2′ loop prototype.

**Decision:**
- One pickup, **Scrap**, does two jobs (the Brotato model):
  - *Total collected* scrap drives leveling.
  - The *current balance* buys towers, upgrades and repairs.
- **Power** is a single global capacity number (no pylons in the slice).
- **Sparks** are the meta currency.

**Context:** Four currencies plus a power grid is too much cognitive load for a ~$8 Vampire Survivors-like.

**Consequences:** Demolition feeds leveling, which is good for the pillar "Everything breaks". It needs diminishing returns to prevent farming; see the [GDD](game/01-gdd.md#economy).

## ADR-023: Banked level-ups and real-time building

**Status:** Proposed. Validated in M2′.

**Decision:**
- **Level-ups queue up** instead of interrupting play. The player opens them at any time (single-player pauses while the menu is open) or at auto-prompts during lulls.
- **Building** means placing blueprint ghosts, which **Forge drones construct in real time**. The game never slows down for building.

**Context:** Modal level-ups and slow-motion building break co-op and are awkward on touch screens.

**Consequences:**
- The design stays co-op compatible and touch-friendly.
- The UI needs more states: a pending-level-up badge, and ghosts that are under construction.
