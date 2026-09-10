# Particle-driven loading prototype

P2AT-020A explores an original loading experience for PoE2 Agent Tools. Thousands of locally generated Canvas 2D points gather into the title while a restrained energy field moves beneath it. The atmosphere is dark, arcane and gold-led, with cold blue and violet accents.

The NovaCode login page was used only as high-level visual inspiration for particle typography and a flowing lower field. This experiment contains no copied source, branding, logo, font, media, script, particle data, tracker or remote runtime resource. The title targets are sampled at startup from text drawn onto an offscreen canvas with local system serif fonts.

## Files

- `index.html` — accessible prototype structure and controls.
- `styles.css` — isolated layout, palette, focus and fallback styling.
- `logic.js` — pure deterministic random, targeting, state, quality and lifecycle logic.
- `app.js` — Canvas renderer, mock-loading adapter, controls and cleanup.
- `test/logic.test.cjs` — network-free Node tests.
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

Run the focused suite with:

```powershell
node --test experiments/loading-particles/test/*.test.cjs
```

## State machine and integration seam

The explicit states are `enter → loading → complete`, with `enter/loading → error`; `complete` and `error` can only return to `enter` through restart. Mock progress drives the same UI seam later loaders can call through `window.__loadingPrototype.setProgress()`, `.complete()` and `.fail()`. A production adapter should translate game-data read, cache validation, download, passive-tree parsing and Renderer-ready events into progress and step labels without moving this experiment into persistence, preload or cache code.

`complete` and `error` stop the mock progress producer. They do not allocate new particles. Completion briefly brightens the scene and fades the canvas; error keeps the title readable and supplies explicit text rather than relying on color.

## Display and performance modes

Balanced is the default: at most 2,400 title particles, 520 wave particles and 1.5× device pixel ratio. Cinematic allows 4,400 title particles, 980 wave particles, denser text sampling, stronger light and a 2× ratio. Both counts are rebuilt to fixed arrays only on initialization, quality change or debounced resize; they never grow per frame.

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
