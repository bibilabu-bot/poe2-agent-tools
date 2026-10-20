# P2AT-038 — WeGame candidate rejection

## Root cause and evidence

The authorized public service read succeeded without credentials. Its normal
allocation includes numeric passive 14265 (`fire85`, Pyromancer). This node exists
in locked official data but not the runtime slim catalog; the existing hidden-node
sidecar does not add this ordinary passive. Candidate construction previously
aborted with `Imported passive 14265 is missing from the current Planner catalog.`
Weapon-set missing nodes already had a separate explicit omission policy.

A sanitized fixture extended with only public ID 14265 reproduced that exact
rejection in the isolated production renderer. A unit regression failed before
the change and passed afterward. No live response, share token, role identity,
owner Build, credentials or private database is committed.

## Change and boundaries

- Official-mapped records classified `normal` but absent from the runtime catalog
  now become explicit omissions; they are never allocated or fabricated.
- Unified `omissions` includes normal and weapon omissions. The existing
  `weaponSetOmissions` field remains compatible. Counts add `normalApplied` and
  `totalOmitted`; previews and final feedback show applied/source quantities.
- The existing omission acknowledgment gate covers both categories.
- Missing sockets/ascendancy, classification conflicts, duplicate records and
  mismatched class/ascendancy remain blocking.
- Validation errors expose only allowlisted codes, static explanations and
  bounded numeric node IDs, not arbitrary exception or upstream text.
- Preview validation failures are no longer overwritten by a success message.

This restores explicit **partial** import, not full tree-data parity. Node 14265
remains absent after import. No data lock, graph, persistence schema or pathfinding
is changed. No owner application restart or main merge was performed.

## Verification

- 30 focused Node tests passed: import UI, transport service and Build transaction.
- `npm run check`, harness syntax and `git diff --check` passed.
- Isolated Electron with pinned public cache and sanitized fixture: real clicks
  validate all acknowledgment gates; preview lists normal node 14265; class/
  ascendancy rejection exposes its exact safe code; cancellation and rejected
  imports preserve Build/history; finalization rollback and unsafe-save guards
  pass; confirmed import succeeds and excludes 14265.
- Successful synthetic result: normal 86/87, weapon I 23/24, weapon II 24/24,
  two explicit omissions. These are fixture results, not owner Build statistics.
- Independent JavaScript reviewer: APPROVE, no blocking findings; independently
  reran syntax checks and 22 UI/transaction tests successfully.

Controller ACCEPTED on 2026-10-20 through `23b4732`, after diff inspection and
independent rerun of 30 focused Node tests (all passed). Owner verification remains
pending; this acceptance is for explicitly acknowledged partial import only.
