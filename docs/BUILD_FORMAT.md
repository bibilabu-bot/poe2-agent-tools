# Build JSON format and migration policy

Status: Accepted
Current schema version: `2` (schema v1 remains supported for migration)
Primary consumer: `apps/planner-desktop`
Persistence implementation: schema v1 is implemented; schema v2 is the accepted contract for follow-up codec and UI work

## 1. Purpose

This document defines the durable JSON persistence contract for PoE2 builds in `poe2-agent-tools`.

The format is intended to preserve build semantics independently from renderer details, localization, current camera position, transient hover/search state, or the internal shape of `renderer/planner.js`.

The first implementation is expected to be P2AT-004. This document defines the contract only; it does not implement save/open behavior.

The contract follows these principles:

1. Persist source state, not values that can be derived from that state.
2. Use display-independent node identifiers where the current planner provides them.
3. Never silently discard data merely because the current game-data snapshot does not understand it.
4. Never silently reinterpret an existing field name with a different meaning in a later schema.
5. Opening a file must be transactional: a failed import must leave the current build untouched.
6. Saving must be atomic with respect to the destination file.
7. Unknown JSON fields are opaque data, not executable instructions.
8. A newer schema version must never be destructively rewritten by an older application.

---

## 2. Current implementation facts

The format is based on the current desktop planner state rather than on a hypothetical future model.

`apps/planner-desktop/renderer/planner.js` currently keeps the relevant build state in these variables:

```text
baseClassName
classStartId
selectedAscendancyId
ascStartId

allocated
weaponSet1Allocated
weaponSet2Allocated
ascAllocated
instillAllocated

maxPoints
maxWeaponPoints
maxAscPoints
```

The ordinary passive node identity used throughout the planner is:

```js
String(n.skill ?? n._id)
```

Therefore persisted graph node identifiers are JSON strings, even when the upstream identifier happens to be numeric.

Current allocation semantics are also important:

```text
ordinary used points
    = allocated excluding classStartId

weapon set I used points
    = weaponSet1Allocated.size

weapon set II used points
    = weaponSet2Allocated.size

effective passive points used
    = ordinary used points
      + max(weapon set I used points, weapon set II used points)

ascendancy used points
    = ascAllocated excluding ascStartId
```

A class start node is automatically established when a base class is selected. An ascendancy start node is automatically established when an ascendancy is selected. Neither start node consumes a point.

Those start nodes are therefore derived state and are not persisted as user allocations in schema v1.

Tree-internal conditional/hidden nodes are ordinary graph nodes once allocated and use normal node IDs.

The separate instill/hidden-passive catalogue is different. `instillAllocated` currently stores the canonical English `rec.name` strings rather than graph node IDs. Schema v1 preserves that existing identity model instead of inventing an unsupported stable ID.

The planner's current undo snapshot contains ordinary, weapon-set, ascendancy and instill allocation sets, but does not contain class selection or point budgets. Build persistence must therefore not be implemented by simply serializing the existing undo snapshot.

---

## 3. File identity and top-level schema

Every schema-v1 Build file MUST be a JSON object containing these required top-level members:

| Field           | Type    | Required | Meaning                                                         |
| --------------- | ------- | -------- | --------------------------------------------------------------- |
| `format`        | string  | yes      | File-format discriminator. MUST equal `poe2-agent-tools-build`. |
| `schemaVersion` | integer | yes      | Build schema version. Schema defined here is `1`.               |
| `build`         | object  | yes      | Required gameplay/build state.                                  |
| `ui`            | object  | no       | Optional per-file editing/view state.                           |

The stable top-level form is:

```json
{
  "format": "poe2-agent-tools-build",
  "schemaVersion": 1,
  "build": {},
  "ui": {}
}
```

Unknown top-level fields are allowed and are governed by the unknown-field preservation policy below.

`schemaVersion` describes this Build persistence contract. It is not the application version, Electron version, PoE2 patch version, passive-tree revision, or upstream-data version.

---

## 4. Schema v1

### 4.1 `build.class`

Required.

```json
{
  "class": {
    "base": "Mercenary",
    "ascendancyId": "Mercenary1"
  }
}
```

Fields:

| Field          | Type             | Required | Meaning                                                                    |
| -------------- | ---------------- | -------- | -------------------------------------------------------------------------- |
| `base`         | string or `null` | yes      | Canonical base-class key currently stored in `baseClassName`.              |
| `ascendancyId` | string or `null` | yes      | Internal ascendancy identifier currently stored in `selectedAscendancyId`. |

`base` MUST use the canonical class key used by the planner, not a translated UI label.

`ascendancyId` MUST use the planner's internal ascendancy identifier such as the values currently stored in node `asc` fields and `selectedAscendancyId`. It MUST NOT store the translated ascendancy display name.

`classStartId` is not persisted. It is derived from `base`.

`ascStartId` is not persisted. It is derived from `ascendancyId`.

If `base` is `null`, `ascendancyId` MUST also be `null`.

---

### 4.2 `build.budgets`

Required.

```json
{
  "budgets": {
    "passive": 123,
    "weaponSet": 24,
    "ascendancy": 8
  }
}
```

Fields:

| Field        | Type    | Required | Current mapping   |
| ------------ | ------- | -------- | ----------------- |
| `passive`    | integer | yes      | `maxPoints`       |
| `weaponSet`  | integer | yes      | `maxWeaponPoints` |
| `ascendancy` | integer | yes      | `maxAscPoints`    |

Schema-v1 implementation constraints are based on the existing planner:

* `passive`: integer from `1` through `300`.
* `weaponSet`: integer from `0` through `100`.
* `ascendancy`: MUST be `8` in schema v1.

The current UI permits adjustment of `maxPoints` and `maxWeaponPoints`.

The current planner declares `maxAscPoints = 8` and does not expose an ascendancy-budget editor. Allowing arbitrary persisted ascendancy budgets would therefore introduce runtime behavior that does not currently exist. A future implementation that intentionally makes this configurable may revise this rule in a later schema.

Budget values are persisted because they are user/configuration state.

The following values MUST NOT be persisted:

```text
points used
points remaining
weapon-set points used
ascendancy points used
```

They are derived from allocations and budgets and MUST be recomputed after load.

An otherwise valid Build whose allocations currently exceed its persisted budget is not structurally corrupt. The current application can already create an over-budget state by reducing a budget after allocations exist. Such a Build MUST load without silently deleting allocations, but MUST produce an over-budget warning.

---

### 4.3 `build.allocations`

Required.

```json
{
  "allocations": {
    "normal": [],
    "weaponSet1": [],
    "weaponSet2": [],
    "ascendancy": [],
    "instilledPassives": []
  }
}
```

