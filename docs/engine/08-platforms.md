# Platforms & Packaging

The web build is the product. Every platform runs it, either directly in a browser or inside a thin shell:
- **Electron** on desktop
- a **WKWebView host with an in-app localhost server** on iOS
- a **Trusted Web Activity** on Android

This doc covers how each platform is packaged, how tiers are detected, how saves work, and how Steam is integrated. Platform facts were researched as of **September 2026**. Anything marked *(verify in M1)* goes into the M1 platform spike ([ROADMAP](../ROADMAP.md#milestones)).

## Goals

- One build runs everywhere, with platform differences isolated in `engine/platform/` adapters and `platforms/` shells.
- Store-ready packaging for Steam (Windows, macOS, Linux, Deck), the App Store, Google Play and web portals.
- The best threading tier each platform allows, chosen automatically, degrading gracefully when it isn't available.
- Saves that survive updates, crashes and platform quirks.

## Non-goals

- Consoles; this would need a new UI and GPU backend.
- A WebGL fallback ([ADR-003](../DECISIONS.md#adr-003-webgpu-only)).
- Tauri or system-webview shells on desktop; revisit only if Electron blocks us ([ADR-004](../DECISIONS.md#adr-004-one-web-build-electron-for-desktop)).
- The Mac App Store and the Microsoft Store at launch (see Open questions).

## Game requirements served

| Need | Platform feature |
|---|---|
| Sell on Steam, including Steam Deck | Electron build, GPU switches, Steam shim, Deck layout |
| Sell on iOS and Android | iOS host with a localhost server; Android TWA |
| Web demo as a wishlist funnel | Static web build with COOP/COEP headers, a PWA, portal builds |
| Mid-run suspend on phones | Lifecycle hooks, checkpoints ([ADR-019](../DECISIONS.md#adr-019-fodder-is-not-saved)) |
| Consistent performance across devices | Tier detection and dynamic caps |

---

## Platform matrix

| Target | Shell | Threading tier | Engine placement | Notes |
|---|---|---|---|---|
| Chrome / Edge desktop | Browser | `shared` (with headers) | Engine worker; worker rAF | Reference web target |
| Safari 26 (macOS, iPadOS) | Browser | `shared` (with headers) | Engine worker; **main-thread rAF ping** | Safari has no rAF in workers |
| Firefox 141+ Windows, 145+ Apple Silicon | Browser | `shared` (with headers) | Engine worker | No WebGPU yet on Linux or Android |
| itch.io | Browser (iframe) | `shared` in Chromium and Firefox with the "SharedArrayBuffer support" option; `transfer` in Safari | Engine worker | Demo channel. Safari lacks `COEP: credentialless`, so offer a "pop-out" button for full threading. |
| Other portals (Poki, CrazyGames, Newgrounds) | Browser (iframe) | `transfer`. Poki and CrazyGames don't document SharedArrayBuffer; Newgrounds has an opt-in checkbox *(verify)*. | Engine worker | Payload caps apply ([BUDGETS](../BUDGETS.md#download--load-targets)); WebGPU-only acceptance to verify |
| Electron (Windows, macOS, Linux, Steam Deck) | Electron 44 / Chromium 152 | `shared` | Engine worker | Main commercial target |
| iOS 26+ | WKWebView host + localhost server | `shared` | Engine worker; main-thread rAF ping | Requires the localhost server for cross-origin isolation |
| Android 12+ | TWA in Chrome 121+ | `shared` | Engine worker | Primary Android path |
| Android fallback | Own WebView host | `transfer` | Engine worker if WebGPU works there *(verify in M1)* | System WebView is never cross-origin isolated |

---

## Tier detection

At boot, the engine picks a **performance tier** (`high`, `std` or `mobile`; see [BUDGETS: tiers](../BUDGETS.md#quality-tiers)) and a **threading tier** (`shared`, `transfer` or `inline`; see [02](02-core-ecs-jobs.md#threading-tiers)).

**Threading tier probes:**
1. Is `crossOriginIsolated` true, and does `SharedArrayBuffer` exist?
2. Is `Atomics.waitAsync` present?
3. Do module workers start?
4. Can a probe worker get a WebGPU adapter through an `OffscreenCanvas`? (This decides engine-worker vs main-thread placement.)
5. Does the worker have `requestAnimationFrame`? (This decides worker rAF vs a main-thread ping.)

**Performance tier inputs:**
- `adapter.info` (vendor and architecture; it may be empty), the adapter limits and features.
- `navigator.hardwareConcurrency`, and `navigator.deviceMemory` (Chrome only).
- The shell flag (mobile shells force `mobile`) and the screen size.
- A **micro-benchmark** of at most 1.5 s: a swarm-like compute workload plus a fill test at internal resolution, timed with `timestamp-query` where available, otherwise with `onSubmittedWorkDone`.

The result is cached per device and browser version. The user can override it in settings.

**Dynamic adjustment.** If frame time stays over budget for a sustained period (thermal throttling, a background app), the engine steps down through a **render-only** ladder:
1. Particle emission.
2. Remesh rate.
3. Bloom and fog quality.
4. Offering the 30 fps mode. The sim stays at 60 Hz, so each frame runs 2 ticks.

Nothing in this ladder changes simulation results. Anything that would (half-rate swarm, caps, K) belongs to the run's **sim profile** ([BUDGETS](../BUDGETS.md#sim-profiles)). The sim profile is fixed at run start and only changes between runs, for example when the settings screen suggests a lighter profile after a throttled run.

---

## Web

- **Build output:**
  - `index.html`
  - entry chunks: main, engine worker, job worker
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
    - Initial download ≤ 50 MB (≤ 20 MB for the mobile homepage).
    - Total ≤ 250 MB and ≤ 1,500 files.
    - Shared memory isn't documented.
  - **Newgrounds:** has a SharedArrayBuffer checkbox *(verify)*.
  - **Chrome's `Document-Isolation-Policy`** header (desktop 137+, Android 146+) can isolate a page without COOP, but only when the host sends it.

  Ask Poki and CrazyGames directly about WebGPU-only games before investing in portal builds.

---

## Desktop: Electron

**Baseline:** Electron 44 (Chromium 152). Each release pins an exact Electron version and runs the full device-lab pass before shipping.

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

## iOS

**Minimum:** iOS 26+, where WebGPU is on by default in WKWebView.

**Host app.** Our own Swift template of roughly 300–500 lines. Capacitor 8 is acceptable if we need its plugins.

**Web view:**
- A full-screen `WKWebView` that respects safe areas.
- Inline media, no bounce.
- The status bar and home indicator are hidden during runs.

**In-app HTTP server:**
- It serves the **bundled** build on `127.0.0.1` at a random port, using `NWListener`, with COOP, COEP and CORP headers.
- It is required because WebKit ignores COOP/COEP on custom schemes (`capacitor://` and friends). Without it, `crossOriginIsolated` is false and there is no shared memory.
- This was verified on macOS 26.5 WebKit *(verify on iOS devices in M1)*.
- The server restarts when the app returns to the foreground.

**Native bridge:**
- Lifecycle: pause and checkpoint on background, resume, memory warnings (which drop caches).
- Haptics (`UIImpactFeedbackGenerator`).
- Saves (files in Application Support, with optional iCloud).
- Game Center (optional).
- StoreKit, if the business model needs it.

**App Store rules:**
- A fully bundled game is fine under guideline 4.2.
- Guideline 2.5.2 bans downloaded code, so **all JS ships inside the app**; remote content is data only.

**Backgrounding** can lose the GPU device. Recovery is covered in [03](03-rendering.md#device-loss).

---

## Android

**Primary path: a Trusted Web Activity.**
- Built with Bubblewrap 1.25, targeting API 36, which Google Play requires from 31 August 2026.
- Needs a verified domain, via Digital Asset Links.
- Runs in Chrome, which gives WebGPU on Android 12+ (Chrome 121+) and shared memory with our COOP/COEP headers.
- A TWA **cannot bundle assets** in the APK:
  - The service worker precaches everything on first launch, so the first launch needs a network connection.
  - Its storage is shared with Chrome, so clearing Chrome's data wipes local saves. Meta saves therefore get a **cloud backup** (see [Saves](#saves)).
- The TWA runs in the user's TWA-capable browser, which may not be Chrome. Capabilities are detected at runtime, with a "use Chrome for best results" hint when WebGPU is missing.
- Digital goods go through Play Billing, using the Digital Goods API.

**Fallback: our own WebView host.**
- Android System WebView is **never** cross-origin isolated, so this host runs the `transfer` tier only.
- WebGPU availability in WebView must be verified on real devices in M1.

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
| iOS | Native files through the bridge; optional iCloud |
| Android TWA | IndexedDB plus the cloud backup of meta saves |

**Robustness:** the last three versions of each save are kept. A corrupted or mismatched checksum falls back to the previous version, and the player gets a notice.

## Lifecycle

- **Tab hidden, window minimized or app backgrounded:**
  - The simulation pauses.
  - Audio is suspended.
  - A checkpoint is written (on mobile).
  - The FrameDriver stops.
- **Resume:**
  - If the device was lost, recover it.
  - Restore audio. The AudioContext must be resumed from a user gesture on the web and on iOS.
  - The game stays paused until the player continues.
- **Audio unlock.** The first user gesture creates and resumes the `AudioContext`. On iOS the audio session category is "ambient", so the game respects the silent switch, with an option to override it.

---

## Thread ownership

| Resource | Owner |
|---|---|
| Platform bridge (Electron preload API, iOS/Android native bridges), save I/O, lifecycle events | Main thread |
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
| TWA host browser lacks WebGPU | Message recommending Chrome, plus a link to the web demo requirements |
| iOS localhost server fails to bind | Retry on a new port. After three failures, run the `transfer` tier from the bundled files. |

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
- **Mobile:** real devices only (Safari Web Inspector, Chrome remote debugging). Scripted runs of boot, a checkpoint, background/foreground and resume.
- **Web:** header checks against every deploy target, service-worker update flow tests, and the unsupported-browser screen.

## Open questions

- iOS host: our own Swift template, or Capacitor 8? Decide in M1, based on which plugins we need.
- Android WebView: WebGPU status, and whether the fallback host is worth shipping at all.
- Do Poki and CrazyGames accept WebGPU-only games, and can they serve COOP/COEP? Neither is documented; ask them directly before M8.
- Mac App Store and Microsoft Store: their sandboxing works with Electron but adds review overhead. Post-launch decision.
- Cloud backup provider for Android and web meta saves: our own minimal endpoint or a platform service. Decide in M6.
