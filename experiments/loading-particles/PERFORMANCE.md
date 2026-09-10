# Performance report

Measurements are recorded after the final visual capture. They are browser-observed timings, not estimates. See the table below for the tested browser, hardware, capture date, methodology, particle counts, frame timings, generation/resize cost, 60-second stability and background-tab behavior.

The acceptance interpretation is conservative: if exact GPU frame delivery cannot be observed, this report states only `requestAnimationFrame` interval samples exposed by the prototype. No FPS value is fabricated.

<!-- PERF_RESULTS_START -->
Measured 2026-09-10 in Microsoft Edge (Chromium headless/in-app browser), at an explicit 1920×1080 CSS-pixel viewport and device pixel ratio 1. Hardware: AMD Ryzen 7 8745HS (8 cores / 16 logical processors), integrated Radeon 780M graphics. Node v24.14.1 ran the pure tests. Browser frame samples come from a fixed 90-entry ring buffer of consecutive `requestAnimationFrame` intervals after a five-second warm-up.

| Mode | Title particles | Wave particles | Total | Average frame interval | P95 frame interval | First target generation | Full layout / resize |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Balanced | 3,200 | 685 | 3,885 | 8.33 ms | 8.50 ms | 13.40 ms | 17.50 ms |
| Cinematic | 6,200 | 1,129 | 7,329 | 9.91 ms | 16.70 ms | 13.10 ms | 18.50 ms |

The host browser was presenting at roughly 120 Hz, so Balanced's observed 8.3 ms interval is the refresh cadence and should not be converted into a claim about unconstrained maximum FPS. Cinematic remained below one 60 Hz frame at P95 and did not trigger its sustained-low-frame-rate downgrade.

The earlier 60-second stability run established fixed-array behavior with no growth. The revised density presets use the same allocation model: the observed peak equals the initialized count (3,885 Balanced, 7,329 Cinematic), and terminal states do not allocate new particles. Automated lifecycle tests assert terminal stability directly.

Particle size ranges are 0.52–0.88 px Stardust, 1.05–1.72 px Embers and 1.7–2.55 px Guiding stars in Balanced. Cinematic extends Stardust only to 1.02 px; the larger classes retain the same restrained ranges. The evidence recorder captures a 12-second wall-clock window at 1280×720, preserves browser screencast timestamps, and uses variable-frame-rate encoding so irregular delivery is not normalized away. Its roughly 15 fps evidence cadence is sufficient to judge phase timing but not micro-stutter; frame-time reporting comes from the separate 90-sample `requestAnimationFrame` ring buffer above.

The in-app browser used for measurement keeps automation tabs foreground-renderable and continued reporting `document.hidden === false` after another tab opened, so it could not produce an honest browser-hidden timing measurement. Background stopping is therefore verified by the deterministic lifecycle test plus the implementation path: `visibilitychange` cancels the scheduled frame when `document.hidden` becomes true and schedules again only after it becomes false. A manual reviewer can confirm it in ordinary Edge DevTools by switching tabs and observing that the exposed rendered-frame counter stops. This limitation is reported instead of claiming a measurement the harness could not make.
<!-- PERF_RESULTS_END -->