All five members are required in schema v1, even when empty. This avoids ambiguity between "empty" and "field absent because this writer did not understand it."

#### `normal`

Array of unique node-ID strings.

Maps to:

```text
allocated - classStartId
```

The class start node MUST NOT be written into this array.

Tree-internal conditional/hidden nodes are represented here when they belong to the normal allocation set. They do not need a separate persistence category merely because their visibility is conditional.

A hidden conditional node continues to use the same `idOf(n)` identity as any other graph node.

#### `weaponSet1`

Array of unique node-ID strings.

Maps directly to:

```text
weaponSet1Allocated
```

#### `weaponSet2`

Array of unique node-ID strings.

Maps directly to:

```text
weaponSet2Allocated
```

The same node ID may legitimately appear in both `weaponSet1` and `weaponSet2`.

This is not considered a duplicate error. The two arrays represent distinct weapon-set allocations, and the current effective point calculation intentionally charges the larger of the two weapon-set allocation counts.

A node that is already in `normal` should not additionally be persisted in a weapon-set allocation. If an imported file contains that redundant state, normal allocation wins and the redundant weapon-set entry is ignored with a warning.

#### `ascendancy`

Array of unique node-ID strings.

Maps to:

```text
ascAllocated - ascStartId
```

The ascendancy start node MUST NOT be written.

Every resolved node in this array must belong to the selected `ascendancyId`.

#### `instilledPassives`

Array of unique canonical English strings.

Maps directly to:

```text
instillAllocated
```

Example values include canonical names such as:

```text
Augmented Flesh
Paragon
Zarokh's Gift
```

These values are deliberately not translated labels.

The current planner uses canonical English passive names as the identity of these entries. Some of those passives may also be matched to native nodes by the official hidden-node sidecar, but the current runtime does not provide a guaranteed numeric ID for every instill entry.

Schema v1 therefore MUST NOT invent an ID scheme that the runtime does not possess.

A later stable-ID migration for instilled passives is a valid future extension.

---

## 5. Complete representative Build JSON

The following example exercises all schema-v1 categories.

The numeric node IDs are representative examples of the required string-ID form. They demonstrate the contract and are not a guarantee that those particular illustrative IDs exist in every upstream passive-tree revision.

```json
{
  "format": "poe2-agent-tools-build",
  "schemaVersion": 1,
  "build": {
    "class": {
      "base": "Mercenary",
      "ascendancyId": "Mercenary1"
    },
    "budgets": {
      "passive": 123,
      "weaponSet": 24,
      "ascendancy": 8
    },
    "allocations": {
      "normal": [
        "10531",
        "10542",
        "10704",
        "16112",
        "40827"
      ],
      "weaponSet1": [
        "21401",
        "21409",
        "21418"
      ],
      "weaponSet2": [
        "21401",
        "22970",
        "22984"
      ],
      "ascendancy": [
        "50112",
        "50118",
        "50127"
      ],
      "instilledPassives": [
        "Augmented Flesh",
        "Paragon"
      ]
    }
  },
  "ui": {
    "camera": {
      "x": 1120.5,
      "y": -860.25,
      "scale": 0.19
    },
    "weaponMode": "ws1",
    "showAscendancy": true,
    "showLockedConditional": false,
    "showInstilledOnGraph": true
  }
}
```

Array ordering is not semantically significant.

Writers SHOULD emit deterministic ordering so that repeated saves produce readable diffs. Node-ID arrays SHOULD use a stable numeric-aware ascending order where possible; instilled passive names SHOULD use a stable string order.

---

## 6. Required Build state versus optional UI/session state

### 6.1 Required semantic Build state

Everything under `build` is semantic state and MUST be preserved:

```text
class.base
class.ascendancyId

budgets.passive
budgets.weaponSet
budgets.ascendancy

allocations.normal
allocations.weaponSet1
allocations.weaponSet2
allocations.ascendancy
allocations.instilledPassives
```

A Build writer must not intentionally omit one of these fields merely because the corresponding value happens to equal the current application default.

Defaults change. A persisted Build must retain the value that was actually saved.

### 6.2 Optional `ui` state

`ui` is optional and MUST NOT affect the meaning or validity of the Build.

Schema-v1 writers MUST include the supported `ui` object by default for workspace restoration. Readers MUST continue to treat it as optional and non-semantic, so a missing `ui` object does not make a Build invalid.

Every schema-v1 field inside `ui` is also optional.

Supported fields are:

```json
{
  "ui": {
    "camera": {
      "x": 0,
      "y": 0,
      "scale": 0.04
    },
    "weaponMode": "general",
    "showAscendancy": false,
    "showLockedConditional": false,
    "showInstilledOnGraph": false
  }
}
```

Mappings:

| Field                      | Current planner state   |
| -------------------------- | ----------------------- |
| `ui.camera.x`              | `camera.x`              |
| `ui.camera.y`              | `camera.y`              |
| `ui.camera.scale`          | `camera.scale`          |
| `ui.weaponMode`            | `weaponMode`            |
| `ui.showAscendancy`        | `showAsc`               |
| `ui.showLockedConditional` | `showLockedConditional` |
| `ui.showInstilledOnGraph`  | `showInstillOnGraph`    |

Valid `weaponMode` values are:

```text
general
ws1
ws2
```

`camera.x` and `camera.y` must be finite numbers.

The current renderer clamps zoom to approximately:

```text
0.008 <= camera.scale <= 2.5
```

An imported UI scale outside that range may be clamped with a non-fatal warning.

If `ui` or one of its members is absent, the loader SHOULD leave the corresponding current session/view setting unchanged, except where a build-dependent invariant requires adjustment. For example, `showAscendancy` cannot remain active when no ascendancy is selected.

### 6.3 Transient state that MUST NOT be persisted in Build v1

The following current renderer state is deliberately excluded:

```text
selected
hovered

previewPath
previewIds
previewEdgeKeys

ascPreviewPath
ascPreviewIds
ascPreviewEdgeKeys
ascPathParent

searchMatches
searchMatchIds
searchMatchIndex
searchHighlightActive

undoStack
redoStack

instillOverlayHits
hoveredInstill

classPortraitImg
classPortraitCache
sprite/image loading state
translation caches
derived path indexes
spatial indexes
render edges
```

These values either represent temporary interaction state, caches, derived indexes, or rendering implementation details.

Search text and `instillSearchQuery` are also not part of Build v1.

The following display preferences are intentionally not part of the schema-v1 Build contract:

```text
languageMode
showIcons
showFrames
showSmall
showLabels
styleMode
edgeOpacity
nodeScale
```

They are application/view preferences rather than Build semantics. If persistent application preferences are later added, they should normally live outside individual Build files.

---

