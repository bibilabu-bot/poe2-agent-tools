# P2AT-039A/B — Local browser slice

Executor delivery: **REVIEW**, 2026-10-20. Controller acceptance, main integration,
procurement and public deployment are separate. Base:
`6d22738a60cba551620b233193044d65998490f5`; branch `task/P2AT-039A-browser`.

## Delivered behavior

- Reuses `apps/planner-desktop/renderer`, its graph, codec, state adapter and
  guarded import transaction. The old `planner-web` snapshot is untouched.
- `browserPlatform.ready`, `resourceURL` and `fetchResource` are the narrow
  browser resource boundary. Desktop still uses the existing preload/protocol.
  There is no global fetch interception.
- Users explicitly choose local files/directory. Every required core file must
  match canonical byte count and SHA-256 before any Blob mapping is published.
  Optional class portraits use the same lock; omitted portraits use basic rendering.
  No resource bytes are uploaded, fetched automatically, packaged, or served.
- Build files use local File/Blob operations, bounded UTF-8 input and the existing
  codec/transaction. Browser download feedback says download initiated, not that
  an external filesystem write has been verified. Refresh requires resource
  selection again; no persistent browser directory permission is requested.
- WeGame uses the existing fixed-host service through authenticated same-origin
  requests. Preview, semantic clusters, explicit replacement/partial/omission
  acknowledgments, latest P2AT-038 handling and rollback are preserved.
- Agent, model settings and prompt controls are visibly unavailable and do not
  initialize browser-side service callbacks. This does not remove phase-two goals.
- Local optional startup media is never requested by the browser.

## Local service and resource boundary

See [startup and container commands](../apps/planner-browser/README.md).
No dependency installation is needed for the Node service.

`GET /health` returns only `{ok:true}`. `GET /api/resource-manifest` returns lock
metadata, never files or download URLs. Static responses use an exact source
allowlist. `POST /api/login` accepts an explicit operator token and issues a
one-hour HttpOnly SameSite=Strict session. `POST /api/wegame` requires that session
and exact Origin/Host. HTTP is loopback development only; HTTPS origins set Secure.

The explicit server-side `PLANNER_OFFICIAL_TREE` is read and verified at startup.
An invalid file refuses startup; an omitted file allows local tree/Build usage but
returns an actionable WeGame configuration error. Selecting browser files does not
upload the official mapping to the server. The service has no general proxy or
Build-upload endpoint. Login, body, sockets, concurrent requests and upstream
responses are bounded; token and payload bodies are not logged.

This is a single-operator local test service, not a multi-user account system.
Public/private RAG, per-user session/tab/run/snapshot routing, structured browser
tool callbacks, provider allowlists and durable memory isolation remain P2AT-039C.

## Verification

- Complete desktop regression: **257 Node passed, zero skipped; 141 Python passed**.
  `npm run check` passed. Public locked-tree fixtures were supplied explicitly.
- Service boundary suite: **6 passed**; together with the existing fixed WeGame
  transport suite, **14 passed**. No upstream network request in these tests.
- New browser platform unit suite: **6 passed**, including missing/duplicate/
  wrong-size/wrong-hash rejection, bounded UTF-8 Build input, unavailable controls,
  and safe actionable missing-mapping errors.
- Ordinary installed Edge via Playwright, with a fresh isolated browser context:
  missing/hash-invalid resource rejection and retry; no Electron `require`;
  search, reachable path and actual canvas-pointer allocation/refund; native Build
  download/reopen equality; no POST before WeGame login; real local-server login;
  sanitized WeGame preview and clusters; all three acknowledgment gates; node
  14265 explicitly omitted; successful import; mocked transport failure preserves
  the previous Build and does not display private exception text.
- Isolated desktop Electron `check-wegame-confirm.cjs`: real confirmation click,
  missing acknowledgments, invalid candidate, validation error, rollback, unsafe
  failure and cancellation checks passed, exit 0. No owner window was restarted.
- Independent reviewer performed separate code and security assessments:
  **APPROVE for local-only scope**, no unresolved findings. Actionable missing
  mapping feedback was corrected before final review.
- **Docker unavailable:** no Docker build, container health or container smoke
  pass is claimed. Dockerfile/context and inactive manual workflow were reviewed.
  The existing active CI gains only local service tests/syntax checks.

Reproduce the ordinary-browser check with `playwright-core` installed in a separate
QA directory (not in production), an installed Edge, and canonical public files:

```powershell
$env:NODE_PATH = 'C:\your-qa-directory\node_modules'
$env:P2AT_GAME_CACHE = 'C:\your-isolated-public-game-data'
# Expects core/official-data.json and the seven other canonical core files.
$env:P2AT_BROWSER_EVIDENCE = 'C:\your-local-evidence-directory'
node apps/planner-desktop/tools/check-browser.cjs
```

The test generates its own random token, synthetic identity and temporary Build.
It mocks only fixed WeGame upstream responses at the injected transport boundary;
browser-to-local-server authentication and import use actual HTTP.
It closes its browser and server on completion.

Local screenshots from this run are in
`C:/Users/xty12/AppData/Local/Temp/p2at-039-browser-evidence/`:
resource selection, canvas allocation, WeGame confirmation, full-tree overview
and 900-pixel viewport. These contain public game rendering and are deliberately
not committed or uploaded. Synthetic Build output also stays outside the repository.

## Remaining limits and deployment gates

- Live WeGame upstream compatibility was not retested; deterministic sanitized
  fixtures establish local integration, not current remote availability.
- Only ordinary Edge/Chromium was exercised; Firefox/Safari are not claimed.
- Browser localization currently uses canonical PoB fallback. It does not serve
  or package the separate WeGame localization candidate cache.
- Docker execution and automatic deployment/rollback rehearsal remain pending.
  The manual workflow example is inactive and only prepares an image. There is no
  registry push, cloud resource creation, SSH or production deploy.
- Accepted source SHA, immutable image digest/archive hash, transfer verification,
  health checks and previous-version retention must be enforced before deployment.
  Mainland hosts must not rely on runtime GitHub/GHCR access or `git pull/npm install`.
- Data redistribution/legal source availability, cloud procurement, true filing
  eligibility, domain/TLS and public deployment authorization remain open.
  Authentication does not bypass filing. No paid models or index rebuild ran.
- No SQLite or other server persistence was introduced. A future database needs
  consistent backup/restore testing separately from code rollback.
