# WeGame PoE2 public-share import research

Status: P2AT-021A research evidence, **REVIEW**

Captured: 2026-09-14, Asia/Shanghai

Scope: one user-supplied public share; no login, cookies, account token, CAPTCHA,
device binding, private endpoint discovery, or enumeration of other shares.

## Result in plain language

The public share is rich enough to recover the observed character's class display name,
level, equipment, gem groups/supports, panel attributes, passive allocation, two distinct
weapon-specialisation sets, quest rewards, attribute-choice overrides, and some jewel
type/radius metadata. It is **not** yet rich or stable enough for a lossless production
import into native schema v2.

The passive portion is exceptionally strong evidence: all 150 allocation records in this
capture map through the P2AT-013 oracle to the canonical-lock-verified official tree. The
remaining blockers are semantic contracts, not passive-ID coverage: WeGame exposes a
display class name rather than a durable class key, does not define how its `set1`/`set2`
correspond to GGG `weapon_set` numbers, does not provide documented BaseItemTypes IDs for
gems, and provides data (`skill_overrides`, quest stats, full equipment and skills) that
native schema v2 cannot persist.

Therefore P2AT-021A does not wire a network importer, UI, or codec. Recommended follow-ups
are P2AT-021B (reviewed import contract/schema decision), P2AT-021C (pure offline adapter),
and P2AT-021D (UI plus real-machine acceptance).

## Acquisition boundary and evidence method

The supplied URL was opened as a normal public page. The browser rendered the WeGame PoE2
helper title without requesting login. The large application timed out in the automation
inspection surface, so no browser profile, saved credential, or developer-tool injection
was used. The page's actually served versioned JavaScript chunks were downloaded, and
their explicit Profile calls were replayed against the same public origin with the same
JSON body shape. This produced real HTTP responses for the supplied share only.

The first request sent `share_code`, `area: 0`, `from_src: "poe2_helper"`, with null role
identity. Its success response supplied the role identity needed by the page's subsequent
calls. Those identifiers existed only in local temporary captures and were removed before
fixture generation. Every subsequent request retained the same share code and role. No
endpoint was guessed: all paths below are literal strings in the served application
chunks. Page and response data were treated as untrusted JSON and never executed.

Source page (token redacted in repository):
`https://www.wegame.com.cn/helper/poe2/#/share/<share-token-redacted>`.
The fixture manifest contains the share-token SHA-256 so this evidence can be correlated
without publishing a reusable token. The original URL remains in the controller dispatch,
not in committed fixtures.

## Request and response inventory

All calls used `POST https://www.wegame.com.cn/api/v1/wegame.pallas.poe2.Profile/<method>`,
`Content-Type: application/json`, and a same-origin Referer. No Cookie or Authorization
header was sent. All 13 calls returned HTTP 200 and `application/json; charset=utf-8`.
The API responses had no `Cache-Control`, `ETag`, or `Last-Modified` header. CORS allowed
the WeGame origin and credentials in general, but this capture did not send credentials.
Transient trace IDs are intentionally not retained.

| Method | Bytes | Top-level payload | Build relevance |
| --- | ---: | --- | --- |
| `GetRoleInfo` | 541 | `result`, `role`, `share_code`, nickname | class, level, league/times plus sensitive identity |
| `GetRoleProfile` | 291 | talent totals, two highlighted skills | summary only |
| `GetRolePlaySummary` | 166 | level/boss progress | progression only |
| `GetSeasonCurrencySummary` | 174 | currency totals | not Build state |
| `GetRoleKeyData` | 698 | compact attributes and two skills | derived summary |
| `GetDimensionEvaluation` | 114 | five ratings | derived summary |
| `GetRoleSummary` | 107 | title/content/date | generated summary |
| `GetEquipments` | 43,777 | 15 equipment records | full item text, slots, requirements, socketed items |
| `GetPanelAttr` | 518 | 20 panel values | derived character stats |
| `GetSkills` | 102,849 | 13 skill groups | active gems, supports, sockets, requirements and text |
| `GetSkillsDps` | 369 | 8 stable-looking skill slugs and DPS | derived damage summary |
| `GetTalentTree` | 11,145 | talent tree object | allocations, sets, overrides, quests, jewel metadata |
| `GetJewels` | 70 | `jewel_data` | success with empty-string data in this capture |