## 7. Derived state that MUST NOT become duplicate persistence truth

The following state is derived and MUST be rebuilt after load.

### Class start

`classStartId` is derived by resolving `build.class.base` through the current class options.

It is automatically inserted into `allocated`.

It does not consume a passive point.

### Ascendancy start

`ascStartId` is derived after resolving `build.class.ascendancyId`.

It is automatically inserted into `ascAllocated`.

It does not consume an ascendancy point.

### Used and remaining points

All used/remaining point counters are recomputed from allocation sets and budgets.

### Mastery state

Mastery visual activation is currently derived from allocated surrounding/trigger nodes.

Mastery visual nodes themselves are not normal traversable allocations and MUST NOT receive a new persisted allocation list in schema v1.

### Conditional-node visibility

Whether a tree-internal conditional node is visible or locked is derived from:

```text
current allocation
unlock constraints
selected ascendancy
showLockedConditional
```

No separate semantic "visible conditional nodes" list is persisted.

### Ascendancy display transform

`ascDisplayDelta` is a renderer-derived positioning value and MUST NOT be persisted.

---

## 8. Field-to-runtime mapping

This table is normative for P2AT-004.

| Build JSON field                      | Existing state          | Load/write rule                                                      |
| ------------------------------------- | ----------------------- | -------------------------------------------------------------------- |
| `format`                              | none                    | Persistence-layer metadata to be implemented by P2AT-004.            |
| `schemaVersion`                       | none                    | Persistence-layer metadata to be implemented by P2AT-004.            |
| `build`                               | none                    | Document grouping object; no monolithic `build` object exists today. |
| `build.class.base`                    | `baseClassName`         | Persist canonical base-class key.                                    |
| `build.class.ascendancyId`            | `selectedAscendancyId`  | Persist internal ascendancy ID or `null`.                            |
| derived class start                   | `classStartId`          | Do not persist; derive from base class.                              |
| derived ascendancy start              | `ascStartId`            | Do not persist; derive from ascendancy.                              |
| `build.budgets.passive`               | `maxPoints`             | Persist exact configured budget.                                     |
| `build.budgets.weaponSet`             | `maxWeaponPoints`       | Persist exact configured weapon-set capacity.                        |
| `build.budgets.ascendancy`            | `maxAscPoints`          | v1 value is `8`.                                                     |
| `build.allocations.normal`            | `allocated`             | Persist all allocated ordinary IDs except `classStartId`.            |
| `build.allocations.weaponSet1`        | `weaponSet1Allocated`   | Persist set as unique string IDs.                                    |
| `build.allocations.weaponSet2`        | `weaponSet2Allocated`   | Persist set as unique string IDs.                                    |
| `build.allocations.ascendancy`        | `ascAllocated`          | Persist IDs except `ascStartId`.                                     |
| `build.allocations.instilledPassives` | `instillAllocated`      | Persist canonical English names.                                     |
| `ui.camera.x`                         | `camera.x`              | Optional.                                                            |
| `ui.camera.y`                         | `camera.y`              | Optional.                                                            |
| `ui.camera.scale`                     | `camera.scale`          | Optional; clamp to supported renderer range if needed.               |
| `ui.weaponMode`                       | `weaponMode`            | Optional.                                                            |
| `ui.showAscendancy`                   | `showAsc`               | Optional.                                                            |
| `ui.showLockedConditional`            | `showLockedConditional` | Optional.                                                            |
| `ui.showInstilledOnGraph`             | `showInstillOnGraph`    | Optional.                                                            |

There is currently no planner variable for:

```text
Build title
Build description
author
notes
tags
PoE2 patch
passive-tree revision
upstream dataset hash
equipment
skills
jewels placed into sockets
crafting state
cloud identity
```

Those are future extensions and MUST NOT be silently fabricated as if current runtime support already existed.

---

## 9. Validation model

Validation has three result classes:

```text
fatal
warning/recoverable
valid
```

A fatal error aborts the open operation and leaves the current planner state untouched.

A warning may allow the Build to open, but the user must be informed that some data could not currently be activated.

Warnings MUST NOT cause opaque/unknown data to be silently erased from a subsequent save.

---

## 10. Malformed or structurally invalid JSON

The following are fatal:

* the file cannot be decoded as UTF-8;
* `JSON.parse` fails;
* root value is not an object;
* `format` is absent or not exactly `poe2-agent-tools-build`;
* `schemaVersion` is absent, is not an integer, or is less than `1`;
* a required schema-v1 object or member is absent;
* a required scalar has the wrong type;
* an allocation field is not an array;
* a node-ID entry is not a non-empty JSON string;
* a budget value falls outside the implementation-supported schema-v1 range;
* `build.class.base` has an invalid JSON type;
* `build.class.ascendancyId` has an invalid JSON type.

Schema v1 MUST NOT silently coerce:

```text
123 -> "123"
"123" -> 123
"true" -> true
```

Type coercion makes corrupt files appear valid and makes migrations ambiguous.

A future migration may explicitly convert an old-version representation, but schema-v1 validation itself is strict.

---

## 11. Duplicate identifiers

Allocation arrays represent sets.

Repeated entries within the same array are recoverable.

Example:

```json
{
  "normal": ["100", "100", "200"]
}
```

loads semantically as:

```text
100
200
```

The loader MUST emit a duplicate-ID warning.

The writer MUST emit only unique entries.

The same node appearing in both `weaponSet1` and `weaponSet2` is allowed and is not a duplicate conflict.

A node appearing in `normal` and a weapon-set list is redundant. The normal allocation takes runtime precedence, because a general allocation is active regardless of weapon set. The redundant specialized entry is ignored with a warning.

Duplicate `instilledPassives` names are treated in the same way: one runtime selection plus a warning.

---

## 12. Unknown node IDs

A node identifier is unresolved when the Build contains a syntactically valid ID string that is not present in the currently loaded planner node map.

An unresolved ID MUST NOT be inserted into a runtime allocation set.

It MUST produce a warning identifying:

```text
allocation category
identifier
reason: unresolved in current tree
```

The unresolved identifier MUST be preserved in the opened-document preservation sidecar so that an ordinary re-save does not destroy it.

This rule protects against:

* old builds containing nodes removed from a later passive tree;
* builds created against a different upstream data snapshot;
* newer builds containing nodes unknown to an older application;
* temporary/incomplete local game-data caches.

Schema v1 currently has no reliable persisted tree-revision identifier, so the loader cannot always distinguish "this ID never existed" from "this ID existed in another tree revision."

The user-facing diagnostic should therefore use wording equivalent to:

```text
unresolved in the currently loaded passive tree
```

rather than falsely claiming that the ID is definitely corrupt.

---

## 13. Nodes deleted by later game-data revisions

