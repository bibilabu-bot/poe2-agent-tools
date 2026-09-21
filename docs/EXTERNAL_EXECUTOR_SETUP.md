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

## Limitations

1. Node test count (196) exceeds controller reference (196) — counts match; Python matches exactly at 60/60.
2. 3 Node tests skipped due to missing official tree cache. This is expected on a fresh checkout. The controller's cache path (`C:\Users\xty12\P2AT-004C-acceptance\user-data\game-data\core`) does not exist here.
3. Electron GPU warnings (`GPU state invalid after WaitForGetOffsetInRange`) are cosmetic and did not affect test results.
4. No real model calls, paid API keys, vector index rebuilds, or user session databases were accessed.
5. No production WeGame or live CDN endpoints were contacted beyond what the test fixtures simulate.

## Prerequisites for subsequent development

- Official tree cache directory (containing `official-data.json`, `tree-pre.json` from a validated canonical source) to enable full locked-tree test coverage.
- `P2AT_OFFICIAL_TREE` environment variable to enable locked-tree coverage reproduction tests.
- Electron already available for UI regression checks.