Exact schema fingerprints, point-in-time raw response sizes, endpoint names and header facts
are recorded in `apps/planner-desktop/fixtures/wegame-share/manifest.json`. Every fingerprint
is independently reproducible from the committed value-free `schema-paths.json`; the five
non-Build raw bodies are deliberately not retained, so their recorded byte sizes are capture
metadata rather than byte-replayable evidence. A fingerprint is SHA-256 of sorted
newline-delimited JSON paths and types; array paths use `[]`. It detects shape drift, not
semantic compatibility.

The application code also contains other role/progress APIs. They were not called merely
because they exist: this task limited replay to the calls mounted by the supplied public
share page and did not enumerate bosses, roles, ranking entries, or other shares.

### Error protocol

Each success body contained `result.error_code: 0` and `result.error_message`. Consumers
must check both transport status and this application envelope. HTTP 200 alone is not
success. Invalid/revoked/expired-token behavior was not probed because that would require
inventing another token; its concrete error codes and HTTP mapping remain unverified.

## Observed Build contract

### Role and chronology

- level: 94;
- class display name: `Gemling Legionnaire`;
- numeric `class_id`: 0, which is not useful as a durable class/ascendancy key;
- area: 0 and a large league identifier were present;
- creation/login/play-duration fields existed but were removed as potentially identifying;
- no explicit game patch, data revision, schema version, expiry, or revocation time existed.

The nine allocated ascendancy nodes all carry official `ascendancyId: "Mercenary3"`, which
is independent evidence for the internal ascendancy family. Converting the role display
name to native `base: "Mercenary"` and `ascendancyId: "Mercenary3"` remains a reviewed
transform, not a direct field copy.

### Passive tree and weapon sets

`talent_tree.hashes` contains 102 unique numeric IDs. Under locked official data they are:

- 86 normal non-socket nodes;
- 9 ascendancy nodes, all `Mercenary3`;
- 7 accepted ordinary jewel sockets;
- 0 special sockets;
- 102 mapped, 0 missing, 0 ambiguous.

`talent_tree.specialisations` has exactly `set1` and `set2`, each containing 24 unique
normal nodes. Both sets map 24/24 with no missing or ambiguous ID. The sets do not overlap
each other or `hashes`. No `set3` field or evidence exists. The response labels prove two
distinct source-labelled sets but do not prove their correspondence to either Native
weapon-set numbering or GGG `weapon_set: 0`, `1`, or `2`; an adapter must preserve the
source labels and must not guess either target numbering scheme.

The fixture's `passive-id-coverage.json` lists every numeric ID, its mapped
`PassiveSkills.Id`, and classification. It was generated only after the 5,140,821-byte
official tree matched lock SHA-256
`b52be9c4f17e4114064255ef1b8c58292e9db0e395d95af235a8d3fef0d44642`.

### Attribute-choice overrides and quest stats

`skill_overrides` contains 53 entries. Every key is also present in `hashes`; every entry
contains a stable-looking generic attribute choice ID, display name/icon, one rendered stat,
and one granted Strength/Dexterity/Intelligence value. These values change the meaning of
allocated generic attribute nodes. Dropping them would silently change the Build.

Native schema v2 unknown-field preservation is not an accepted semantic home for active
gameplay state. A future schema v3 (or a separately versioned, inert-to-active extension)
should persist overrides keyed by numeric node ID, retain the upstream choice ID and exact
granted values, reject duplicate keys/type conflicts, and preserve unknown future members.
It must validate that an override key is allocated while still preserving orphaned entries
with a warning. P2AT-021A proposes this shape only; it does not modify accepted schema v2.

`quest_stats` contains 13 localized rendered strings (life, mana, spirit, charm, resistance,
defence and boss-derived entries). There are no stable quest-choice IDs. These can be
preserved as source evidence but cannot safely become executable native state from strings.

