# External executor environment setup

Task: P2AT-029A
Date: 2026-09-21
Baseline: `4e579ab11938915db1196fc6441d8021125433bb` — docs(controller): accept prompt hotfix and stage external setup

## Environment

| Component | Version |
|-----------|---------|
| OS | Windows 11 Home China 10.0.26200 |
| Git | 2.52.0.windows.1 |
| Node.js | 24.14.1 |
| npm | 11.11.0 |
| Python | 3.12.0 |

## Reproducible setup

```powershell
git clone https://github.com/bibilabu-bot/poe2-agent-tools.git poe2-agent-tools
cd poe2-agent-tools
git fetch origin
git worktree add ../task-P2AT-029A-executor-bootstrap -b task/P2AT-029A-executor-bootstrap 4e579ab11938915db1196fc6441d8021125433bb
cd ../task-P2AT-029A-executor-bootstrap

# Python dependencies
python -m venv apps/planner-desktop/.venv
apps/planner-desktop/.venv/Scripts/python.exe -m pip install -r apps/planner-desktop/requirements.txt

# Node dependencies
npm --prefix apps/planner-desktop ci --ignore-scripts
```

## Baseline check results

### apps/planner-desktop: `npm test`

- Node: **196 tests — 193 pass, 0 fail, 3 skipped**
- Python: **60 tests — 60 pass (OK)**

3 skipped Node tests (expected — fresh environment without official tree cache):

| Test | Reason |
|------|--------|
| `locked coverage reports real mappings, categories, and Zarokh conflict` | Validated cache unavailable at `C:\Users\xty12\P2AT-004C-acceptance\user-data\game-data\core`; missing `official-data.json`, `tree-pre.json` |
| `allocation coverage evaluates supplied native allocation` | Same cache path unavailable |
| `locked-tree coverage can be reproduced when an official tree path is supplied` | `P2AT_OFFICIAL_TREE` environment variable not supplied |

Controller reference (with validated cache): Node 196/196, zero skips. The 3 skips here are consistent with a fresh environment lacking the official tree data cache. No tests were modified to bypass validation.

### apps/planner-desktop: `npm run check`

All JavaScript syntax checks passed (all `node --check` commands returned clean).

### Repository root: validate-upstream-lock

```
node --check tools/validate-upstream-lock.mjs  → PASS
node --test tools/validate-upstream-lock.test.mjs → 7/7 pass
node tools/validate-upstream-lock.mjs → "upstream source lock is valid"
```

### Repository root: jewel compiler

```
node --check tools/jewel-compiler/download_poe2_jewel_sources.mjs → PASS
node --check tools/jewel-compiler/build-jewel-db.mjs → PASS
node --check tools/jewel-compiler/verify-fixture.mjs → PASS
node tools/jewel-compiler/verify-fixture.mjs → PASS
  Verified 6 fixture outputs: 3 mods, 2 sockets, 6 unique jewels, 9 rule families
```

### Repository root: git diff --check

PASS — no whitespace errors.

## Electron UI checks

### `npm run test:prompt-inspector`

PASS — 3 checks: close control (visible/hittable, ESC, busy/dirty), 11-block catalog (drafts, save/restart/reset, overlength), inspector (read-only, state, no private data).

### `npm run test:agent-ui`

PASS — 3 checks: error visibility (message/activity/model/connection, Planner overlay), dark scrollbars and follow-bottom, production panel (expand/collapse, timing, memory links, HTML inert).

Both ran with a real Windows Electron instance. Electron binary was installed via `node node_modules/electron/install.js` (no `ELECTRON_SKIP_BINARY_DOWNLOAD`).

## Official tree cache (zero-skip verification)

Follow-up task on branch `task/P2AT-029A-cache-verification` (baseline `0acbfc416da6e98d6dec472a659f12adafdeb363`) closes the three cache-dependent skips by downloading and verifying the two missing canonical resources against `data/upstream-sources.lock.json`.

### Canonical resources

| Name | Lock ID | Bytes | SHA-256 |
|------|---------|-------|---------|
| `official-data.json` | `shared.ggg.passive-tree` | 5,140,821 | `b52be9c4f17e4114064255ef1b8c58292e9db0e395d95af235a8d3fef0d44642` |
| `tree-pre.json` | `runtime.drydream.tree-pre` | 1,580,743 | `bbb3b537669ad3ceadda62bcae5f824d3b6f4f23c8a917e0ab5ef858c4192796` |

Immutable download URLs (from the lock's `transport.url`):

- `https://raw.githubusercontent.com/grindinggear/poe2-skilltree-export/bd87e6512c92b868542eddfb1ba4ea8b6dc2da36/data.json`
- `https://raw.githubusercontent.com/drydream/poe2drydream/073838ccf0585131788e714721d6d2d95aa44b77/public/tree-pre.json`

### Test cache configuration

The tests read two environment variables (names confirmed from the test source, not guessed):

- `POE2_VALIDATED_CACHE_DIR` — directory containing both `official-data.json` and `tree-pre.json`. When set and either file is missing, the tests **fail** rather than skip.
- `P2AT_OFFICIAL_TREE` — path to the official tree file (`official-data.json`). Verified byte-for-byte against the `shared.ggg.passive-tree` lock entry.

Both files are verified by the tests themselves (byte count plus SHA-256 against the lock), so no test bypass is possible.

### Reproducible setup (no host or drive-specific paths)

```powershell
# Cache directory outside the repository (portable: derives from $env:USERPROFILE)
$cacheDir = Join-Path $env:USERPROFILE "p2at-validated-cache"
New-Item -ItemType Directory -Force $cacheDir | Out-Null

Invoke-WebRequest -Uri "https://raw.githubusercontent.com/grindinggear/poe2-skilltree-export/bd87e6512c92b868542eddfb1ba4ea8b6dc2da36/data.json" `
  -OutFile (Join-Path $cacheDir "official-data.json")
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/drydream/poe2drydream/073838ccf0585131788e714721d6d2d95aa44b77/public/tree-pre.json" `
  -OutFile (Join-Path $cacheDir "tree-pre.json")

# Strictly verify bytes and SHA-256 against data/upstream-sources.lock.json before running tests
# (the tests repeat this verification, so a mismatch fails rather than silently skipping)

cd apps/planner-desktop
$env:POE2_VALIDATED_CACHE_DIR = $cacheDir
$env:P2AT_OFFICIAL_TREE = Join-Path $cacheDir "official-data.json"
npm test
npm run check
```

### Zero-skip result

With the cache populated and both variables set, the full offline suite passes with no skips:

- Node: **196/196 pass, 0 fail, 0 skipped**
- Python: **60/60 pass**

The three previously skipped tests now run and pass:

1. `locked coverage reports real mappings, categories, and Zarokh conflict`
2. `allocation coverage evaluates supplied native allocation`
3. `locked-tree coverage can be reproduced when an official tree path is supplied`

## Limitations

1. Electron GPU warnings (`GPU state invalid after WaitForGetOffsetInRange`) are cosmetic and did not affect test results.
2. No real model calls, paid API keys, vector index rebuilds, or user session databases were accessed.
3. No production WeGame endpoints were contacted beyond what the test fixtures simulate.
4. The two downloaded resources remain outside the repository and Git (licensing: redistribution `prohibited-until-confirmed`); they must not be committed.

## Prerequisites for subsequent development

- The validated cache directory and `POE2_VALIDATED_CACHE_DIR` / `P2AT_OFFICIAL_TREE` variables enable full zero-skip locked-tree coverage (see "Official tree cache").
- Electron already available for UI regression checks.
