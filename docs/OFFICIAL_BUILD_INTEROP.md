# Official PoE2 `.build` interoperability

Status: accepted direction from P2AT-012  
Research baseline: `09c8292949bda0e2478aefe0513cea9edf7771af`  
Accepted: 2026-09-10

## Official facts

GGG documents the PoE2 Build Planner file as JSON containing one `Build` object and labels the current contract **Version 1 (Experimental)**. The game consumes `*.build` files from its `BuildPlanner` directory and the website supports upload/subscription. Creating or editing builds inside the game is not currently supported.

Primary specification: <https://www.pathofexile.com/developer/docs/game#buildplanner>

The documented root fields are `name`, optional `author`, `link`, `description`, `ascendancy`, `passives`, `skills`, and `inventory_slots`. Passive IDs use `PassiveSkills` table IDs such as `jewel_slot1956`; skill/support IDs use `BaseItemTypes` metadata IDs. The format supports level intervals, weapon-set indexes, inventory-slot hints and documented `additional_text` markup.

The official contract does not define native Planner budgets, UI state, unresolved-data preservation, jewel definitions, jewel instances, opaque instance properties or socket placements. It also does not state whether unknown top-level or nested fields are accepted by the game or website.

No game-client or website upload test was performed by P2AT-012. Unknown fields, BOM behavior, invalid-ID behavior and several parser-tolerance questions remain unverified.

## Accepted architecture: two `.build` profiles

All new user-facing Build files will use the `.build` extension, but extension alone never establishes compatibility.

### Native profile

- Identified by `format: "poe2-agent-tools-build"` and `schemaVersion`.
- Losslessly stores all project state, including schema-v2 jewels.
- Is the editable source of truth.
- Must be described as **PoE2 Agent Tools Build — lossless project file**.
- Must not be advertised as directly game-readable.

### GGG export profile

- Contains only fields documented for the official GGG Build v1 Experimental object.
- Is produced through a separate **Export to Path of Exile 2…** action.
- Never contains private project fields until both game and website compatibility are empirically proven for a pinned version.
- Is a projection, not the editable lossless source of truth.
- Must report mapped, omitted, ambiguous and unsupported state before writing.

Profile detection is content-based. Legacy `.json` native files remain importable for migration but are not the default for new saves.

## ID boundary

Native allocation and jewel placement identity remains the decimal string form of the Planner's numeric skill ID. Official `.build` uses `PassiveSkills.Id` strings. Translation occurs only at the official import/export boundary through a pinned, versioned mapping derived from verified official tree data.

Unmapped or ambiguous IDs must never be guessed or silently dropped. Native state remains unchanged and the export report identifies every affected ID.

## Product decisions

1. Both profiles use `.build`; UI and content detection distinguish them.
2. Native Save and official Export remain separate actions.
3. The export dialog may suggest the detected GGG `BuildPlanner` directory, but writing there always requires an explicit user action.
4. Routine omission of native-only UI/budget metadata is summarized. Loss of jewels, unresolved identifiers, or mapped gameplay state requires explicit confirmation.
5. Official import is not released as a production editing feature until all supported foreign fields can be preserved through native save and re-export without silent loss.
6. If foreign official data requires new native semantics, prefer an explicit future schema-v3 `interop` member over anonymous schema-v2 unknown fields or a separate sidecar file.
7. Strict game-bound output contains only documented GGG fields until empirical compatibility work proves otherwise.

## Migration direction

- Native schema-v1/v2 `.json`: open through the existing native codec and save as a new native `.build`; never auto-overwrite the source.
- Native `.build`: normal lossless open/save.
- Official `.build`: content-detect and parse with the future official codec; preserve the original and produce a distinct native `.build` only through explicit import.
- Official export: write a distinct suggested filename and retain the native source.
- Future or malformed profiles: fail safely or open only through a separately specified preservation path; no destructive rewrite.

## Evidence still required

- Full current numeric skill ID ↔ `PassiveSkills.Id` coverage and collision report.
- Exact handling of unknown fields by the current game and GGG website.
- UTF-8 BOM/final-newline behavior.
- Invalid and missing ID behavior.
- Duplicate passive/weapon-set behavior.
- Drift behavior when GGG changes the experimental format.

Community converters and validators are useful test references but are not normative. Their constraints must be checked against the official specification and pinned before implementation reliance.