### Jewels

Seven ordinary jewel sockets are allocated. `talent_tree.jewel_data` contains seven entries
keyed by small integers (`0`, `11`, `12`, `13`, `15`, `16`, `18`) with type values such as
`JewelStr` and `JewelDiamond`; one entry also has `radius: 1200`. Those keys are not passive
node IDs and no response field proves how they correspond to the seven allocated sockets.

The dedicated `GetJewels` call succeeded but returned an empty string. The share page code
would parse and render non-empty `jewel_data`, but this capture cannot establish the schema
or reconcile it with `talent_tree.jewel_data`. It is unsafe to infer either “no jewels
equipped” or a socket placement. Native v2 jewel instances/placements are unresolved.

### Equipment, skills and attributes

The 15 equipment records preserve inventory IDs/coordinates, item names/base types,
rarity/frame, item level, requirements, properties, implicit/explicit/rune text, sockets,
and socketed item records. Opaque 64-hex instance IDs were pseudonymized consistently.

The 13 skill groups preserve gem text, properties, requirements, sockets and support gems.
The payload does not expose documented `BaseItemTypes.Id` values required by GGG Build v1;
display names, `gemSkill`, item type lines and DPS slugs must not be guessed into those IDs.
Panel attributes and DPS are derived snapshots and may drift from source state or game
calculation changes.

## Field mapping matrix

Status meanings: **direct** is shape-compatible identity; **transform** is deterministic
only with a reviewed lookup; **unresolved** lacks evidence; **unsupported** has no target
field; **semantic-loss** would change or discard gameplay meaning.

| WeGame source | Native schema v2 | Status | GGG v1 Experimental | Status |
| --- | --- | --- | --- | --- |
| role class display name + ascendancy-node metadata | `build.class.base`, `ascendancyId` | transform | `ascendancy` | transform |
| role level | none | unsupported | possible `level_interval` usage | unresolved |
| `hashes` normal IDs | `allocations.normal` | direct after classification | `passives[].id` | transform via P2AT-013 |
| `hashes` ascendancy IDs | `allocations.ascendancy` | direct after classification | `passives[].id` | transform via P2AT-013 |
| allocated ordinary socket IDs | `allocations.normal` plus possible jewel placement | direct allocation; placement unresolved | `passives[].id` | transform via P2AT-013 |
| `specialisations.set1` | candidate `allocations.weaponSet1` | unresolved numbering; preserve source label | `passives[].weapon_set` | unresolved numbering |
| `specialisations.set2` | candidate `allocations.weaponSet2` | unresolved numbering; preserve source label | `passives[].weapon_set` | unresolved numbering |
| absent set3 | no native field | direct absence | possible third documented number | unresolved |
| `skill_overrides` | no semantic v2 field | semantic-loss unless future contract | no field | semantic-loss |
| `quest_stats` rendered strings | no field | unresolved/unsupported | no field | unsupported |
| talent `jewel_data` | jewel instances/placements | unresolved | no field | unsupported |
| empty dedicated jewel response | cannot prove empty placements | unresolved | no field | unsupported |
| equipment array | no v2 equipment contract | unsupported | `inventory_slots` hints only | semantic-loss for full item |
| skills/supports | no v2 skill contract | unsupported | `skills`/`support_skills` | unresolved stable IDs |
| panel attributes/DPS | no semantic fields | unsupported derived data | no fields | unsupported derived data |
| league/timestamps/summary | no fields | unsupported metadata | description/link only | semantic-loss if embedded as prose |

Budgets, native UI state, instilled-passive identities and an explicit passive-tree revision
are absent. Defaults cannot be presented as source facts. In particular, nine ascendancy
IDs in `hashes` must not be silently truncated to schema v2's current eight-point budget;
the adapter must preserve and warn until the source semantics are understood.

## Proposed offline import pipeline (not implemented)

1. Accept a bounded local sanitized/raw response bundle, never executable page content.
2. Validate byte limit, JSON depth, array limits, envelope status and schema fingerprint.
3. Preserve unknown fields inertly before interpreting known fields.
4. Resolve class/ascendancy through a reviewed alias table and node evidence; never use
   display-name guessing as the only authority.
