# Performance report

Measurements are recorded after the final visual capture. They are browser-observed timings, not estimates. See the table below for the tested browser, hardware, capture date, methodology, particle counts, frame timings, generation/resize cost, 60-second stability and background-tab behavior.

The acceptance interpretation is conservative: if exact GPU frame delivery cannot be observed, this report states only `requestAnimationFrame` interval samples exposed by the prototype. No FPS value is fabricated.

<!-- PERF_RESULTS_START -->
Measured 2026-09-11 at 00:37 UTC in Microsoft Edge (Chromium headless), at an explicit 1920×1080 CSS-pixel viewport and device pixel ratio 1. Hardware: AMD Ryzen 7 8745HS (8 cores / 16 logical processors), integrated Radeon 780M graphics. Node v24.14.1 ran the pure tests. Browser frame samples come from a fixed 90-entry ring buffer of consecutive `requestAnimationFrame` intervals. The reproducible script and raw `screenshots/performance-results.json` cover windows near 3.5, 7 and 12 seconds, pointer interaction, and more than 60 seconds of runtime per mode.

| Mode | Title | Wave | Independent background | Total | Average interval | P95 interval | Target sampling | Particle rebuild |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Balanced | 3,200 | 685 | 1,000 | 4,885 | 8.33 ms | 8.60 ms | 7.20 ms | 11.60 ms |
| Cinematic | 6,200 | 1,129 | 1,800 | 9,129 | 8.33 ms | 8.50 ms | 10.70 ms | 22.30 ms |

The host browser was presenting at roughly 120 Hz, so the observed 8.3 ms intervals are the refresh cadence, not unconstrained maximum FPS. Neither mode triggered automatic downgrade. The table reports the last 90-frame window near 12 seconds. At 3.5/7 seconds, Balanced averages were 8.33/8.33 ms (P95 8.50/8.50 ms), and Cinematic averages 8.34/8.33 ms (P95 8.50/8.40 ms). Hover in the completed title affected 868/1,643 title points, with averages 8.33/8.43 ms and P95 8.50/8.50 ms respectively. These windows do not establish whole-run worst-case latency, and should not be treated as a controlled speedup versus previous sessions. Sampling/rebuild values are the initialization-reported work timings; the rebuild runs on resize too, but these values exclude its 160 ms debounce and are not a separate new resize event measurement.

The current build was run beyond 60 seconds in each mode. Background ambient clocks reached 60,807/60,974 ms; populations and peaks stayed exactly 4,885/9,129, including independent background pools of 1,000/1,800. Moving the pointer away returned the affected count to zero. The background clock advances independently of glyph formation/progress; it deliberately caps single-frame advances to 50 ms after a stall. Automated tests additionally verify pause/resume and terminal population stability.

Particle size ranges are 0.52–0.88 px Stardust, 1.05–1.72 px Embers and 1.7–2.55 px Guiding stars in Balanced. Cinematic extends Stardust only to 1.02 px; the larger classes retain the same restrained ranges. Independent background points are 0.65–1.35 px. The evidence recorder captures approximately 15 wall-clock seconds at 1280×720, including actual pointer input after completion, preserves browser screencast timestamps, and uses variable-frame-rate encoding. Its roughly 15 fps cadence is suitable for phase timing but not micro-stutter; performance reporting comes from the separate ring-buffer samples above.

The in-app browser used for measurement keeps automation tabs foreground-renderable and continued reporting `document.hidden === false` after another tab opened, so it could not produce an honest browser-hidden timing measurement. Background stopping is therefore verified by the deterministic lifecycle test plus the implementation path: `visibilitychange` cancels the scheduled frame when `document.hidden` becomes true and schedules again only after it becomes false. A manual reviewer can confirm it in ordinary Edge DevTools by switching tabs and observing that the exposed rendered-frame counter stops. This limitation is reported instead of claiming a measurement the harness could not make.
<!-- PERF_RESULTS_END -->
