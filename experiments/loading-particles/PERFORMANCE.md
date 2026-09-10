# Performance report

Measurements are recorded after the final visual capture. They are browser-observed timings, not estimates. See the table below for the tested browser, hardware, capture date, methodology, particle counts, frame timings, generation/resize cost, 60-second stability and background-tab behavior.

The acceptance interpretation is conservative: if exact GPU frame delivery cannot be observed, this report states only `requestAnimationFrame` interval samples exposed by the prototype. No FPS value is fabricated.

<!-- PERF_RESULTS_START -->
Measured 2026-09-10 in Microsoft Edge (Chromium headless/in-app browser), at an explicit 1920×1080 CSS-pixel viewport and device pixel ratio 1. Hardware: AMD Ryzen 7 8745HS (8 cores / 16 logical processors), integrated Radeon 780M graphics. Node v24.14.1 ran the pure tests. Browser frame samples come from a fixed 90-entry ring buffer of consecutive `requestAnimationFrame` intervals after a five-second warm-up.

| Mode | Title particles | Wave particles | Total | Average frame interval | P95 frame interval | First target generation | Full layout / resize |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Balanced | 1,877 | 520 | 2,397 | 8.40 ms | 8.60 ms | 3.30 ms | 5.40 ms |
| Cinematic | 4,209 | 980 | 5,189 | 8.33 ms | 8.50 ms | 4.10 ms | 7.30 ms |

The host browser was presenting at roughly 120 Hz, so the observed 8.3 ms interval is the refresh cadence and should not be converted into a claim about unconstrained maximum FPS. No obvious dropped-frame cluster appeared in the captured P95 sample, and Cinematic did not trigger its sustained-low-frame-rate downgrade.

For the 60-second stability run, Cinematic began and ended with exactly 5,189 particles; its peak remained 5,189. The rendered-frame counter advanced from 1,860 to 8,460 during the recorded 55-second tail after the initial warm-up, with no particle growth.

The in-app browser used for measurement keeps automation tabs foreground-renderable and continued reporting `document.hidden === false` after another tab opened, so it could not produce an honest browser-hidden timing measurement. Background stopping is therefore verified by the deterministic lifecycle test plus the implementation path: `visibilitychange` cancels the scheduled frame when `document.hidden` becomes true and schedules again only after it becomes false. A manual reviewer can confirm it in ordinary Edge DevTools by switching tabs and observing that the exposed rendered-frame counter stops. This limitation is reported instead of claiming a measurement the harness could not make.
<!-- PERF_RESULTS_END -->
