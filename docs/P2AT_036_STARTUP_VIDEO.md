# P2AT-036 — Local startup video integration

Status: REVIEW pending controller acceptance. No production application restart,
main modification, animation edit, paid model call or private-profile inspection.

## Behavior

`renderer/startup-video.js` mounts immediately before `planner.js`. The existing
`load()` starts without awaiting media. Its real milestones report reading tree
data, building the graph and validating official node metadata; no guessed
percentage or animation timer represents data progress. Readiness occurs after
the existing graph/UI setup, before optional localization and sprite loading,
preserving their existing background/fallback semantics.

Entry requires both data readiness and media completion (ended, skipped or
unavailable). Skip/Escape stops the video immediately but does not bypass loading.
Mute controls audio without changing playback. A load error immediately stops
media and displays the error and retry action above the Planner. Retry reuses
`load()` without replaying the intro; successful retry clears the existing error.
Missing/invalid media, rejected autoplay, or eight seconds without playback
progress abandon the video and retain the normal data gate. Reduced motion also
skips media. Background UI is inert until entry; modal keys do not reach Planner
shortcuts. Exit/entry releases the media source, timer, observer and listeners.

No Electron main/preload or network resource contract changes are required.

## Optional developer resource deployment

An ordinary checkout with no video must start normally. The fixed relative URL is
`apps/planner-desktop/renderer/local-startup/intro.mp4`. This entire folder is
ignored by Git. Copy a locally obtained file there; never use an absolute drive
path in application code. The chosen folder travels with the checkout.

For this local handoff the supplied v7 file was copied byte-for-byte as `intro.mp4`:

| Field | Value |
| --- | --- |
| Source filename | POE-II-preview-v7-music.mp4 |
| SHA256 | 632defeeff94db4f27861b38f6f93f0e8b8c66cc151a4181271edc5aa497719b |
| Size | 10,108,684 bytes |
| Picture | H.264, 960×540, 15 fps |
| Sound | AAC, stereo, 48 kHz |
| Duration | 29.266667 seconds |

This is a low-resolution development preview, not a final HD publication master.
Replacing it later with an authorized higher-quality export at the same relative
path does not require animation or application code changes. The `--local-media`
evidence check intentionally pins this handoff hash and must be updated explicitly
when a new approved source is used.

## Source and distribution boundary

The local preview combines the user's Heroes Logo Intro V2 / Element 3D template,
Path of Exile 2 game artwork/cinematics and “The Seed Of Corruption” (Early Access
Preview), composed by Kamil Orman-Janowski. Music reference:
https://www.youtube.com/watch?v=e3VAgMg-6iU ; obtained source album:
https://downloads.khinsider.com/game-soundtracks/album/path-of-exile-2-2024 .

No redistribution permission is asserted by this integration. Do not commit the
video, audio, template, AE projects or game artwork, or bundle this local folder
in a public installer/offline resource package. Git ignore is not a release
license or a substitute for an explicit packaging exclusion. Before public
distribution, establish permission/attribution for every included component or
use an authorized replacement; otherwise ship the no-video fallback. No runtime
download of this third-party media is introduced.

## Checks

From `apps/planner-desktop` with dependencies installed:

```sh
node --test test/startup-video.test.cjs
npm run test:startup-video
# Optional: requires the exact local v7 file above.
npm run test:startup-video:local
npm run check
```

The Electron runner creates its own temporary userData and in-memory sessions,
loads production HTML/renderer/load hooks with synthetic graph responses, blocks
external network, and does not load production main/preload or an Agent service.
It generates a six-second canvas/WebAudio test video by default, requiring no
copyrighted media or extra encoder. `--local-media` instead verifies and plays
the v7 file. It checks fast data, video ending before slow data, skip, mute/unmute,
Escape isolation, initial failure/retry, missing/corrupt video, blocked autoplay,
actual stall watchdog timing and pagehide media cleanup. Optional fixture art and
translations intentionally return 404, demonstrating existing background fallback.

This validates real Electron decoding and production renderer hooks with
controlled data, not live upstream availability or a public packaged installer.

Validation on 2026-10-03: four focused state tests passed; full Node suite had
247 passes and one pre-existing conditional locked-tree skip (248 total);
Python unittest discovery passed 141 tests. `npm run check` and separate syntax
checks of the new controller/evidence runner passed. After the review fix,
synthetic-media and pinned-local-v7 Electron runs each passed all ten scenarios.
The initial test protocol interception produced a media format error; native
file playback resolved it, and the final stall case asserts the eight-second
watchdog elapsed rather than mistaking a decode failure for stall coverage.

Independent code review requested a self-generated test fixture (implemented),
and the JS review found Escape leaking to underlying layout shortcuts (fixed,
regression-tested). Final JS review: APPROVE, no remaining findings. Local-only
logs are under the ignored research cache / desktop `.research-*.log` files.
