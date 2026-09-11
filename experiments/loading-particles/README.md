# Particle-driven loading prototype

P2AT-020A explores an original “spark to stars” loading experience for PoE2 Agent Tools: a spark is born in darkness, sparks gather into a sea of stars, and the stars reveal **Path Of Exile 2**. Thousands of locally generated Canvas 2D points share one restrained energy field. The atmosphere is dark and spacious, led by cold white and silver-blue with restrained violet and ember-gold accents.

The NovaCode login page was used only as high-level visual inspiration for particle typography and a flowing lower field. This experiment contains no copied source, branding, logo, font, media, script, particle data, tracker or remote runtime resource. The title targets are sampled at startup from text drawn onto an offscreen canvas with local system serif fonts.

## Files

- `index.html` — accessible prototype structure and controls.
- `styles.css` — isolated layout, palette, focus and fallback styling.
- `logic.js` — pure deterministic random, targeting, state, quality and lifecycle logic.
- `background.js` — independent seeded background population and analytic flow paths.
- `app.js` — Canvas renderer, mock-loading adapter, controls and cleanup.
- `test/logic.test.cjs` — network-free Node tests.
- `capture-evidence.mjs` — records a real-time approximately 20-second browser screencast, including slow movement, a fast sweep and recovery, and encodes it locally with FFmpeg.
- `measure-performance.mjs` — repeats the 1920×1080 Balanced and Cinematic browser timing sample.
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

With the same local server running, reproduce the performance sample from the experiment directory with `node measure-performance.mjs`.

## State machine and integration seam

The explicit states are `enter → loading → complete`, with `enter/loading → error`; `complete` and `error` can only return to `enter` through restart. The visual timeline is separately staged as Void (0–1 s), Ignition (roughly 1–2.22 s), Convergence (2.22–4.89 s), and Revelation (4.89–6.33 s). The September 11 revision preserves the first breath and plays formation at 1.8×, returning to normal speed after formation. Existing internal narrative timestamps and `visualElapsedMs` use this mapped clock; they are not wall-clock duration. Mock progress drives the same UI seam later loaders can call through `window.__loadingPrototype.setProgress()`, `.complete()` and `.fail()`. A fast real load may request completion while the visual field smoothly reaches revelation; a slow load settles into a breathing star field without growing arrays.

Particles are divided into three movement families. Warm **Embers** ignite sparsely and leave short velocity trails. Fine **Stardust** forms most of the wave field and glyph density. Rare **Guiding stars** are brighter and deeper. Three shared moving attractors lift broad elliptical streams from the lower reservoir, flattening into a horizontal star river before gradually handing particles to glyph targets at about 4.05–5.94 wall-clock seconds. Tangent curl, inertia and damping soften the capture. Integration uses elapsed frame time, capped after stalls. During prolonged loading, a bounded subset briefly leaves and returns to the title. The lower wave uses coherent phases across depth instead of independent random vertical motion.

The main title remains exclusively particle-rendered. The smaller community subtitle begins as particles, then crossfades at about 5.67–6.33 wall-clock seconds into crisp, high-contrast local Arial text; sparse particle sampling alone cannot preserve its small letter strokes. Reduced motion shows this readable subtitle immediately. It is decorative in the DOM because the existing accessible heading already contains the same words.

The independent background is a large twisting particle surface spanning the title's background. Every axial slice contains a full depth cross-section: Balanced uses 160 columns × 25 points (4,000), Cinematic 200 × 32 (6,400). Its interior is populated, rather than drawing only two helix edges and occasional rungs. Opposite edges and depth-dependent brightness/size produce a DNA-like folding appearance. It uses the same cold-white/silver-blue/violet palette and fine halo treatment as the title, with occasional muted gold. The surface axis lies around 47% of screen height with a 25%-height radius, so it surrounds and passes behind the title. Contrast is reduced behind lettering and loading controls. Two fixed column caches share trigonometry for the current surface and sparse trailing points. Its particle pool, seed and `ambientElapsedMs` clock have no dependency on glyph sampling, progress, or the accelerated formation clock. It continues after completion; pause/hidden freeze it and Reduced motion draws a static field. No new particles are born in terminal states.

