# WeGame passive import contract

Status: P2AT-021B implementation contract, version 1, **REVIEW**

This contract covers previewing passive allocations from one public WeGame PoE2 share URL. It is not a native Build schema revision and does not publish schema v3.

## Public boundary

The renderer-facing API is `desktopAPI.importWeGamePassives(url)`. It invokes only `wegame:import-passives`; preload exposes no general network primitive. The promise resolves to `{ ok: true, value }` or `{ ok: false, error: { code, message, status } }` and does not mutate Planner state.

The URL must use HTTPS, host `www.wegame.com.cn`, no userinfo, no explicit port or query, exact path `/helper/poe2/`, and fragment `#/share/<token>`. Tokens contain 8–256 ASCII letters, digits, `_` or `-`. The main process makes exactly two sequential POST requests: `GetRoleInfo`, then `GetTalentTree` using the returned role identity. Requests omit cookies, credentials, authorization and device identifiers. Equipment, skills, jewels, DPS, panels and summaries are not requested.

Responses use an 8-second per-request timeout and 512 KiB limit, require HTTP success and JSON content type, reject all redirects, decode strict UTF-8, and validate the WeGame business envelope. Only one import may run concurrently.

## Version-1 value

`value.format` is `poe2-agent-tools-wegame-passive-import` and `value.version` is `1`.

- `candidate.active.normal`, `ascendancy`, and `ordinarySockets` contain locked-tree-validated `{ numericId, officialId, classification, active: true }` records. Every numeric ID passes the P2AT-013 mapper.
- `candidate.class` preserves the display name and may derive a single `ascendancyId` from allocated locked-tree nodes, but `base` remains null and status requires confirmation. UI wiring must ask the user to confirm class/ascendancy before application; missing or conflicting evidence is never guessed.
- `candidate.inactive.sourceSpecialisations` preserves each upstream label (including `set1`/`set2`), mapped passives, `targetWeaponSet: null`, and `requiresDecision: true`. These are not active native weapon sets.
- `candidate.inactive.skillOverrides` preserves every bounded override value and marks it inactive. A prominent `SKILL_OVERRIDES_SEMANTIC_LOSS` warning reports the count because schema v2 cannot apply these choices.
- `candidate.inactive.jewelData` preserves talent-tree jewel metadata. It creates no jewel instance or placement; only an allocated socket node is active.
- `candidate.unresolved` preserves invalid or unknown allocation evidence. Unknown, malformed and duplicate identifiers produce bounded diagnostics rather than guessed allocations.
- `rawPreservation` summarizes observed role/talent fields and explicitly reports that equipment and skills were not fetched.

Candidate construction is complete before any later UI application. The P2AT-021C UI task must confirm class/ascendancy, visibly disclose inactive source specialisations and skill overrides, and apply active arrays transactionally or leave Planner unchanged.

## Stable error codes

`WEGAME_INVALID_URL`, `WEGAME_REDIRECT_REJECTED`, `WEGAME_TIMEOUT`, `WEGAME_NETWORK_ERROR`, `WEGAME_HTTP_ERROR`, `WEGAME_CONTENT_TYPE_ERROR`, `WEGAME_RESPONSE_TOO_LARGE`, `WEGAME_INVALID_JSON`, `WEGAME_BUSINESS_ERROR`, `WEGAME_SCHEMA_ERROR`, `WEGAME_TREE_ERROR`, `WEGAME_BUSY`, and `WEGAME_INTERNAL_ERROR`.

Diagnostics are limited to 100 details while retaining total/truncated counts. Input traversal is limited to depth 32, 20,000 array entries/object keys, and 4,096 characters per string. The adapter does not mutate caller input.

## ADR recommendation

Adopt this versioned import candidate as a separate inert interoperability boundary. Do not place active WeGame-only semantics in anonymous schema-v2 preservation fields. A future schema-v3 decision should be made only after `skill_overrides` and source weapon-set semantics have reliable evidence and native behavior.
