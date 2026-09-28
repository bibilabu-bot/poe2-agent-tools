# P2AT-008F — Ordinary socket and jewel management

Status: REVIEW (executor delivery; controller acceptance required). Date: 2026-09-28.
Branch: `task/P2AT-008F-jewel-management`. Base and remote main verified:
`7227dcb10f1b5dd7b895a3a850141f3e5eb4918f`.

## User outcome and scope

Build → 珠宝管理, or selecting a verified ordinary socket, opens the jewel manager.
Create/copy/delete inventory instances; equip/replace/unequip a selected socket;
Save/Open restores instances, placements and the passive tree. A short instance suffix
distinguishes copies. A teal canvas ring marks a socket containing a placement record;
white marks selection. The panel separates unallocated/unsupported retained records.

Only the six already approved sample definitions and twelve verified ordinary sockets
are offered. The UI explicitly labels this as a sample catalog and says attributes,
radius, rules and seed effects are not calculated. No game effects, guessed radius,
new AI tools, model permissions, data downloads or index rebuilds are introduced.

Owner clarification in this execution: **a jewel must be unequipped before refunding
its socket**. Direct refunds, upstream-node cascade refunds, the current refund preview,
and existing guarded agent write entry points all enforce this. Even an unsupported
retained placement conservatively prevents deleting an allocated socket until the user
removes that record. Equip requires a verified, allocated ordinary socket; one instance
cannot be interactively equipped twice. Imported conflicts are preserved but inactive.

Replace removes the old placement and leaves both instances in inventory. Unequip leaves
the instance; deletion removes the instance and all its placements/opaque members.
Copy creates a cryptographically random 128-bit ID and deep-copies opaque instance data.
Reset/class change explicitly confirms jewel deletion. Undo/redo includes jewel state
and the preservation sidecar. WeGame replacement explicitly discloses clearing jewels;
its replacement candidate starts with empty jewels and retains previous rollback safety.
Opening a previously saved placement on an unallocated socket retains the record with
an inactive label; it does not allocate the socket or calculate any effect.

## Integration and persistence

Selective reuse of pure codec/state/catalog work from old 008E
`59a163d3430efbbe48a23875fb2366f9887343f8`; no old Planner was copied wholesale.
The current main's refund confirmation, snapshots, agent UI and WeGame functions remain.

Small shared integration points: three script tags in `index.html`; Planner state,
official-data identity validation, node selection/ring, Build adapter, undo/reset and
refund guards. The manager builds its own dialog and attaches its button to the existing
Build panel after layout mounting. No layout-shell rewrite is required. Parallel loading
screen work should preserve these script tags and the existing layout mount event.

Explicit Save writes native schema 2. V1 opens as an in-memory migration without touching
the original file. Unknown definitions/properties/placements/object members stay inert
and round-trip. Future schemas, duplicate instance IDs, malformed/deep/oversized data and
duplicate JSON object keys are rejected. Open remains transactional, including jewels;
rollback failure still disables Save.

**Compatibility limitation requiring controller visibility:** a v1 file may have used
the previously unknown `build.jewels` name for private data. Such a file can open and its
private data is retained in the sidecar, but upgrading Save is rejected before file IPC
to prevent overwriting it. The error explains the collision. No v3 or invented extension
field is used. A future approved export/preservation strategy is needed for editing and
saving that specific collision case. Ordinary v1 files migrate and save successfully.

File dialogs/extensions remain the current `.json` implementation; the separate official
`.build` export/profile work is outside this task. This is native Build persistence,
not a claim of GGG or PoB file compatibility.

## PoB2 primary-source research

