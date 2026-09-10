# Particle-driven loading prototype

P2AT-020A explores an original “spark to stars” loading experience for PoE2 Agent Tools: a spark is born in darkness, sparks gather into a sea of stars, and the stars reveal **Path Of Exile 2**. Thousands of locally generated Canvas 2D points share one restrained energy field. The atmosphere is dark and spacious, led by cold white and silver-blue with restrained violet and ember-gold accents.

The NovaCode login page was used only as high-level visual inspiration for particle typography and a flowing lower field. This experiment contains no copied source, branding, logo, font, media, script, particle data, tracker or remote runtime resource. The title targets are sampled at startup from text drawn onto an offscreen canvas with local system serif fonts.

## Files

- `index.html` — accessible prototype structure and controls.
- `styles.css` — isolated layout, palette, focus and fallback styling.
- `logic.js` — pure deterministic random, targeting, state, quality and lifecycle logic.
- `app.js` — Canvas renderer, mock-loading adapter, controls and cleanup.
- `test/logic.test.cjs` — network-free Node tests.
- `capture-evidence.mjs` — records a real-time 12-second browser screencast through the local Edge debugging protocol and encodes it locally with FFmpeg.
- `screenshots/` — 1920×1080 review captures for all display modes.
- `PERFORMANCE.md` — measured local performance and method.

## Run locally

No install or build is required. From the repository root, start any static server, for example:

```powershell
npx --yes serve experiments/loading-particles
```

Then open the printed local URL. Directly opening `index.html` also works because the prototype uses classic local scripts and no fetch requests.

Repeatable review URLs use the injected seed and explicit modes:

- `?seed=20260220&quality=balanced`
- `?seed=20260220&quality=cinematic`
- `?seed=20260220&motion=reduced`

Append `&capture=1` to hold a deterministic 72% review frame without changing normal runtime behavior.

Deterministic narrative stills are available through `stage=void`, `stage=convergence`, `stage=revelation`, and `stage=complete`. The committed `01`–`04` evidence images are extracted from the unaccelerated video rather than these synthetic review holds.

Run the focused suite with:

```powershell
node --test experiments/loading-particles/test/*.test.cjs
```

## State machine and integration seam

The explicit states are `enter → loading → complete`, with `enter/loading → error`; `complete` and `error` can only return to `enter` through restart. The visual timeline is separately staged as Void (0–1 s), Ignition (roughly 1–3.2 s), Convergence (3.2–8 s), and Revelation (8–10.6 s). Mock progress drives the same UI seam later loaders can call through `window.__loadingPrototype.setProgress()`, `.complete()` and `.fail()`. A fast real load may request completion while the visual field smoothly reaches revelation; a slow load settles into a breathing star field without growing arrays.

Particles are divided into three movement families. Warm **Embers** ignite sparsely and leave short velocity trails. Fine **Stardust** forms most of the wave field and glyph density. Rare **Guiding stars** are brighter and deeper. Attraction is combined with tangent curl, phase-based flow, inertia and damping, so particles orbit and narrow into broad streams rather than linearly interpolating to targets. The lower wave is both the reservoir and dominant origin for title particles.

`complete` and `error` stop the mock progress producer. They do not allocate new particles. Completion briefly brightens a narrow band of title particles; error keeps the title readable and supplies explicit text rather than relying on color. A fast loader first advances the visual clock into late Convergence, holds progress at 99% with an explicit “data ready” message, then publishes the visual Complete state at Revelation. This coordination does not require the application behind the loading presentation to delay its own readiness.

## Display and performance modes

Balanced is the default: at most 3,200 title particles, 700 wave particles and 1.5× device pixel ratio. Cinematic allows 6,200 title particles, 1,400 wave particles, denser text sampling, stronger light and a 2× ratio. Stardust is 0.52–0.88 px in Balanced and 0.52–1.02 px in Cinematic; embers are 1.05–1.72 px and rare guides 1.7–2.55 px. Both counts are rebuilt to fixed arrays only on initialization, quality change or debounced resize; they never grow per frame.

Cinematic automatically falls back to Balanced when at least 72% of the latest 90 measured frames exceed 24 ms, after the 90-frame buffer fills. Devices reporting fewer than four logical cores or less than 4 GB memory also start Cinematic requests in Balanced. The downgrade happens once and is announced in the visible step text.

When `prefers-reduced-motion` is active, motion starts paused, title points settle immediately, continuous drift, parallax and wave updates stop, while progress, steps, errors and controls remain live. The user may explicitly choose **Resume animation** to opt in; the system preference is never silently overridden.

The renderer caps device pixel ratio, throttles pointer parallax to about 21 updates/second, pauses animation for hidden documents, debounces resize by 160 ms, cancels the animation frame on pause/hide/destroy, and removes listeners and clears intervals/timeouts on destroy. Gradients, text sampling, arrays and particle objects are not created in the frame loop.

## Accessibility

The visible controls use native buttons and a select, have explicit names, keyboard behavior and high-contrast focus rings. A native `progress` element exposes numeric progress; live step and completion regions announce meaningful changes; error text uses `role="alert"`. Pausing animation does not pause progress or hide information. Canvas is decorative and hidden from assistive technology; the semantic heading remains in the document.

## Suggested production boundary

Treat `logic.js` as the portable pure core and place any future Renderer adapter beside the production loading coordinator. Keep particle rendering presentation-only: it should receive state/progress snapshots and must not read files, caches or Electron APIs itself. Production integration should be separately approved and should preserve a static fallback before removing any current loading path.

## Known limitations

- System serif glyph shapes vary slightly by operating system, though the injected seed keeps selection and motion deterministic for a given font rasterization.
- Canvas contrast and particle size were tuned for desktop; very small windows retain functional controls but show less atmospheric space.
- The prototype reports browser-observed frame timing, not GPU telemetry or a lab-grade benchmark.
- Mock progress is intentionally synthetic and is not connected to Planner startup.

## Visual evidence

- `screenshots/01-void-first-embers.png` — darkness and the first sparse ignition.
- `screenshots/02-convergence.png` — broad star streams before readable glyphs.
- `screenshots/03-revelation.png` — complete main title and delayed community subtitle.
- `screenshots/04-complete.png` — completed state after the restrained particle sweep.
- `screenshots/spark-to-stars-full.mp4` — real-time, unaccelerated 12-second Balanced performance at 1280×720.

With the local server running, reproduce the video from this directory using `node capture-evidence.mjs`. It requires local Microsoft Edge and FFmpeg, performs no network request, records 12 wall-clock seconds, preserves each accepted screencast frame's browser timestamp, and encodes a variable-frame-rate video. The capture is intentionally around 15 fps and is evidence of narrative timing, not a substitute for the 120 Hz performance sample.
