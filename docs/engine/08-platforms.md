# Platforms & Packaging

The web build is the product. Every platform runs it, either directly in a desktop browser or inside **Electron** on Windows, macOS, Linux and the Steam Deck. Mobile (iOS and Android apps, mobile browsers) is out of scope until after 1.0 ([ADR-024](../DECISIONS.md#adr-024-desktop-and-web-only)).

This doc covers how each platform is packaged, how tiers are detected, how saves work, and how Steam is integrated. Platform facts were researched as of **September 2026**. Anything marked *(verify in M1)* goes into the M1 platform spike ([ROADMAP](../ROADMAP.md#milestones)).

## Goals

- One build runs everywhere, with platform differences isolated in `engine/platform/` adapters and `platforms/` shells.
- Store-ready packaging for Steam (Windows, macOS, Linux, Deck) and web portals.
- The best threading tier each platform allows, chosen automatically, degrading gracefully when it isn't available.
- Saves that survive updates, crashes and platform quirks.

## Non-goals

- Consoles; this would need a new UI and GPU backend.
- Mobile until after 1.0: no iOS or Android shells, and mobile browsers are not a target ([ADR-024](../DECISIONS.md#adr-024-desktop-and-web-only)).
- A WebGL fallback ([ADR-003](../DECISIONS.md#adr-003-webgpu-only)).
- Tauri or system-webview shells on desktop; revisit only if Electron blocks us ([ADR-004](../DECISIONS.md#adr-004-one-web-build-electron-for-desktop)).
- The Mac App Store and the Microsoft Store at launch (see Open questions).

## Game requirements served

| Need | Platform feature |
|---|---|
| Sell on Steam, including Steam Deck | Electron build, GPU switches, Steam shim, Deck layout |
| Web demo as a wishlist funnel | Static web build with COOP/COEP headers, a PWA, portal builds |
| Mid-run suspend and resume (Steam Deck sleep) | Lifecycle hooks, checkpoints ([ADR-019](../DECISIONS.md#adr-019-fodder-is-not-saved)) |
| Consistent performance across devices | Tier detection and dynamic caps |

---

## Platform matrix

| Target | Shell | Threading tier | Engine placement | Notes |
|---|---|---|---|---|
| Chrome / Edge desktop | Browser | `shared` (with headers) | Engine worker; worker rAF | Reference web target |
| Safari 26 (macOS) | Browser | `shared` (with headers) | Engine worker; **main-thread rAF ping** | Safari has no rAF in workers |
| Firefox 141+ Windows, 145+ Apple Silicon | Browser | `shared` (with headers) | Engine worker | No WebGPU yet on Linux |
| itch.io | Browser (iframe) | `shared` in Chromium and Firefox with the "SharedArrayBuffer support" option; `transfer` in Safari | Engine worker | Demo channel. Safari lacks `COEP: credentialless`, so offer a "pop-out" button for full threading. |
| Other portals (Poki, CrazyGames, Newgrounds) | Browser (iframe) | `transfer`. Poki and CrazyGames don't document SharedArrayBuffer; Newgrounds has an opt-in checkbox *(verify)*. | Engine worker | Payload caps apply ([BUDGETS](../BUDGETS.md#download--load-targets)); WebGPU-only acceptance to verify |
| Electron (Windows, macOS, Linux, Steam Deck) | Electron 44 / Chromium 152 | `shared` | Engine worker | Main commercial target |

---

## Tier detection

At boot, the engine picks a **performance tier** (`high` or `std`; see [BUDGETS: tiers](../BUDGETS.md#quality-tiers)) and a **threading tier** (`shared`, `transfer` or `inline`; see [02](02-core-ecs-jobs.md#threading-tiers)).

**Threading tier probes:**
1. Is `crossOriginIsolated` true, and does `SharedArrayBuffer` exist?
2. Is `Atomics.waitAsync` present?
3. Do module workers start?
4. Can a probe worker get a WebGPU adapter through an `OffscreenCanvas`? (This decides engine-worker vs main-thread placement.)
5. Does the worker have `requestAnimationFrame`? (This decides worker rAF vs a main-thread ping.)

**Performance tier inputs:**
- `adapter.info` (vendor and architecture; it may be empty), the adapter limits and features.
- `navigator.hardwareConcurrency`, and `navigator.deviceMemory` (Chrome only).
- The shell (browser or Electron; the Steam Deck defaults to `std`) and the screen size.
- A **micro-benchmark** of at most 1.5 s: a swarm-like compute workload plus a fill test at internal resolution, timed with `timestamp-query` where available, otherwise with `onSubmittedWorkDone`.

The result is cached per device and browser version. The user can override it in settings.

**Dynamic adjustment.** If frame time stays over budget for a sustained period (thermal throttling, a background app), the engine steps down through a **render-only** ladder:
1. Particle emission.
2. Remesh rate.
3. Bloom and fog quality.
4. Offering the 30 fps mode. The sim stays at 60 Hz, so each frame runs 2 ticks.

Nothing in this ladder changes simulation results. Anything that would (caps, *K*, the swarm rate) belongs to the run's **sim profile** ([BUDGETS](../BUDGETS.md#sim-profiles)). The sim profile is fixed at run start and only changes between runs, for example when the settings screen suggests a lighter profile after a throttled run.

---

## Web

- **Build output** in `dist/web/` ([ADR-025](../DECISIONS.md#adr-025-worker-build-scheme-and-tool-pins)):
  - `index.html`
  - three content-hashed bundles, built in dependency order: job worker, engine worker, main
  - `_headers`, carrying the headers below for Cloudflare Pages and Netlify
  - `build.json`, the build metadata
  - `assets/` (content-hashed)
  - `manifest.webmanifest`
  - `sw.js`
- **Headers**, served on every response including worker scripts and assets:
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: require-corp`, or `credentialless` where it helps third-party portal embeds
  - `Cross-Origin-Resource-Policy: same-origin`
- **Hosting.** Any static host that can set headers works, e.g. via a `_headers` file on Cloudflare Pages or Netlify. **GitHub Pages cannot set headers.** The `coi-serviceworker` workaround injects them from a service worker, at the cost of one forced reload on first visit. It does not work inside third-party iframes. That is fine for previews but not the storefront.
- **PWA:**
  - The service worker precaches the first-playable payload ([BUDGETS: downloads](../BUDGETS.md#download--load-targets)) and caches district assets at runtime.
  - Offline play works after the first visit.
  - A new version is offered only at safe points: the title screen or the Workshop, never mid-run.
  - The game calls `navigator.storage.persist()` to reduce eviction risk.
- **Unsupported browsers.** A clear screen lists the requirements ([ADR-020](../DECISIONS.md#adr-020-minimum-spec)) and links to supported browsers and the Steam page. It never shows a blank canvas.
- **Portals.** Portal SDK hooks (pause on ad, mute, gameplay start/stop) live behind a `PortalAdapter`. Portal builds assume the `transfer` tier unless the portal serves our headers. Portal facts as of September 2026:
  - **itch.io:**
    - The "SharedArrayBuffer support (Experimental)" frame option serves the game from `html.itch.zone` with `COEP: require-corp` and puts `COEP: credentialless` on the itch.io page.
    - Every cross-origin load needs CORS or CORP.
    - Safari doesn't support `credentialless`, so it gets no shared memory in the embed.
  - **Poki:**
    - No documented COOP/COEP.
    - Target initial download under 8 MB, which needs a slim portal payload built on procedural assets.
  - **CrazyGames:**
    - Initial download ≤ 50 MB.
    - Total ≤ 250 MB and ≤ 1,500 files.
    - Shared memory isn't documented.
  - **Newgrounds:** has a SharedArrayBuffer checkbox *(verify)*.
  - **Chrome's `Document-Isolation-Policy`** header (desktop 137+) can isolate a page without COOP, but only when the host sends it.

  Ask Poki and CrazyGames directly about WebGPU-only games before investing in portal builds.

---

## Desktop: Electron

**Baseline:** Electron 44 (Chromium 152). Each release pins an exact Electron version (44.4.5 today, [ADR-025](../DECISIONS.md#adr-025-worker-build-scheme-and-tool-pins)) and runs the full device-lab pass before shipping.

**Main process responsibilities:**
- Create the window.
- Register the protocol.
- Set the GPU switches.
- Save-file I/O.
- Steam shim.
- Crash reporting (opt-in).

**Cross-origin isolation:**
- Register a privileged scheme with `protocol.registerSchemesAsPrivileged`: standard, secure, supportFetchAPI, corsEnabled, stream.
- Serve the bundled build through `protocol.handle`, adding COOP, COEP and CORP to **every** response, worker scripts included. This is the pattern VS Code uses.
- `file://` pages cannot be cross-origin isolated.

**Security:**
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, and a strict CSP.
- The preload exposes a minimal API through `contextBridge`: `saves.read/write`, `steam.*`, `window.*`.

**GPU switches.** These are appended before `app.ready`, and every `enable-features` value goes into **one** switch:

| OS / GPU | Switches | Why |
|---|---|---|
| Windows x64, macOS | None | WebGPU is on by default |
| Windows ARM64 | `--enable-unsafe-webgpu` | Not on by default |
| Linux, Intel Gen12+ / NVIDIA (Wayland) | None, or the AMD set as a fallback | On by default from Chromium 144 / 147 |
| Linux AMD, including **Steam Deck** and Steam Machine | `--enable-unsafe-webgpu --ozone-platform=x11 --use-angle=vulkan --enable-features=Vulkan,VulkanFromANGLE` | AMD is still behind a flag. Electron 38+ runs natively on Wayland, so x11 is forced. |
| Steam Linux Runtime | `--no-sandbox --no-zygote --in-process-gpu --disable-dev-shm-usage` *(verify for our build)* | Runtime container constraints |
| CI and containers without a GPU (`PX_GPU_SWITCHES=swiftshader`) | `--enable-unsafe-webgpu --enable-unsafe-swiftshader --use-angle=swiftshader --use-webgpu-adapter=swiftshader --use-vulkan=swiftshader --enable-features=Vulkan` | SwiftShader everywhere. Without the Vulkan compositor, configuring a WebGPU canvas loses the device at once ("A valid external Instance reference no longer exists"). |

If `requestAdapter()` returns null on Linux, the launcher retries once with the alternative switch set. If that also fails, it shows a diagnostics screen.

**Performance settings:**
- `backgroundThrottling: false`
- `disable-renderer-backgrounding`
- `disable-background-timer-throttling`
- `force_high_performance_gpu`

`disable-frame-rate-limit` and `disable-gpu-vsync` are for benchmarking only. The game pauses when the window is hidden, because an OffscreenCanvas driven from a worker stops updating then anyway.

**Known issues to track:**
- NVIDIA's "Background Application Max Frame Rate" setting can throttle packaged apps even when they have focus. Document the fix in the support FAQ.
- In June 2026, Windows 11 updates caused GPU-sandbox crashes in some Electron versions. We pin versions and smoke-test after OS updates.

**Packaging** uses `electron-builder`:
- Windows: NSIS plus zip, x64 and arm64.
- macOS: universal dmg/zip, hardened runtime, codesigned and notarized.
- Linux: tar/AppImage for Steam depots, targeting the Steam Runtime.

Steam builds update through Steam, not `electron-updater`.

---

## Steam

([ADR-021](../DECISIONS.md#adr-021-steam-via-a-thin-ffi-shim))

- **Binding.** A thin FFI shim to the `steam_api` flat C API, living in `platforms/electron/steam/`. We will evaluate `steamworks-ffi-node` (FFI, SDK 1.64, maintained) against our own minimal shim. `steamworks.js` is stale (last release August 2024).
- **Features:**
  - Achievements and stats.
  - **Steam Auto-Cloud** on the save directory, which needs no API calls at all.
  - Rich presence.
  - Steam Input glyphs. Otherwise the browser Gamepad API sees Steam Input's Xbox-style virtual pad.
- **Overlay (optional):**
  - It needs `--in-process-gpu` and `disable-direct-composition`, so a GPU crash takes down the whole app.
  - It is broken in native Linux builds.
  - On Steam Deck, gamescope provides the overlay.
  - Shipped behind a launch option, off by default until M7 testing says otherwise.
- **Steam Deck Verified checklist:**
  - A 1280×800 layout ([07](07-ui.md#css-architecture)).
  - Full controller navigation.
  - Minimum text size.
  - No launcher.
  - Correct glyphs.
  - Suspend and resume.
  - The on-screen keyboard wherever text entry exists (seed input).

---

## Saves

| Data | Content | When written |
|---|---|---|
| Settings | Graphics tier override, audio, controls, accessibility | On change |
| Meta progression | Sparks, unlocks, Workshop upgrades, stats, achievements (mirrored to Steam) | End of run, and on unlock |
| Run checkpoint | CPU actors, economy, director state, voxel deltas; fodder excluded ([ADR-019](../DECISIONS.md#adr-019-fodder-is-not-saved)) | [Cadence](../BUDGETS.md#world-constants) |

**Format:**
- Versioned JSON with migration functions (version *n* → *n+1*), a checksum, and gzip via `CompressionStream`.
- Checkpoint voxel deltas are a binary blob beside the JSON.

**Storage per platform:**

| Platform | Storage |
|---|---|
| Web | IndexedDB, with `navigator.storage.persist()` requested |
| Electron | Files in `app.getPath('userData')` through the preload; atomic writes (temp file + rename); Steam Auto-Cloud |

**Robustness:** the last three versions of each save are kept. A corrupted or mismatched checksum falls back to the previous version, and the player gets a notice.

## Lifecycle

- **Tab hidden, window minimized or system suspended (e.g. Steam Deck sleep):**
  - The simulation pauses.
  - Audio is suspended.
  - A checkpoint is written when the system suspends.
  - The FrameDriver stops.
- **Resume:**
  - If the device was lost, recover it.
  - Restore audio. On the web, the AudioContext must be resumed from a user gesture.
  - The game stays paused until the player continues.
- **Audio unlock.** The first user gesture creates and resumes the `AudioContext`.

---

## Thread ownership

| Resource | Owner |
|---|---|
| Platform bridge (Electron preload API), save I/O, lifecycle events | Main thread |
| Tier decisions (made once at boot), dynamic step-down | Engine worker |
| Service worker (caching, cross-origin isolation fallback) | Browser service-worker context |

## Budgets

See [BUDGETS: download & load targets](../BUDGETS.md#download--load-targets) and [latency targets](../BUDGETS.md#latency-targets). The reference devices per tier are listed in [BUDGETS](../BUDGETS.md#reference-devices).

## Fallbacks & failure modes

| Failure | Behaviour |
|---|---|
| No WebGPU | Unsupported screen with the requirements and links |
| `requestAdapter()` returns null in Electron on Linux | Retry with the alternative switch set, then a diagnostics screen |
| No cross-origin isolation | `transfer` tier; the game stays playable |
| No WebGPU inside workers | Main-thread host, with mandatory [combat HUD rules](07-ui.md#combat-hud-rules) |
| Storage quota exceeded | Prune the district asset caches first, never saves; warn the player |

## Testing

- **M1 platform spike matrix:** every target row above, on the [reference devices](../BUDGETS.md#reference-devices). For each, record:
  - the threading tier
  - engine placement
  - FrameDriver mode
  - WebGPU features and limits
  - readback p95
  - device-loss recovery
  - pipeline warm-up time
- **Electron smoke tests** via Playwright's Electron support: boot, the protocol headers (`crossOriginIsolated === true`), switch sets per OS, and the save round trip.
- **Steam Deck:** the real device. Scripted runs of boot, a checkpoint, suspend and resume.
- **Web:** header checks against every deploy target, service-worker update flow tests, and the unsupported-browser screen.

## Open questions

- Do Poki and CrazyGames accept WebGPU-only games, and can they serve COOP/COEP? Neither is documented; ask them directly before M8.
- Mac App Store and Microsoft Store: their sandboxing works with Electron but adds review overhead. Post-launch decision.
- Cloud backup for web meta saves: is it needed next to `navigator.storage.persist()`, and if so, our own minimal endpoint or a platform service? Decide in M6.
