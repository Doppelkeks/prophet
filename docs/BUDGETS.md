# Budgets & Constants

**This file is the single source of truth for every number in the Prophet / SCRAPWAKE concept.**
Other docs link to the sections here and must not restate the numbers. The one exception is an illustrative example explicitly marked "e.g.".

To change a number:
1. Change it here first.
2. Update any prose that depends on it.
3. Add a line to the [change log](#change-log).

Every number is a *target* until the milestone in the **Validated in** column proves it (see [ROADMAP.md](ROADMAP.md)).

Conventions:
- **ms** are per frame at 60 fps unless stated otherwise.
- **MB** means MiB.
- **"Ceiling"** is a technical stress limit the engine must sustain.
- **"Design"** is the load the game design actually uses.

---

## Quality tiers

The engine runs one of three **performance tiers**:

| Tier | Target hardware | Frame target | Notes |
|---|---|---|---|
| `high` | Desktop/laptop dGPU in the RTX 3060 / RX 6600 class, ≥ 6 CPU cores | 60 fps locked, optional uncapped up to 144 fps | Electron or desktop browser |
| `std` | Steam Deck, Apple M1, GTX 1060 / RX 580-class PCs, Intel Xe iGPU laptops | 60 fps | Default for unknown desktops |
| `mobile` | iPhone 13 (A15) or newer on iOS 26+; Android 12+ phones with Chrome 121+ and Adreno 730 / Mali-G710-class GPUs | 60 fps, with a 30 fps battery/thermal mode | Forced on mobile shells |

Performance tiers are independent of the **threading tier** (`shared` / `transfer` / `inline`), defined in [engine/02-core-ecs-jobs.md](engine/02-core-ecs-jobs.md#threading-tiers).

**How a tier is selected** (details in [engine/08-platforms.md](engine/08-platforms.md#tier-detection)):
1. At startup, read the adapter info, the adapter limits, `hardwareConcurrency` and `deviceMemory`.
2. Run a GPU micro-benchmark of ≤ 1.5 s.
3. Apply any user override from settings.

## Reference devices

Every budget in this file is measured on these devices.

| Tier | Device | Why it is on the list |
|---|---|---|
| `high` | Ryzen 5 5600 + RTX 3060 12 GB, 16 GB RAM, Windows 11, Electron 44 | Close to the Steam hardware-survey median |
| `std` | Steam Deck LCD (Zen 2 4C/8T, RDNA2 8 CU, 16 GB shared) | Deck Verified target; AMD-on-Linux WebGPU path |
| `std` | MacBook Air M1 8 GB, macOS 26, Safari 26 + Electron | Apple baseline; exercises the WebKit engine |
| `std` | Core i5-8400 + GTX 1060 6 GB, Windows 10/11 | Old-PC floor |
| `mobile` | iPhone 13 (A15, 4 GB), iOS 26 | iOS floor (WKWebView host) |
| `mobile` | Pixel 8 (Tensor G3, Mali-G715), Android 15, Chrome (TWA) | Android reference |
| `mobile` | Galaxy S22 (Snapdragon 8 Gen 1, Adreno 730), Chrome (TWA) | Adreno reference |

---

## Simulation constants

Rules and rationale are in [engine/09-determinism-coop.md](engine/09-determinism-coop.md).

| Constant | Value | Notes |
|---|---|---|
| Sim tick | **60 Hz fixed** (16.667 ms) | Rendering interpolates between ticks |
| Swarm tick, mobile option | 30 Hz (half-rate) | Interpolated. All co-op peers must use the same rate. |
| Max sim ticks per rendered frame | 4 | Spiral-of-death guard: past this, the game slows down instead of catching up |
| **K** (GPU→CPU event latency) | **4 ticks** (desktop profiles), **8 ticks** (`mobile` profile) | An event stamped with tick *T* is applied at tick *T+K*. If it arrives late, the sim stalls; events are never skipped. The mobile value also covers the 30 fps mode, where each frame advances 2 ticks. |
| Readback ring depth | ≥ K + 1 slots | One slot being written plus up to K in flight ([03](engine/03-rendering.md#readback-ring)) |
| Async commit lag, flow fields (*L_field*) | 15 ticks (250 ms) | Solve results are committed at tick *R + L*, where *R* is the request tick ([09](engine/09-determinism-coop.md#async-results-at-fixed-ticks)) |
| Async commit lag, collapse (*L_collapse*) | 6 ticks (desktop profiles), 9 ticks (`mobile` profile) | Matches the collapse budget below |
| Async commit lag, PCG (*L_pcg*) | Not used in v1 | Generation finishes before tick 0. Mid-run generation would need a lag defined here first. |
| Chance format | Q16 (65,536 = 100 %) | Compared against 16 hash bits |
| Multiplier format | Q12 (4,096 = 1.0×) | Damage, speed and cost multipliers |
| State-hash interval | Every 60 ticks (debug/CI builds); every 300 ticks (co-op desync check) | Release single-player builds don't hash |
| Co-op input delay *L_input* (future) | 4 ticks (LAN), 6 ticks (internet) | Lockstep only; single-player uses 0 |
| Position unit | 1/1024 m (Q10) in `i32` | Range ±2,097 km |
| Velocity unit | Q10 m per tick | |
| Angle unit | 16-bit binary angle (65,536 = 360°) | |
| Trigonometry | 4,096-entry sine lookup table, Q14 output | Our own implementation, identical in JS and WGSL |
| Square root | Integer `isqrt`, bit-by-bit, 32-bit input | Identical in JS and WGSL |
| HP / damage unit | Q8 (1 HP = 256 units) in `i32` | |
| Time | Ticks as `u32` | ~828 days at 60 Hz |
| RNG | Stateless hash of *(seed, stream, tick, id)* | See [determinism](engine/09-determinism-coop.md#random-numbers) |
| Statuses per swarm unit | ≤ 8 | `u8` timers in 4-tick units (max 17 s) |
| ECS chunk size | 16 KiB (rows per chunk depend on the archetype's row size) | Final value is chosen in M5 with real archetypes |
| Density/threat map cell | 8 m, one cell per voxel-chunk column: 32 × 32 (desktop), 16 × 16 (mobile) | Director, camera and audio inputs |

### Sim profiles

A tier's **sim profile** is the set of its constants that change simulation results:
- *K* and the async commit lags
- swarm tick rate
- entity caps and ECS capacity
- district size
- the fodder density factor *ρ* ([GDD: tier density](game/01-gdd.md#tier-density))

The sim profile is fixed when a run starts and is recorded in replays and checkpoints. The performance tier chooses it in single-player; a co-op session runs the **lowest common profile** of its peers ([09](engine/09-determinism-coop.md#co-op-model)). A mid-run change is never allowed to alter the sim profile. The dynamic step-down in [08](engine/08-platforms.md#tier-detection) only touches rendering.

---

## Entity caps

| Cap | `high` | `std` | `mobile` | Validated in |
|---|---|---|---|---|
| Swarm enemies, **ceiling** | 100,000 | 40,000 | 8,000 | M2 |
| Swarm enemies, **design** (alive at once) | 20,000 | 10,000 | 3,000 | M6 |
| Swarm enemies, **design** (on screen) | 3,000–5,000 | 2,000–3,000 | ~1,000 | M2′/M6 |
| Projectiles, ceiling | 50,000 | 20,000 | 4,000 | M2 |
| Scrap pickups (gems) | 16,384 | 8,192 | 2,048 | M2 |
| GPU particles | 262,144 | 131,072 | 32,768 | M2 |
| Debris voxel particles | 65,536 | 32,768 | 8,192 | M3 |
| Actor proxies uploaded to the GPU per tick | 2,048 | 2,048 | 1,024 | M2 |
| ECS entity capacity | 65,536 | 65,536 | 32,768 | M5 |
| Towers (incl. walls as segments) | 256 | 256 | 128 | M6 |
| Clustered lights | 1,024 | 512 | 256 | M4 |
| GPU→CPU events per tick | 8,192 | 4,096 | 2,048 | M2 |
| Area effects per tick (CPU→GPU) | 256 | 256 | 128 | M2 |
| Fire commands per tick (CPU→GPU) | 1,024 | 1,024 | 512 | M2 |

Notes:
- **Pickups:** when the gem cap is hit, the gems nearest the player merge into one high-value gem.
- **GPU→CPU events:** the event buffers carry only "interesting" events: specialists, bosses, voxel damage and statistics. The economy never depends on events, because GPU-side counters stay exact (see [engine/05-gpu-swarm.md](engine/05-gpu-swarm.md#overflow-policy)). The M2 exit criterion is **zero overflow** in stress scenes.

---

## CPU frame budgets

### Engine worker (per frame)

| Item | `high` | `std` | `mobile` |
|---|---|---|---|
| One sim tick (ECS systems on the sim thread) | 3.0 ms | 4.0 ms | 5.0 ms |
| Applying readback events | 0.5 ms | 0.7 ms | 1.0 ms |
| Extract + GPU uploads | 0.8 ms | 1.0 ms | 1.5 ms |
| Render encode + submit | 1.2 ms | 1.5 ms | 2.0 ms |
| **Engine worker total** | **≤ 6.0 ms** | **≤ 8.0 ms** | **≤ 10.0 ms** |

A system that measures more than **0.5 ms** is split into chunk jobs ([engine/02-core-ecs-jobs.md](engine/02-core-ecs-jobs.md#parallelism-policy)).

### Main thread

| Item | `high` | `std` | `mobile` |
|---|---|---|---|
| UI work, average | ≤ 1.5 ms | ≤ 2.0 ms | ≤ 3.0 ms |
| Longest single task during combat | ≤ 8 ms | ≤ 8 ms | ≤ 8 ms |
| Input + gamepad polling | ≤ 0.2 ms | ≤ 0.2 ms | ≤ 0.3 ms |
| Audio scheduling | ≤ 0.5 ms | ≤ 0.5 ms | ≤ 0.8 ms |

### Job workers (asynchronous work)

| Job | `high` / `std` | `mobile` | Validated in |
|---|---|---|---|
| Base flow field, full solve (bucket-queue Dijkstra) | ≤ 4 ms | ≤ 10 ms | M3 |
| Player flow field (2 m cells, full map) | ≤ 1 ms | ≤ 3 ms | M3 |
| Flow-field re-solve rate | ≤ 4 Hz | ≤ 4 Hz | M3 |
| Remesh one 32³ chunk (binary greedy) | ≤ 0.3 ms | ≤ 0.8 ms | M3/M4 |
| Chunk remeshes per frame | 16 (`high`), 12 (`std`) | 6 | M3 |
| Full district generation | ≤ 3 s | ≤ 6 s | M3 |
| Structural collapse, end to end (edit → debris visible) | ≤ 100 ms | ≤ 150 ms | M3 |
| Number of job workers | `high`: min(cores − 2, 6); `std`: min(cores − 2, 4) | 2 (3 if cores ≥ 8) | M1 |

---

## GPU frame budgets

### At design load

| Pass group | `high` | `std` | `mobile` |
|---|---|---|---|
| Swarm simulation (all passes) | 1.5 ms | 2.5 ms | 2.0 ms |
| Culling + building indirect draws | 0.3 ms | 0.5 ms | 0.5 ms |
| Shadow map | 0.5 ms | 0.8 ms | 0.8 ms |
| Scene (voxels, meshes, swarm draw) | 2.0 ms | 3.5 ms | 3.5 ms |
| Light binning | 0.2 ms | 0.3 ms | 0.3 ms |
| Particles + debris | 0.8 ms | 1.2 ms | 1.2 ms |
| Post-processing (outline, LUT, bloom, fog) + upscale | 1.0 ms | 1.5 ms | 2.0 ms |
| World-space UI | 0.2 ms | 0.3 ms | 0.3 ms |
| **Total GPU** | **≤ 7 ms** | **≤ 11 ms** | **≤ 11 ms** |

### Stress-ceiling scene (M2 exit)

The stress scene is the swarm plus flat ground and particles.

| Reference | Load | Target |
|---|---|---|
| `high` reference GPU | 100k enemies / 50k projectiles | Swarm passes ≤ **6 ms** |
| `mobile` reference phones | 8k enemies / 4k projectiles | Total GPU frame ≤ **8 ms** |

Post-processing on `mobile` must stay ≤ **2 ms** (M4 exit).

---

## Memory budgets

### Shared heap

The shared heap is a single `WebAssembly.Memory` with a fixed size: initial = maximum, and it is never grown. Its layout is described in [engine/02-core-ecs-jobs.md](engine/02-core-ecs-jobs.md#memory-heap-and-arenas).

| Arena | `high` / `std` | `mobile` |
|---|---|---|
| ECS (tables, chunks, entity index, layout table) | 48 MB | 24 MB |
| Voxel world (chunk table, dense chunks, delta log) | 80 MB | 16 MB |
| Navigation (cost grid, two double-buffered fields) | 8 MB | 4 MB |
| Jobs, command buffers, event rings, state blocks | 16 MB | 8 MB |
| Procedural-generation scratch (reused after generation) | 64 MB | 32 MB |
| Asset staging (decode, uploads) | 48 MB | 24 MB |
| Reserve | 56 MB | 20 MB |
| **Total heap** | **320 MB** | **128 MB** |

### Other CPU memory

| Item | Desktop | Mobile | Validated in |
|---|---|---|---|
| JS heap (non-shared, garbage-collected objects) | ≤ 96 MB | ≤ 48 MB | M2 |
| GC pause, p99 over a 10-min run | ≤ 4 ms | ≤ 4 ms | M2 |

### GPU memory

| Pool | `high` | `std` | `mobile` |
|---|---|---|---|
| Voxel mesh pool (packed quads) | 128 MB | 96 MB | 32 MB |
| Swarm, projectiles, pickups, bins, fields | 16 MB | 8 MB | 2 MB |
| Particles + debris | 16 MB | 8 MB | 3 MB |
| Geometry mega-buffers (props, actors, robot parts) | 32 MB | 32 MB | 16 MB |
| Render targets (internal resolution + full-resolution canvas) | 48 MB | 48 MB | 32 MB |
| Shadow map | 16 MB (2048²) | 16 MB (2048²) | 4 MB (1024²) |
| Textures, atlases, LUT, fonts | 64 MB | 48 MB | 24 MB |
| Readback + staging rings | 8 MB | 8 MB | 4 MB |
| Reserve | 72 MB | 56 MB | 43 MB |
| **Total GPU** | **400 MB** | **320 MB** | **160 MB** |

No single binding may exceed **128 MB**. That is the WebGPU default `maxStorageBufferBindingSize`, so mega-buffers are split into pages below it.

---

## Download & load targets

| Item | Target | Validated in |
|---|---|---|
| Web first-playable payload (compressed) | ≤ 25 MB desktop, ≤ 15 MB mobile | M6 |
| Portal-build first payload | ≤ 8 MB (Poki's stated target), ≤ 20 MB (CrazyGames' mobile homepage limit); verify per portal | M8 |
| Total web payload (streamed, then cached by the service worker) | ≤ 150 MB (CrazyGames caps total size at 250 MB and 1,500 files) | M8 |
| Electron installer / installed size | ≤ 120 MB / ≤ 350 MB | M7 |
| iOS app size | ≤ 200 MB | M8 |
| Cold boot to title screen (warm HTTP cache) | ≤ 3 s desktop, ≤ 6 s mobile | M5 |
| Pipeline warm-up (all pipelines built asynchronously) | < 2 s | M1 |
| District generation | See [job workers](#job-workers-asynchronous-work) | M3 |
| Resume from a mid-run checkpoint | ≤ 4 s | M6 |

## Latency targets

| Item | Target | Validated in |
|---|---|---|
| GPU readback latency p95 (submit → harvestable) | ≤ 3 frames desktop, ≤ 4 frames mobile (at 60 fps) | M1 |
| GPU readback latency p99, in ticks, at the profile's lowest frame rate | ≤ K − 1 ticks ([K](#simulation-constants)); otherwise stalls become visible and K must grow | M1, M2 |
| Input to photon | ≤ 50 ms desktop (Electron/Chrome at 60 Hz), ≤ 70 ms mobile | M5 |
| HUD state-block refresh | 30 Hz. One-off events go immediately via `postMessage`. | M5 |

---

## Quality gates

These are release-quality thresholds, checked at the milestones listed ([ROADMAP.md](ROADMAP.md#milestones)).

| Gate | Threshold | Checked at |
|---|---|---|
| Frame time p99 on each reference device (60 fps targets) | ≤ 20 ms | M6, M7, M8 |
| Frame time p50 on each reference device | ≤ 16.7 ms | M6, M7, M8 |
| GPU→CPU event-buffer overflow in stress scenes | 0 | M2 onward |
| Replay state hashes over a 10-min run | Identical (L1 in CI; L2 across the device lab) | M5 onward |
| Crash-free sessions | ≥ 99 % (M6), ≥ 99.5 % (M8) | M6, M8 |
| Long main-thread tasks during combat | Zero over the [main-thread budget](#main-thread) | M5 onward |
| Memory high-water mark after a 30-min soak | Within [memory budgets](#memory-budgets), with no growth trend | M5 onward |

---

## World constants

| Constant | Value |
|---|---|
| Voxel size | **0.25 m** |
| Voxel encoding | 1 byte: 6-bit material (64 materials) + 2-bit damage stage |
| Chunk | 32³ voxels = an 8 m cube = 32 KiB when dense |
| District, desktop tiers | 256 × 256 × 32 m → 1024 × 1024 × 128 voxels → 32 × 32 × 4 = **4,096 chunks** |
| District, mobile | 128 × 128 × 24 m → 512 × 512 × 96 voxels → 16 × 16 × 3 = **768 chunks** |
| Dense chunk cap | 2,048 (desktop), 400 (mobile). Every other chunk must be *uniform* (all-air or all-solid). |
| Walkable layers | 1 (the world is 2.5D) |
| Build grid | 2 × 2 m tiles (8 × 8 voxel columns) |
| Base flow field | 1 m cells: 256 × 256 (desktop), 128 × 128 (mobile) |
| Player flow field | 2 m cells covering the full map: 128 × 128 (desktop), 64 × 64 (mobile) |
| Wall-cost buckets | 4 |
| Minimum breach width | 1 m |
| Swarm spatial bins | 2 m cells: 128 × 128 (desktop), 64 × 64 (mobile) |
| Mid-run checkpoint cadence | After each assault, and every 60 s |

## Pixel & camera constants

Rationale and the alternative candidate are in [engine/04-pixel-art-pipeline.md](engine/04-pixel-art-pipeline.md).

| Constant | Value |
|---|---|
| Pixel density | **8 px/m** (1 px = 0.125 m) on every axis. This is the oblique-projection hypothesis, decided in M4. |
| One world voxel on screen | 2 × 2 px; faces are micro-textured |
| One character voxel | 0.125 m = 1 px |
| Base internal height (zoom) | 216 (near) / **270 (default)** / 360 (far) px |
| Integer scale *k* | `max(1, round(screenH / zoomHeight))` |
| Internal render size | `ceil(screen / k)` plus a 2 px border on each side, for the sub-pixel camera shift |
| Examples at default zoom | 1920×1080 → k=4 → 480×270 · 2560×1440 → k=5 → 512×288 · 3840×2160 → k=8 → 480×270 · Steam Deck 1280×800 → k=3 → 427×267 · iPhone 13 landscape 2532×1170 → k=4 → 633×293 |
| Camera yaw | 90° steps (0 / 90 / 180 / 270) |
| Character facing | 16 quantized directions |
| Character pose animation rate | 12 fps (movement itself is interpolated at display rate) |
| Toon shading bands | 3 |
| Outline | 1 px, drawn from an object-ID buffer; none on fodder |
| Colour-grading LUT | 32³ |
| PATCH height | 20–22 px (2.5–2.75 m), chibi proportions |
| Enemy heights | From 4 px (Mites) to 48–96 px (bosses) |

## UI constants

| Constant | Value |
|---|---|
| DOM nodes in the combat HUD | ≤ 300 |
| DOM nodes in a menu screen | ≤ 2,000 |
| HUD refresh rate | ≤ 30 Hz |
| UI state block | 4 KiB, seqlocked |
| Minimum touch target | 48 CSS px |
| UI scale range | 75–150 % |
| Flash limiter | ≤ 3 full-screen flashes per second |

## Audio constants

| Constant | Value |
|---|---|
| Sample rate | 48 kHz |
| Max simultaneous voices | 48 (desktop), 24 (mobile) |
| Per-type voice caps | Hits 8 · explosions 6 · pickups 6 (pitch-stepped) · UI 4 |
| Music | 4 stems per track: explore, pressure, assault, boss |

---

## Change log

| Date | Change |
|---|---|
| 2026-09-25 | Initial concept numbers (M0) |
| 2026-09-26 | M0 review: K raised to 4 (desktop) / 8 (mobile) ticks with a p99 readback rule; readback ring depth; sim profiles; async commit lags; Q16/Q12 formats; state-hash interval; co-op input delay; ECS chunk size; density-map cell; portal payload caps; quality gates |