A previously valid node that no longer exists is handled as an unresolved ID.

The loader MUST:

1. retain the identifier as opaque unresolved Build data;
2. not activate the node;
3. warn the user;
4. continue loading other valid portions of the Build when possible;
5. retain that unresolved ID when the same document is saved again.

A later migration may map a known retired ID to a replacement ID only if that mapping is explicit and deterministic.

Similarity by name, coordinates, stats, graph position, or nearest node MUST NOT be used to silently replace deleted nodes.

Automatic guessing would change the user's build.

---

## 14. Known IDs in the wrong allocation category

A currently known node can still be semantically invalid for the category in which it appears.

Examples include:

* an ascendancy node inside `normal`;
* an ordinary node inside `ascendancy`;
* an ascendancy node belonging to a different selected ascendancy;
* a class start node explicitly listed as a paid normal allocation;
* an ascendancy start node explicitly listed as a paid ascendancy allocation;
* a node not permitted for weapon-set specialization placed into a weapon-set allocation.

These conditions are recoverable import warnings unless they prevent establishment of the base class itself.

The invalid entry is not activated.

The original identifier remains preserved as unresolved/unsupported source data until the user intentionally creates a new document or explicitly discards unsupported data.

Start nodes are a special case. If a file explicitly includes the correctly derived class or ascendancy start ID in an allocation array, the loader may simply remove that redundant entry with a warning because the start is already restored implicitly.

---

## 15. Unknown base class or ascendancy

An unknown `build.class.base` is fatal for schema-v1 application.

The normal passive graph requires a valid class start, and loading ordinary allocations under an arbitrary replacement class would alter the Build.

The application MUST NOT guess another class.

If the base class is recognized but `ascendancyId` is no longer recognized for that class:

* the base class and ordinary/weapon allocations may still load;
* the unknown ascendancy value and its allocation IDs must be preserved;
* ascendancy allocations are not activated;
* the user receives a warning that the ascendancy portion could not be resolved.

The application MUST NOT silently select the first currently available ascendancy.

---

## 16. Conditional/hidden tree nodes

Tree-internal conditional nodes that use `unlockConstraint` or equivalent current planner logic remain ordinary node-ID allocations.

No separate v1 field such as:

```text
hiddenNodes
conditionalNodes
```

is introduced.

On load, the node must be resolved by ID and revalidated against the current constraints.

If a previously legal conditional allocation can no longer be satisfied because its prerequisites or ascendancy requirements changed, it is not silently remapped or deleted. It is treated as currently unsupported allocation data, preserved, and reported.

`showLockedConditional` is only optional UI state. It is not evidence that the Build owns a hidden node.

---

## 17. Instilled/externally hidden passives

`instilledPassives` is deliberately separate from normal graph allocations because the existing runtime treats it separately and does not charge ordinary or ascendancy points for it.

Validation uses the current canonical `INSTILL_EXCLUSIVE_PASSIVES` names.

Unknown canonical names are handled like unresolved IDs:

* do not activate them;
* warn;
* preserve them for re-save.

Localization MUST NOT participate in identity matching.

For example, the loader must not attempt to resolve an instilled passive by its current Chinese display text.

---

## 18. Budget validation

Budget configuration validity and allocation validity are separate.

A valid budget plus an over-budget allocation is recoverable.

For example:

```json
{
  "budgets": {
    "passive": 100,
    "weaponSet": 20,
    "ascendancy": 8
  }
}
```

may coexist with currently resolved allocations requiring 105 effective passive points.

The loader SHOULD report:

```text
current allocation exceeds saved passive budget
```

but MUST NOT silently refund nodes.

Likewise, a weapon-set allocation count greater than `weaponSet` must be preserved and warned about rather than automatically truncated.

The application may prevent additional allocations until the user resolves the over-budget state, consistent with normal planner rules.

---

## 19. Transactional open behavior

Opening a Build is an all-or-nothing mutation of the current planner state.

The required conceptual sequence is:

```text
choose file
    ↓
read bytes
    ↓
decode UTF-8
    ↓
parse JSON
    ↓
verify format/version
    ↓
migrate old supported version
    ↓
validate structure
    ↓
resolve semantic IDs into candidate state
    ↓
collect warnings/unresolved data
    ↓
commit candidate state
    ↓
rebuild derived indexes/UI
```

No current planner state should be destructively changed before the candidate state is ready to commit.

If any fatal step fails, the current Build remains exactly as it was before the open operation.

After a successful commit:

* class/ascendancy start state is regenerated;
* point counters are recomputed;
* path indexes are rebuilt;
* previews are cleared;
* selection/hover state is cleared;
* undo and redo history are cleared;
* optional `ui` values are applied after semantic state;
* warnings are surfaced to the user.

Loading a file establishes a new editing baseline. Undo history from the previously open Build must not cross the file-open boundary.

---

## 20. Version migration

### 20.1 Current schema

The current writer version is:

```text
1
```

There is no pre-v1 official Build contract, so schema v1 has no implicit legacy format.

An arbitrary JSON object without `format` and `schemaVersion` MUST NOT be guessed to be a Build v1 file.

If a legacy importer is later added for an experimentally used pre-v1 format, that importer must be explicit and separately tested.

### 20.2 Forward migration: older file to current schema

When the application supports schema version `N`, a document with version `< N` is migrated in memory through explicit consecutive migrations:

```text
v1 -> v2 -> v3 -> ... -> vN
```

Every migration MUST be:

* deterministic;
* side-effect free with respect to filesystem state;
* testable from fixture input to fixture output;
* explicit about renamed/removed fields;
* preservation-aware for unknown fields;
* executed before normal current-schema validation.

A migration increments exactly one schema generation unless a documented exception is approved.

Opening an old Build MUST NOT immediately rewrite the source file.

The migrated representation is written only when the user explicitly saves.

### 20.3 Newer file in an older application

If:

```text
file.schemaVersion > applicationSupportedSchemaVersion
```

the application MUST reject semantic loading of the Build.

It may display version metadata and an explanatory message, but it must not partially apply the file and then allow a normal save over it.

Recommended message:

```text
This Build was created by a newer Build format and cannot be safely edited by this version of poe2-agent-tools.
```

This rule prevents an older writer from destroying semantics it does not understand.

### 20.4 Backward migration / downgrade

Automatic downgrade from the current schema into an older schema is not part of Build v1.

If a future explicit "Export as older format" feature is added, it is a separate export operation and must report any information that cannot be represented in the target version.

The ordinary Save action always writes the current schema.

### 20.5 Field-name stability

Once published, a field name must not later be reused for unrelated semantics.

If a future version replaces a concept, migration must explicitly translate the old field.