5. Verify the official tree against the canonical lock, map every numeric passive ID, and
   stop activation on ambiguity while preserving missing IDs.
6. Keep `hashes`, source `set1`, and source `set2` separate. Do not assign Native or GGG
   weapon-set numbers until empirical evidence establishes them.
7. Preserve `skill_overrides`, quest strings, equipment, skills and jewel evidence in a
   future reviewed contract before calling an import lossless.
8. Produce one bounded diagnostic summary and construct a complete candidate before any
   live Planner mutation.

## Failure and degradation policy

| Condition | Required behavior |
| --- | --- |
| page/API unreachable, timeout, DNS/TLS failure | no mutation; report transport failure and allow local fixture import |
| login, Cookie/Token/device binding, CAPTCHA or safety barrier appears | stop; do not automate or bypass |
| non-2xx HTTP | no mutation; retain bounded status/content-type/size diagnostic, not body secrets |
| HTTP 200 with nonzero/missing `result.error_code` | application failure; no mutation |
| non-JSON or wrong content-type | reject before parsing as a Build |
| schema fingerprint drift | parse only under bounded generic JSON limits; preserve unknowns; require review before activation |
| one response missing | build a report, but do not claim lossless import; passive-only preview may be offered explicitly later |
| unknown/missing/ambiguous passive ID | preserve and report; do not guess or silently drop |
| duplicate ID within one set | deduplicate only in a candidate with an explicit warning and source count |
| same ID across `hashes` and a weapon set | preserve categories and flag semantic conflict; no precedence guess |
| illegal type, unsafe integer, negative ID | reject that semantic field while preserving inert evidence |
| unknown future field | preserve inertly within size/depth limits; never execute or activate automatically |
| oversized body/array/string/depth | abort before materializing unbounded diagnostics; apply native U3 limits or stricter endpoint limits |
| inconsistent skill override | preserve, warn, and leave node choice inactive |
| jewel metadata without proven placement | preserve opaque evidence; create no v2 placement |

## Replay, token, stability and regional limits

The URL fragment contains a high-entropy opaque value that functions as the unique share
token. The HTML shell and static chunks can be cached, but the live Build cannot be replayed
offline from the link alone: Profile responses require online POST requests. The committed
fixture and reporter are offline-replayable research artifacts, not a live-link cache.

No expiry or revocation metadata was returned. The token may be revoked server-side, expire,
or change meaning; persistence risk is therefore **UNVERIFIED**. Anyone holding the token may
be able to retrieve the shared character while it remains valid, so logs and diagnostics
should redact it.

This access succeeded from the task's Asia/Shanghai environment using the WeGame and Tencent
static hosts. That is one point-in-time China-network observation, not a service-level or
long-term accessibility claim. DNS, CDN, regional routing, TLS policy, rate limits and the
undocumented Profile service may change independently.

## Evidence files and reproducibility

- `fixtures/wegame-share/public-share.sanitized.json`: Build-bearing responses only;
- `fixtures/wegame-share/manifest.json`: all 13 request/response facts and fingerprints;
- `fixtures/wegame-share/schema-paths.json`: value-free paths that reproduce all fingerprints;
- `fixtures/wegame-share/passive-id-coverage.json`: every mapped allocation record;
- `tools/sanitize-wegame-share-capture.cjs`: offline-only deterministic redaction;
- `tools/report-wegame-share-coverage.cjs`: lock-verifying P2AT-013 coverage report;
- `test/wegame-share-fixture.test.cjs`: privacy, shape, counts and optional locked-tree replay.

The sanitizer and reporter perform no network access. Redistribution remains UNVERIFIED.

## Recommendation

Do not call WeGame import “complete” or expose it in production. P2AT-021B should decide a
future semantic extension for equipment, skills, quest evidence and especially
`skill_overrides`; P2AT-021C should then implement a pure bounded offline adapter; P2AT-021D
should add explicit network/UI consent and real-machine acceptance only after endpoint terms,
regional reliability and revocation/error behavior are reviewed.