After formation, move through the title as if drawing a wake across water. Continuous pointer samples measure CSS pixels per second. Slow movement lightly parts the particles; faster movement gives a stronger forward/sideways impulse over a wider swept path (45–110 px radius). A separate damped displacement spring returns the particles over several seconds without altering their glyph targets. Displacement is capped at 100 px under repeated strokes. A stationary pointer generates no new impulses; leaving the window stops new input but preserves the natural recovery. It works in `complete` as well as prolonged loading. Input is throttled to 48 ms, resets after gaps of 200 ms, does not intercept clicks, ignores touch, and is disabled while paused, hidden or reduced-motion. The readable subtitle stays still.

On completion, the progress details fade over 850 ms and are hidden after 900 ms; a plain, borderless, transparent **START** text button appears. Reduced motion skips the wait and display animation. Completion still has a screen-reader status announcement. The native button supports keyboard activation and a visible focus indicator. There is no default navigation: register an optional integration callback with `window.__loadingPrototype.onEnter(handler)` and remove it with `.onEnter(null)`. It is invoked only once per button activation while the entrance is visible and the state is complete. Restart hides the button and restores progress; destroy removes its listener and releases the callback.

On 2026-09-10, the reference page was revisited visually through consecutive rendered browser observations only. Its broad horizontal cloud, later glyph formation, surrounding loose points and coherent lower wave informed this revision. No source, runtime internals or assets were inspected or reused; the three-lane attraction equations and timing are original.

On 2026-09-11 both the login page and the actual [homepage](https://ai.novacode.top/home) were observed again. The homepage's dense twisting point surface clarified that the desired background was a filled, layered surface rather than a skeletal double helix. This experiment uses original cross-section projection equations and retains its own typography, palette, composition and startup behavior. No reference source or assets were copied.

`complete` and `error` stop the mock progress producer. They do not allocate new particles. Completion briefly brightens a narrow band of title particles; error keeps the title readable and supplies explicit text rather than relying on color. A fast loader first advances the visual clock into late Convergence, holds progress at 99% with an explicit “data ready” message, then publishes the visual Complete state at Revelation. This coordination does not require the application behind the loading presentation to delay its own readiness.

## Display and performance modes

Balanced is the default: at most 3,200 title particles, 700 wave particles, 4,000 independent background particles and 1.5× device pixel ratio (7,900 total cap). Cinematic allows 6,200 title particles, 1,400 wave particles, 6,400 background particles, denser text sampling, stronger light and a 2× ratio (14,000 total cap). Stardust is 0.52–0.88 px in Balanced and 0.52–1.02 px in Cinematic; embers are 1.05–1.72 px and rare guides 1.7–2.55 px. Background base sizes are 0.52–1.02 px, scaled by 0.8–1.24 according to projected depth. Counts are rebuilt to fixed arrays only on initialization, restart, quality change or debounced resize; they never grow per frame.

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
- `screenshots/05-hover.png` — faster sweep dispersing the title after completion.
- `screenshots/06-recovered.png` — natural recovery and plain START entrance.
- `screenshots/spark-to-stars-full.mp4` — real-time, unaccelerated approximately 20-second Balanced recording at 1280×720; formation ends near 6.33 seconds, slow movement starts after 10.5 seconds, a faster sweep follows near 14.5 seconds, then several seconds show recovery.
- `screenshots/performance-results.json` — raw phase, hover and 60-second stability measurements.

With the local server running, reproduce the video from this directory using `node capture-evidence.mjs`. It requires local Microsoft Edge and FFmpeg, performs no external network request, records approximately 20 wall-clock seconds including actual pointer input, preserves each accepted screencast frame's browser timestamp, and encodes a variable-frame-rate video. The capture is intentionally around 15 fps and is evidence of narrative timing, not a substitute for the separate performance sample. Run the server on port 8765 with the experiment directory as its root for both evidence scripts.