For example, if `instilledPassives` is later replaced by durable IDs, the migration must deliberately map known canonical names to those IDs rather than silently changing the interpretation of the existing field.

---

## 21. Unknown-field preservation

Unknown JSON object members are allowed.

For any supported file version that can be opened, the application MUST preserve unknown members when the same logical document is saved again.

Example input:

```json
{
  "format": "poe2-agent-tools-build",
  "schemaVersion": 1,
  "build": {
    "class": {
      "base": "Mercenary",
      "ascendancyId": null,
      "thirdPartyClassHint": "example"
    },
    "budgets": {
      "passive": 123,
      "weaponSet": 24,
      "ascendancy": 8
    },
    "allocations": {
      "normal": [],
      "weaponSet1": [],
      "weaponSet2": [],
      "ascendancy": [],
      "instilledPassives": []
    },
    "thirdPartyExtension": {
      "value": 42
    }
  }
}
```

A normal load/save cycle MUST NOT erase:

```text
build.class.thirdPartyClassHint
build.thirdPartyExtension
```

Unknown members:

* are ignored for planner behavior;
* are not trusted;
* are not executed;
* do not bypass validation of known members;
* survive a normal load/edit/save cycle.

The implementation should retain an opaque clone/sidecar of the opened document and overlay current known fields onto it when saving rather than rebuilding the entire JSON document from known fields alone.

When a migration explicitly consumes or renames an unknown-looking field because it has become part of a newer schema, the migration owns that transformation.

Unknown data remains associated with the opened document until the user explicitly creates a new document or chooses an explicit future operation to discard unsupported data.

---

## 22. Preservation of unresolved allocation identifiers

Unknown JSON fields and unresolved allocation identifiers are related but not identical.

For each allocation list, the loader should conceptually partition source entries into:

```text
resolved active identifiers
unresolved preserved identifiers
```

Only the resolved identifiers enter planner runtime Sets.

The unresolved identifiers remain in the persistence sidecar.

When saving:

```text
serialized allocation list
    = current valid runtime allocation
      + still-unresolved preserved identifiers
```

Duplicates are removed.

If a previously unresolved identifier becomes recognized by the currently loaded data before a later open, it should pass through normal validation on that later open.

The application must never create fake runtime nodes merely to preserve an unknown ID.

---

## 23. Atomic save requirements

The current desktop main process writes JSON directly to the final destination path. P2AT-004 must strengthen that behavior.

A successful Build Save must be atomic from the user's perspective.

Expected sequence:

```text
construct current Build document
    ↓
validate document
    ↓
serialize complete UTF-8 JSON
    ↓
show save dialog
    ↓
create temporary sibling file
    ↓
write complete content
    ↓
flush/close as appropriate
    ↓
replace/rename into destination
    ↓
report success
```

The temporary file should be created in the destination directory so that the final rename/replacement remains on the same filesystem.

If writing fails:

* the existing destination file must remain untouched;
* an incomplete temporary file must not be reported as a successful Build;
* temporary artifacts should be cleaned up when practical;
* the renderer receives a structured failure;
* the application must not claim the Build was saved.

If replacing an existing file requires platform-specific handling, the implementation must preserve the same invariant: either the previous valid file or the new complete file exists after the operation, not a partially written JSON document.

Serialization should use readable UTF-8 JSON and end with a newline.

Example:

```js
JSON.stringify(document, null, 2) + "\n"
```

The exact implementation is left to P2AT-004; the atomicity guarantee is part of the contract.

---

## 24. Existing Electron save/open boundary

The current preload exposes:

```text
desktopAPI.saveBuildJson(payload)
desktopAPI.openBuildJson()
```

and the main process owns the filesystem dialog and file access.

That boundary should remain narrow.

The renderer should not receive general filesystem capability merely to implement Build persistence.

The renderer should not supply an arbitrary file path to a generic write primitive.

P2AT-004 may evolve the payload/result structures of these Build-specific IPC methods, but it should preserve the architecture principle that filesystem access remains in the main process behind a Build-specific preload API.

---

## 25. Security requirements for user-supplied Build JSON

A Build file is untrusted input.

Opening a `.json` file does not make its contents trustworthy.

### 25.1 No executable semantics

No Build field may be evaluated as JavaScript.

The loader MUST NOT use:

```text
eval
Function
dynamic module import derived from Build data
HTML script insertion
```

Unknown fields are inert data.

### 25.2 No URL or filesystem capability

Schema v1 contains no URL or filesystem-path fields.

Unknown fields containing strings that look like URLs or paths MUST NOT trigger:

```text
fetch
net.fetch
shell.openExternal
filesystem reads
filesystem writes
```

Opening a Build must not cause arbitrary remote content to be loaded.

Normal planner game-data loading remains controlled by the application's own data sources, not by the Build document.

### 25.3 Prototype-pollution resistance

Parsed objects must be treated as untrusted records.

Validation and migration code should read own properties deliberately and create known state objects explicitly.

A Build containing fields such as:

```text
__proto__
constructor
prototype
```

must not be allowed to mutate application prototypes through unsafe merging.

Unknown-field preservation must use a safe cloning/serialization approach rather than an unsafe recursive assignment into shared prototypes.

### 25.4 Resource limits

The implementation must impose finite limits on:

* Build file byte size;
* object nesting depth if custom traversal is used;
* allocation-array lengths;
* individual string lengths;
* diagnostic count displayed to the user.

These limits protect against accidental or malicious memory/CPU exhaustion.

Schema-v1 implementations MUST enforce these limits:

* maximum Build file size: 5 MiB;
* maximum entries per allocation array: 20,000;
* maximum length of each known identifier or name: 256 characters;
* maximum validation traversal depth: 64;
* maximum detailed diagnostics retained and displayed: 100, while aggregate counts MUST still be preserved and shown.

Exceeding a hard resource limit is fatal and leaves the current Build untouched.

### 25.5 Error handling

Malformed JSON must produce a controlled user-facing error.

The main process should not allow a raw `JSON.parse` exception to become the only error contract.

Errors returned across IPC should distinguish at least:

```text
user cancelled
read failed
malformed JSON
unsupported format
unsupported schema version
validation failed
save failed
```

Detailed stack traces or internal paths should not be shown as normal user-facing messages.

### 25.6 Privacy

Build files are local user content.

The application should not:

* upload them automatically;
* log their complete contents;
* log unknown extension payloads;
* embed the local source `filePath` into the saved Build;
* transmit them to upstream data providers;
* use them as telemetry without a separate explicit policy.

The open/save dialog may naturally expose a selected path to the local Electron processes, but that path is session information, not Build content.

The Build schema is not intended to contain credentials or secrets. If third-party extensions add such fields, unknown-field preservation still does not authorize the application to inspect, transmit, or execute them.

