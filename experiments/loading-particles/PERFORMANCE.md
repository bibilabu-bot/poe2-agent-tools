# Performance report

Measured 2026-09-11 at 05:54 UTC, after the final dense-surface revision, in Microsoft Edge Chromium headless at 1920×1080 CSS pixels / DPR 1. Hardware: AMD Ryzen 7 8745HS (8 cores / 16 logical processors), integrated Radeon 780M. Node v24.14.1 runs the local measurement script. No production Planner is involved.

These are observed requestAnimationFrame intervals, not GPU draw timings or an unconstrained FPS estimate. The host normally presents around 120 Hz. Raw results, entrance checks, slow/fast movement samples and >60-second stability results are committed in `screenshots/performance-results.json`.

## Counts and settled frame window

| Mode | Title | Lower wave | Background surface | Total | Average interval | P95 interval | Target sampling | Particle rebuild |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Balanced | 3,200 | 685 | 4,000 | 7,885 | 8.33 ms | 8.60 ms | 6.70 ms | 9.30 ms |
| Cinematic | 6,200 | 1,129 | 6,400 | 13,729 | 13.33 ms | 17.10 ms | 30.90 ms | 39.10 ms |

The background uses a complete 160×25 / 200×32 particle surface. Fixed per-column caches share trigonometry for current and trailing positions, so increasing interior density does not repeat trigonometry for every particle. Title points and background points share their fine white/blue/violet palette. Title base sizes remain 0.52–0.88 px Balanced Stardust / up to 1.02 px Cinematic, 1.05–1.72 px Embers and 1.7–2.55 px Guiding stars. Background base sizes are 0.52–1.02 px with 0.8–1.24 depth scaling.

Sampling/rebuild values are reported initialization work timings. The same rebuild runs on resize, but these figures exclude the 160 ms debounce and are not a new independently measured resize event.

## Formation and speed-dependent interaction

The script samples a fixed 90-frame ring buffer near 3.5, 7 and 12 wall-clock seconds, then performs actual slow and fast pointer sweeps. It waits five seconds between sweeps to allow recovery.

| Mode | 3.5 s average / P95 | 7 s average / P95 | Fast sweep average / P95 | Slow / fast maximum displacement |
| --- | --- | --- | --- | --- |
| Balanced | 8.33 / 8.50 ms | 8.33 / 8.50 ms | 8.33 / 8.50 ms | 21.74 / 47.38 px |
| Cinematic | 8.89 / 16.50 ms | 13.89 / 17.10 ms | 14.35 / 24.90 ms | 20.97 / 51.39 px |

Balanced stayed close to the display cadence in the sampled windows. Cinematic showed occasional longer intervals during rapid interaction; its 24.9 ms P95 is a real limitation and is not described as locked 60 FPS. Neither mode triggered automatic degradation, which requires at least 72% of a full 90-frame buffer to exceed 24 ms. These windows do not establish whole-run worst-case latency, and variation between sessions is expected.

Stationary/unaffected title particles skip wake calculations. A moving pointer generates one impulse per accepted sample along the swept segment; existing displacement then decays through a spring and damping. The 100 px safety cap prevents repeated strokes from growing displacement without bound. Slow and fast sweep measurements confirm stronger displacement for faster movement; after recovery the measured affected count and maximum displacement both return to zero.

## Stability, lifecycle and entrance

Each mode ran more than 60 seconds. The independent background clocks reached 67,523 / 67,739 ms. Total populations and peaks remained exactly 7,885 / 13,729; terminal states created no additional particles. Fixed upper limits are 7,900 / 14,000 across viewport sizes.

Browser checks confirmed that after completion the progress details are hidden and START is visible with transparent background and zero border width. The button reserves an optional `onEnter(handler)` hook and performs no default navigation. Offline lifecycle tests cover its timing, removal, restart and destroy behavior, plus reduced motion and pointer recovery.

The in-app automation browser previously kept tabs foreground-renderable even after another tab opened, so it could not establish an honest browser-hidden timing measurement. Hidden-page stopping is verified through deterministic lifecycle tests and the implementation path: visibilitychange cancels animation scheduling, freezes the background and prevents new pointer impulses; resuming does not integrate hidden time. An ordinary-browser manual tab-switch check remains recommended.

## Evidence and reproduction

Serve this experiment directory at http://127.0.0.1:8765 and run `node measure-performance.mjs`. It writes the raw report and Balanced, Cinematic, reduced-motion and interaction screenshots. It requires local Edge and a Node runtime with WebSocket support.

`node capture-evidence.mjs` records an approximately 20-second 1280×720 browser screencast, preserving browser timestamps in variable-frame-rate encoding. It shows 6.33-second formation, completion fade/START, slow movement around 10.5–13.5 seconds, a fast sweep around 14.5 seconds and several seconds of recovery. Its roughly 15 fps capture cadence demonstrates narrative timing, not fine-grained micro-stutter; performance figures come from the separate run above.