Community project, not an official GGG implementation:
[PathOfBuildingCommunity/PathOfBuilding-PoE2](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2).
The [community site](https://pathofbuilding.community/) links the PoE2 release.
`git ls-remote ... HEAD` returned fixed commit
`ce566eac45ea8a86477f513c7ee65a1ebe60014e` on 2026-09-28.
Only four relevant Lua files and the license text were downloaded; no assets/full clone.

| Source at pinned commit | Direct evidence |
| --- | --- |
| [ItemsTab.lua](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/blob/ce566eac45ea8a86477f513c7ee65a1ebe60014e/src/Classes/ItemsTab.lua#L330) | Lines 330–345 build controls keyed by real socket node IDs; Save at 1327 serializes item inventory separately. |
| [ItemSlotControl.lua](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/blob/ce566eac45ea8a86477f513c7ee65a1ebe60014e/src/Classes/ItemSlotControl.lua#L103) | `SetSelItemId` at 103–114 updates `spec.jewels[nodeId]`; refresh at 132–133 clears an unavailable/invalid selection using zero. |
| [PassiveSpec.lua](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/blob/ce566eac45ea8a86477f513c7ee65a1ebe60014e/src/Classes/PassiveSpec.lua#L324) | Load at 130–148 restores node/item identity. Save at 324–339 emits deterministically ordered socket records containing node and item IDs. |
| [TreeTab.lua](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/blob/ce566eac45ea8a86477f513c7ee65a1ebe60014e/src/Classes/TreeTab.lua#L548) | Switching specs at 548–562 stores the prior socket item and restores/clears the current one. |
| [LICENSE.md](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/blob/ce566eac45ea8a86477f513c7ee65a1ebe60014e/LICENSE.md) | Main project section is MIT, copyright David Gowor; file also records separate dependency notices. This does not license GGG assets or our other inputs. |

Design inference: keep inventory instance identity separate from socket placement, and
restore placement with the Build. Implementation here is original JavaScript governed by
our accepted v2 contract. No upstream Lua implementation or artwork is redistributed.
The refund rule comes from the owner's explicit clarification, not an asserted PoB/game
equivalence inferred from these sources. No radius/seed behavior was researched or ported.

Downloaded source SHA-256 (raw GitHub bytes):

```text
ItemsTab.lua        3539d5c720b11d869b8e8755ad4e66771c9fae6a746d6a7adaab41d726b249c2
ItemSlotControl.lua ca831e356e5b7e6e7226f6ef3f66ce4433f8f3b58969c2e03ed77789ca755158
PassiveSpec.lua     48cd6f687b9198fbb0134a714ea6f74fd502812640229c8fed69879c95c59e54
TreeTab.lua         116ece99af69a886ba334aa087fef3bca296803a7d0366f1dfe246d85fb0a2a5
LICENSE.md          b61f62cf2b8e301ef2a4a3c5f7de9460fea53327edf9f260b7c746502fc6bf97
```

## Verification

- Pure codec/state/adapter: v1 migration, canonical v2 save, opaque preservation,
  duplicate/reference/limit cases, transaction rollback, inventory/equipment ownership,
  runtime socket evidence gates, collision-safe IDs, copy and deletion.
- Refund regression: occupied leaf and cascade refusal preserve allocations and undo;
  removal enables refund; existing category/snapshot checks remain intact.
- Full Node: **265/265**, zero skips, with both `POE2_VALIDATED_CACHE_DIR` and
  `P2AT_OFFICIAL_TREE` pointing to the lock-verified cache. Python unittest discovery:
  **131/131**. Syntax checks and all six jewel compiler fixture outputs passed.
  After the final language-refresh fix, 58 focused tests and isolated Electron reran.
- Real isolated Windows Electron using production renderer, preload and atomic Build
  file IPC; synthetic file dialogs/Build data and a fresh temporary userData directory.
  Locked public tree bytes are checked before use. No user app restart, credentials,
  real conversation store, paid model endpoint or user index was accessed.
- Evidence: [equipped](assets/screenshots/p2at-008f/equipped.png),
  [inventory after unequip](assets/screenshots/p2at-008f/inventory.png),
  [machine-readable checks](assets/screenshots/p2at-008f/report.json).
  Test runner: `npm run test:jewels-electron` with Electron installed; optional
  `P2AT_GAME_CACHE` points to the existing game-data directory.
- Independent code review found legacy-field collision and duplicate-key data loss;
  both fixed and regression-tested; code reviewer approved. Independent JavaScript
  review found a localization refresh reopening the dialog; explicit selection now
  opens it while localization refresh only updates node detail. Electron regression
  also verifies canceling reset/class change and private v1 source-file protection.

No main merge or user acceptance launch is performed by this executor. Controller
accepts/merges first, then starts the larger integrated version for owner acceptance.