### 25.7 UI rendering

Any strings originating from Build JSON or preserved extensions must be rendered as text unless a separate trusted renderer exists.

Do not treat Build strings as HTML.

---

## 26. Safe application order

When semantic validation succeeds, state should be established in dependency order.

Recommended logical order:

```text
1. resolve base class
2. derive classStartId
3. resolve ascendancy
4. derive ascStartId
5. set persisted budgets
6. resolve ordinary allocations
7. resolve weapon-set I allocations
8. resolve weapon-set II allocations
9. resolve ascendancy allocations
10. resolve instilled passives
11. recompute/revalidate paths and constraints
12. compute budget diagnostics
13. clear transient selection/previews/history
14. apply optional UI state
15. redraw
```

This order is a behavioral requirement, not a requirement to call the current UI event handlers literally.

Implementation should avoid using destructive event-handler sequences before validation has completed.

---

## 27. Save canonicalization

A schema-v1 writer should produce a predictable representation.

For known fields it should:

* emit `format` exactly once;
* emit `schemaVersion` as integer `1`;
* emit all required `build` fields;
* serialize node identifiers as strings;
* omit derived start node IDs;
* remove duplicates;
* keep `weaponSet1` and `weaponSet2` independent;
* serialize `instilledPassives` using canonical English names;
* recompute nothing into extra "used points" fields;
* preserve unknown members;
* preserve unresolved identifiers;
* write current known semantic values over stale values in the preservation sidecar.

The optional, non-semantic schema-v1 `ui` object is written by default. Individual unsupported or unavailable `ui` members may be omitted.

Whether or not `ui` is present must never change Build semantics.

---

## 28. Compatibility examples

### Duplicate ID

Input:

```json
"normal": ["100", "100", "200"]
```

Result:

```text
load 100 and 200
warn about duplicate 100
save one copy of each
```

### Unknown current-tree ID

Input:

```json
"normal": ["100", "999999999"]
```

where `999999999` is not present in `byId`.

Result:

```text
activate 100
preserve 999999999 as unresolved
warn
retain 999999999 on normal re-save
```

### Removed old node

Handled identically to an unresolved current-tree ID unless explicit migration metadata identifies a known replacement.

No guessed replacement is allowed.

### Future unknown field

Input:

```json
"build": {
  "...": "...",
  "futureFeature": {
    "mode": "example"
  }
}
```

Result:

```text
ignore for runtime
preserve for re-save
```

provided the overall schema version is supported.

### Newer schema

Input:

```json
{
  "format": "poe2-agent-tools-build",
  "schemaVersion": 4
}
```

when the application supports only through `1`.

Result:

```text
do not load
do not mutate current Build
do not offer ordinary destructive re-save
report newer unsupported format
```

---

## 29. Explicitly excluded from schema v1

P2AT-003 does not define persistence for:

```text
equipment
item crafting
skills/gems
jewel instances or socket contents
jewel compiler rule state
character statistics
damage calculations
notes
tags
Build sharing
cloud synchronization
database storage
accounts
remote IDs
automatic backups
release packaging
```

Future modules may extend the Build contract through new schema versions after those runtime features actually exist.

This document also does not select a database and does not design cloud synchronization.

---

## 30. Future extensions already visible from project state

The following extensions are plausible but are not current schema-v1 runtime fields.

### Passive-tree / data revision

A future Build may benefit from recording a stable data fingerprint such as:

```text
game patch
passive-tree export revision
pinned source commit
normalized dataset revision
```

The repository currently consumes moving external game-data sources, and P2AT-005 is specifically intended to define provenance and pinning.

P2AT-003 therefore does not invent a revision identifier before that work exists.

### Durable instill identifiers

The current runtime uses English names for `instillAllocated`.

A future normalized data contract may define a durable instill ID. Such a change should migrate existing canonical names explicitly.

### Equipment, skills and jewel state

Those areas do not currently exist as equivalent planner Build state. Fields for them are future work, not omitted schema-v1 implementation details.

---

## 31. Accepted controller decisions

The project controller has resolved the five implementation-policy questions raised by P2AT-003. These decisions are normative for schema v1 and P2AT-004.

### U1 — Canonical-name identity for schema-v1 instilled passives

Accepted v1 rule:

```text
build.allocations.instilledPassives
    = canonical English names from instillAllocated
```

Reason: this is the actual identity used by the current runtime. A durable-ID migration may follow later if a normalized ID becomes available.

### U2 — No required data-revision fingerprint in schema v1

Schema v1 does not require a tree/data revision because the repository does not yet have a pinned, documented revision contract.

P2AT-005 is intended to solve that upstream provenance problem.

P2AT-005 may define a future optional provenance member or schema migration after it establishes a stable source identity.

### U3 — Concrete anti-resource-exhaustion limits

Schema-v1 implementations MUST enforce:

```text
maximum Build file size: 5 MiB
maximum entries per allocation array: 20,000
maximum length per known identifier/name: 256 characters
maximum validation traversal depth: 64
maximum detailed diagnostics retained/displayed: 100
```

Aggregate diagnostic counts MUST be preserved and displayed even when detailed diagnostics are capped at 100.

### U4 — Write `ui` by default

Schema-v1 writers write the optional `ui` object by default for workspace restoration.

`ui` remains explicitly non-semantic. Readers do not use its presence, absence or contents to determine Build validity.

### U5 — One bounded import summary for partial compatibility loads

This contract permits successful loading with preserved unresolved IDs.

The application MUST show one import summary with aggregate counts and at most 100 expandable details. It MUST NOT show one modal per affected node.

---

## 32. Accepted architecture decision

Acceptance of this document creates a durable data-contract boundary recorded in `docs/DECISIONS.md`.

Accepted decision:

### ADR-006 — Build JSON is a versioned durable compatibility boundary

`poe2-agent-tools` stores user Builds in an explicitly versioned JSON contract.

The application:

* persists semantic source state instead of renderer-derived state;
* migrates supported older schema versions explicitly;
* rejects newer unsupported schema versions rather than destructively rewriting them;
* preserves unknown fields and unresolved identifiers when safely editing supported documents;
* keeps filesystem access behind the Electron preload/main-process boundary;
* saves Build files atomically.

Reason:

Build files are user-owned durable data and must survive planner refactors, localization changes, upstream passive-tree changes and future schema extensions without silent corruption or data loss.

This ADR was accepted by the project controller through P2AT-003A.

---

## 33. P2AT-004 implementation acceptance guidance

P2AT-004 should be considered consistent with this contract only if its implementation can demonstrate at least the following cases:

```text
new v1 Build save/open round trip
ordinary allocation round trip
weapon-set I/II round trip
ascendancy round trip
instilled-passive round trip
class and ascendancy round trip
custom passive/weapon budget round trip
class/ascendancy start reconstruction
duplicate-ID warning and deduplication
unknown-ID preservation
deleted-node/unresolved preservation
unknown-field preservation
malformed JSON rejection
future schema rejection
over-budget load without silent refunds
failed open leaving current state unchanged
atomic save failure leaving previous file intact
```

Tests should use offline fixture data and must not require live HTTP access or an Electron binary merely to validate migration/normalization logic where those behaviors can be extracted as pure functions.

P2AT-004 should not broaden into equipment, skills, jewel integration, cloud sync, database selection, or planner decomposition.

---

## 34. Summary of schema-v1 persistence truth

The durable Build truth is:

```text
schema identity
    format
    schemaVersion

character identity
    base class
    ascendancy ID

point configuration
    passive budget
    weapon-set budget
    ascendancy budget

allocations
    ordinary node IDs
    weapon-set I node IDs
    weapon-set II node IDs
    ascendancy node IDs
    instilled-passive canonical names
```

Everything else is either:

```text
derived state,
optional UI/session state,
opaque preserved extension data,
or future work.
```

That boundary is intentional and is the basis on which P2AT-004 should connect the current planner state to the existing Electron Build save/open interface.

---

## 35. Schema v2 — jewel persistence (normative)

Schema v2 is the current Build schema.  It retains **all** schema-v1 fields, meanings,
validation rules, preservation rules, limits, and application behavior unchanged, and adds
only the required `build.jewels` member.  In particular, this section does not redefine
schema-v1 allocation, class, budget, UI, or sidecar semantics.

```json
{
  "format": "poe2-agent-tools-build",
  "schemaVersion": 2,
  "build": {
    "class": { "base": null, "ascendancyId": null },
    "budgets": { "passive": 1, "weaponSet": 0, "ascendancy": 8 },
    "allocations": {
      "normal": [], "weaponSet1": [], "weaponSet2": [],
      "ascendancy": [], "instilledPassives": []
    },
    "jewels": { "instances": [], "placements": [] }
  },
  "ui": {}
}
```

`build.jewels` is required in a source v2 file and contains exactly these two required
array members.  Its absence is a fatal `missing_required_field` in v2.  It is not a
schema-v1 extension: a v1 reader must retain its existing interpretation and must not
activate an unknown `jewels` member.

### 35.1 Definitions, instances, placements, and socket descriptors

These four concepts are deliberately separate:

| Concept | Owner | Identity | Meaning |
| --- | --- | --- | --- |
| definition | reviewed jewel catalog | `definitionId` | immutable kind of jewel; never a user's copy |
| instance | one Build | `id` | one user-owned copy and its opaque per-copy properties |
| placement | one Build | `(socketNodeId, instanceId)` | request to equip an instance in a socket |
| socket descriptor | reviewed runtime catalog | decimal `nodeId`, `officialRawId`, `category` | evidence-backed description of a tree socket |

A definition is catalog metadata and is not copied into a Build.  A placement has no
generated ID.  A socket descriptor is not a placement and is not derived from a jewel
name or compiler-fixture position.

### 35.2 Jewel instance

Each `build.jewels.instances` element MUST be an object with:

| Field | Required | Type and rule |
| --- | --- | --- |
| `id` | yes | ASCII string matching `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` |
| `definitionId` | yes | project definition-ID string, 1–256 ASCII characters, matching `^[a-z][a-z0-9.-]*:[a-z0-9][a-z0-9._-]*$` |
| `properties` | yes | JSON object; keys are strings of at most 256 characters; values are JSON primitives, arrays, or objects; no functions, non-finite numbers, or duplicate JSON object keys |

The writer creates a new instance ID with 128 bits from a cryptographically secure random
source, encoded as lowercase hexadecimal and prefixed `jwl_` (for example
`jwl_4d2c...`), so it satisfies the grammar.  A collision with any live or preserved
instance ID must be retried.  IDs are opaque: they must not encode display name,
localized name, catalog position, socket, time, or a deterministic sequence.

Copying creates a new ID and deep-copies `definitionId`, `properties`, and preserved
unknown instance members.  Replacing a socket removes that placement and adds the new
one; it does not mutate either instance.  Removing an instance removes all placements
that reference it and then removes its preservation record.  Removing one placement does
not remove its instance.  A semantic v2 document permits an instance in multiple
placements, but this v2 MVP treats every multi-placement instance as inactive/preserved
with a warning; it must not equip it in any socket until a later contract defines sharing.

Unknown instance members and all unknown `properties` members are opaque JSON and must be
deep-preserved verbatim (subject to the resource limits below).  Known code must not infer
semantics from an unknown property.

### 35.3 Placement and socket eligibility

Each `build.jewels.placements` element MUST be an object with exactly these required
known fields:

| Field | Type and rule |
| --- | --- |
| `socketNodeId` | decimal string matching `^(0|[1-9][0-9]{0,255})$`; it is the real numeric passive `skill` ID rendered in base-10, never an official raw ID |
| `instanceId` | instance-ID string matching the grammar above |

Extra placement members are opaque and preserved.  `instanceId` must reference one unique
parsed instance.  A duplicate `(socketNodeId, instanceId)` is warning-deduplicated.  More
than one placement for the same socket, and one instance used in more than one socket, are
structurally legal but warning-only inactive preservation cases in this MVP: no affected
placement enters runtime equipment state.  This prevents a guessed replace/stack rule.

Only these twelve socket IDs are eligible ordinary MVP sockets:

`2491`, `7960`, `21984`, `26196`, `26725`, `32763`, `46882`, `54127`, `55190`, `60735`, `61419`, `61834`.

