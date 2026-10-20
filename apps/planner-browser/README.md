# Local browser service

Node.js 20+; no package install, Electron, Python, model calls or database required.
Run from the repository root in PowerShell:

```powershell
$env:PLANNER_ACCESS_TOKEN = node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
# Optional, required for WeGame import. Explicit existing local file only:
$env:PLANNER_OFFICIAL_TREE = 'C:\your-approved-local-resources\official-data.json'
node apps/planner-browser/server.cjs
```

Open `http://127.0.0.1:8787`. Use the same token in the browser login.
Never place tokens in a URL, Git, screenshot or shared log. Tokens are not printed by
the service. The service logs only readiness or a generic startup refusal.
The server defaults to loopback and requires an explicit random token.
Browser Build files stay in the browser; the service has no Build upload endpoint.

Choose your local resource directory/files in the browser. Files must match the
canonical SHA-256 and byte count. This server returns resource metadata only; it
does not serve your game cache or fetch missing game files. A cold start without
files requires explicitly selecting local canonical resources. A configured
official mapping with a bad hash or size refuses startup. Without a configured
mapping the UI can run, but WeGame import returns an actionable unavailable error.
The official mapping is read and verified once at startup and never exposed as
an HTTP resource.

The shared access token enables a bounded one-hour HttpOnly SameSite=Strict cookie.
HTTP is for local development; Secure is set for HTTPS origins. Only the exact
configured Host and Origin are accepted; proxy headers are never trusted. Set
`PLANNER_ORIGIN` only to an exact trusted origin. There is no CORS wildcard.
Login is limited to 10 attempts per minute; requests to 8 concurrent operations,
64 sockets and 4 KiB JSON bodies. WeGame reuses the existing fixed-host bounded
service, including redirect rejection. No generic URL proxy is provided.
This is a single local test operator credential, not multi-user agent isolation.

## Container preparation

Docker is optional. From the repository root:

```powershell
docker build -f apps/planner-browser/Dockerfile -t planner-browser:local .
docker run --rm -p 127.0.0.1:8787:8787 --read-only --cap-drop ALL --security-opt no-new-privileges `
  -e PLANNER_CONTAINER_MODE=1 -e PLANNER_ACCESS_TOKEN planner-browser:local
```

Explicit container mode binds inside the container to all interfaces; the host
port above remains loopback-only. For WeGame optionally mount the individually
approved official-data.json read-only at `/resources/official-data.json` and set
`PLANNER_OFFICIAL_TREE` to that path. Never mount a user profile or credentials
directory. Images contain project source/metadata only, without game/media caches.
The Docker build context uses `Dockerfile.dockerignore` to exclude all other files.

For an approved offline image transfer later:

```powershell
docker image inspect planner-browser:local --format '{{.Id}}'
docker save --output planner-browser.tar planner-browser:local
Get-FileHash planner-browser.tar -Algorithm SHA256
```

Record accepted full source SHA, image ID/digest and archive hash. The recipient
must verify the archive hash before `docker load`; production must not pull source
or install dependencies on startup. A future release must retain the previous
image digest, probe health, and switch back on failure. Database recovery is a
separate concern if persistent state is added later.

`manual-build.workflow.yml.example` is an inactive manual, protected-environment
template. There is no registry push, SSH, cloud resource creation or deployment.
Before any public release, resolve resource redistribution rights, ICP/provider
eligibility, TLS, access control and explicit procurement/deployment approval.

## Deployment readiness follow-up

The local-only container verifier and its injected-driver tests live in `deploy/`.
On a machine with an already installed local Linux-container Docker engine, run
`node apps/planner-browser/deploy/verify-container.cjs` from a clean committed
checkout. It builds committed allowlisted source, records source SHA and immutable
image ID, checks a constrained loopback-only container, rehearses a failed candidate
and prior-container restoration, then cleans only containers owned by that run.
The verification image is retained for inspection. It does not publish or deploy.
An absent Docker engine produces `NOT_RUN` and nonzero exit, not a passing result.
Fake-driver tests exercise control flow only and do not claim real Docker coverage.

See `docs/P2AT_039D_DEPLOY_READINESS.md` for the CNY 100 annual budget investigation,
official filing/IP/TLS evidence, completed checks and remaining release gates.
