# Page layout follow-ups — REVIEW

Branch: `task/P2AT-026A-python-agent-runtime`; never merge main from executor.

## P2AT-027A

Baseline: `114e47e14e5ed8ec1d794f1cbe465cb3d593d82e`.
Common 72px page headers align all three navigation groups at the top right.
The existing tool rail is moved into the content grid, preserving mounted controls
and panel state. Narrow windows overlay the panel beside the 64px rail. Canvas resize
uses actual stage size instead of its former 320/420px minimum, preserving coordinates
even at a 360px window width. Allocation, mastery, graph and Build contracts unchanged.

Evidence: `npx electron tools/check-page-layout.cjs` runs production markup/styles,
layout mount, page switch handlers and extracted Canvas resize/coordinate functions
in an isolated offscreen Chromium window, with no private data/network. It checks
identical navigation geometry, control state, Canvas dimensions/center coordinate and
pointer reachability of rail buttons at 1366×768, 600×650 and 360×560, open/closed.
Screenshots: `docs/assets/screenshots/p2at-027/navigation-*.png`.
This is real DOM/layout rendering with an empty canvas, not a game-data startup test.
Full npm test (Python 39/39), npm run check and layout fixture passed.
Independent review found a narrow hidden-panel overlap; corrected the offscreen
translation and added elementFromPoint regression coverage.

## P2AT-027B

Baseline: `dcf6a1c54ae9d2402a6b6ec6127b1044e72a9df5`.
The full-width `settings-scroll` main owns page scrolling; `settings-content` retains
its centered 900px reading width. Header stays outside the scroll region. Existing
controls/IDs, profile handlers, credential lifecycle and testing behavior are unchanged.
`npx electron tools/check-page-layout.cjs --settings` checks right edge equals window
width at 1366/600/360px, no nested scrolling containers, actual PageDown and wheel
scrolling at the window edge, and header top remains zero. All checks pass; screenshots
are `docs/assets/screenshots/p2at-027/settings-{1366,600,360}.png`.
Independent read-only review reports no issues. Synthetic/no-network fixture only;
no credentials read and no real connection/model requests made. REVIEW.