A catalog/runtime socket descriptor must additionally confirm `category: "ordinary"`, the
same decimal node ID, and its `officialRawId`.  The raw ID is provenance only; it must not
replace `socketNodeId`.  Unknown/disappeared socket IDs are warning-preserved and inactive.
`17788` (Crystalline Phylactery), `11184` (Zarokh's Gift), and every `ascendancy-special`,
`sinister`, or `blighted` descriptor are warning-preserved and inactive.  They are never
coerced into ordinary sockets.  Missing catalog data is a fatal catalog diagnostic: no
jewel placement is applied and the ordinary Save action is unavailable after a failed
transaction.

### 35.4 Catalog definition IDs and radius state

Definition IDs use the namespace `poe2-jewel:` and the grammar in 35.2.  They are
project-owned registry keys, approved in a reviewed catalog change, permanently
non-reusable, and decoupled from display/localized names.  Renaming a jewel changes only
display metadata.  A retired definition remains in the registry with `status: "retired"`
and is never assigned to a different jewel.  Adding, renaming, retiring, or correcting an
ID requires human review; runtime code must never generate one from a name, Chinese text,
or array index.

The fixture registry currently assigns these fixed IDs:

| Fixture display name | Stable definition ID |
| --- | --- |
| Voices | `poe2-jewel:unique-voices` |
| From Nothing | `poe2-jewel:unique-from-nothing` |
| Controlled Metamorphosis | `poe2-jewel:unique-controlled-metamorphosis` |
| The Adorned | `poe2-jewel:unique-the-adorned` |
| Flesh Crucible | `poe2-jewel:unique-flesh-crucible` |
| Against the Darkness | `poe2-jewel:unique-against-the-darkness` |

Catalog radius metadata is `radius: { "status": "unsupported" | "unverified" }` and
MUST NOT contain guessed numeric radius, distance formula, boundary, or multiplier
direction.  v2 persists a jewel even when its definition has an unsupported/unverified
radius, but runtime radius membership, overlays, rule effects, and allocation changes are
all disabled.  The UI must state that radius effects are not supported.

### 35.5 Migration, future versions, preservation, and limits

When opening a v1 document, validate it using the unchanged v1 rules and construct an
in-memory v2 candidate with `jewels: { instances: [], placements: [] }`.  Do not rewrite
the opened file merely because it was migrated.  The next explicit user Save serializes
schema version 2, preserving all v1 allocations, class, ascendancy, budgets, UI, unknown
members, unresolved identifiers, and their preservation sidecar.

Schema versions greater than 2 are fatal `unsupported_schema_version`: do not load,
mutate, or offer ordinary destructive re-save.  This contract does not claim that an old
application can read v2, nor does it define a v2-to-v1 export.  Those behaviors do not
exist.

In addition to the inherited v1 limits (5 MiB total, depth 64, 256-character known
identifiers, and at most 100 retained/displayed detailed diagnostics), v2 sets
`maxJewelInstances = 20000` and `maxJewelPlacements = 20000`.  These match the existing
per-allocation cardinality limit, rather than inventing a second scale.  Instance IDs are
limited to 64 characters; definition IDs, socket IDs, property keys, and unknown known-ID
strings to 256 characters; `properties` depth shares the global 64-depth traversal cap.
Every hard limit is fatal.  The diagnostic reporter retains at most 100 details across v1
and v2 while retaining aggregate totals.

Unknown `definitionId`, unknown instance/placement fields, unknown properties, and unknown
or structurally valid but unappliable socket placements are warnings and preservation-only.
They do not enter runtime state, but an otherwise successful document may be saved and
must round-trip them unchanged.  An explicit user removal of the corresponding instance
removes its unknown definition/properties/instance sidecar and all references; explicit
removal of a placement removes only that placement's opaque data.  Editing unrelated
fields must not discard any such data.

### 35.6 Deterministic serialization and transaction

Serialization is a pure operation and must not mutate caller arrays, objects, or the
preservation sidecar.  It emits instances ordered by Unicode code-unit `id`; placements
by `socketNodeId` numeric value, then `socketNodeId` text, then `instanceId`; and every
properties/opaque object with keys ordered by Unicode code unit recursively. Duplicate
instance IDs are fatal. For duplicate placement pairs, recursively order every object key,
encode each complete candidate as compact JSON, sort those strings in Unicode code-unit
order, retain the first canonical candidate, warn, and serialize once. The same semantic
input in any input order therefore produces identical output without discarding opaque
placement members.

Open/apply is transactional: (1) fully decode and bound JSON, (2) validate the definition
and socket catalogs, (3) validate/preserve jewel records, (4) construct a complete
candidate including unchanged v1 state, (5) atomically commit it, and (6) rebuild derived
state only after commit.  Any fatal validation or catalog failure leaves the current Build
untouched.  A commit failure rolls back the snapshot.  If rollback itself fails, retain the
existing safe policy: flag the session unsafe and prohibit further Save until recovery.

### 35.7 Jewel diagnostic matrix

| Condition | Level | Preserved | Runtime state | Save / later unrelated save |
| --- | --- | --- | --- | --- |
| `jewels` missing in v2 | fatal | no candidate | none | no / unchanged source remains |
| `instances` or `placements` non-array | fatal | no candidate | none | no |
| duplicate instance ID | fatal | no candidate | none | no |
| placement references absent instance | warning | yes | inactive | yes / retained |
| unknown definition ID | warning | yes | inactive | yes / retained |
| unknown/disappeared socket | warning | yes | inactive | yes / retained |
| special socket | warning | yes | inactive | yes / retained |
| instance in multiple sockets | warning | yes | all affected inactive | yes / retained |
| multiple instances in one socket | warning | yes | all affected inactive | yes / retained |
| unknown property/instance/placement member | warning | yes | opaque/inactive for unknown semantics | yes / retained |
| count, ID length, property depth, or 5 MiB limit exceeded | fatal | no candidate | none | no |
| definition/socket catalog missing | fatal | source remains untouched | none | no; unsafe after rollback failure only |
| a catalog entry is malformed | warning for that entry and dependent records | yes | dependent records inactive | yes / retained |

### 35.8 Examples

The empty v2 example is the document in section 35.  A supported ordinary placement is:

```json
"jewels": {
  "instances": [{
    "id": "jwl_0123456789abcdef0123456789abcdef",
    "definitionId": "poe2-jewel:unique-voices",
    "properties": {}
  }],
  "placements": [{ "socketNodeId": "2491", "instanceId": "jwl_0123456789abcdef0123456789abcdef" }]
}
```

This canonical multi-record order is required even if supplied reversed:

```json
"jewels": {
  "instances": [
    { "id": "jwl_a", "definitionId": "poe2-jewel:unique-voices", "properties": { "b": 2, "a": 1 } },
    { "id": "jwl_z", "definitionId": "poe2-jewel:unique-the-adorned", "properties": {} }
  ],
  "placements": [
    { "socketNodeId": "2491", "instanceId": "jwl_z" },
    { "socketNodeId": "61834", "instanceId": "jwl_a" }
  ]
}
```

Unknown definition and socket preservation examples (both warn and remain inactive):

```json
{ "id": "jwl_future", "definitionId": "partner-jewel:future", "properties": { "futureRoll": { "v": 1 } } }
```

```json
{ "socketNodeId": "999999", "instanceId": "jwl_future" }
```

Illegal examples: `{ "jewels": { "instances": {}, "placements": [] } }` is fatal
`invalid_type`; two instances with `id: "jwl_same"` are fatal `duplicate_instance_id`; and
`{ "socketNodeId": 2491, "instanceId": "jwl_a" }` is fatal `invalid_type` because socket
identity must be a decimal string.
