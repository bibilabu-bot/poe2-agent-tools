# Upstream data governance and canonical source lock

Status: Accepted

Policy date: 2026-09-09

Research access date: 2026-09-09

Canonical lock: `data/upstream-sources.lock.json`

## Purpose and scope

This document integrates the P2AT-005 upstream-data research into repository policy. It covers data used by the desktop Planner at runtime and the sources declared by the jewel compiler. It does not grant rights over upstream content, alter the current download paths, or authorize redistribution.

Statements that a license was not found are point-in-time research findings as of the access date, not permanent legal conclusions. A later license audit may replace them with verified terms.

## Accepted policy

### Identity model

Every governed dataset uses three separate identity layers:

1. **Upstream revision** — a complete 40-character Git commit SHA for GitHub content. A branch such as `main` or `dev` may be used for discovery, but never as the canonical identity.
2. **File integrity** — a SHA-256 and byte count for every pinnable file. Files from the same repository may share a revision but never share an assumed content hash.
3. **Dataset snapshot** — the lock's `snapshotId` identifies the approved set as a whole. Non-Git sources also carry their own timestamped snapshot identity.

The canonical, machine-readable record is `data/upstream-sources.lock.json`. Existing runtime and compiler manifests remain descriptions of current behavior until a later implementation task migrates their consumers to the lock.

### Source status

- `active`: required by current runtime or current compiler truth-source flow.
- `optional`: useful evidence for current compiler behavior but not required for every build.
- `future-reference`: declared for future capabilities and excluded from the current required input set.

Status is independent of license status. An `active` source can still be download-only or blocked from bundling.

### Acquisition and promotion

The near-term product model is first-time online initialization followed by offline use of verified cached bytes. Candidate revisions may be discovered and validated automatically, but promotion into the canonical lock requires explicit human approval. Promotion must record a new dataset `snapshotId`, immutable revisions or snapshot timestamps, per-file SHA-256 values and byte counts, and reviewed license metadata.

Large upstream resources with unclear redistribution terms must not be committed to Git or included in a formal installer. The lock contains metadata only.

## Current runtime inventory

The desktop main process currently declares eight core downloads and a constrained class-portrait pattern. The lock expands the portrait pattern into the eight filenames currently requested by the renderer so every pinnable resource has its own hash.

| Upstream | Locked revision | Files | Current role | Distribution policy |
| --- | --- | ---: | --- | --- |
| [drydream/poe2drydream](https://github.com/drydream/poe2drydream) | `073838ccf0585131788e714721d6d2d95aa44b77` | 12 | Tree metadata, atlases, jump metadata and eight class portraits | Short-term active source; do not bundle until license is confirmed |
| [grindinggear/poe2-skilltree-export](https://github.com/grindinggear/poe2-skilltree-export) | `bd87e6512c92b868542eddfb1ba4ea8b6dc2da36` | 3 | Official tree export and mastery resources | Download/cache only pending a data-license determination |
| [addohm/PathOfBuilding-PoE2](https://github.com/addohm/PathOfBuilding-PoE2) | `134157435172f41df00c8a5f1365a5c11bc923fc` | 1 | Simplified Chinese translation table | Fixed download; must not ship in the installer at this stage |

The GGG `data.json` entry is shared by the Planner runtime and jewel compiler, and is represented once with both consumers in the lock.

### drydream replacement audit

`drydream/poe2drydream` remains the accepted short-term source because it matches the current Planner's prepared tree and artwork contract. Its repository license was not found during the 2026-09-09 investigation. This source therefore remains download/cache-only and requires a separate replacement/provenance audit before packaging.

### Chinese translation boundary

The fork's project license does not by itself establish redistribution rights for extracted game strings. `ChineseTranslation.lua` is pinned for retrieval consistency, but the accepted policy is download-only and not installer redistribution.

## Jewel compiler inventory

The current compiler manifest declares eleven sources:

- Active: official GGG tree data, PoB2 `ModJewel.lua`, PoB2 `Misc.lua`, and the reviewed PoE2DB jewel-page snapshot.
- Optional: PoB2 `CalcSetup.lua` and `ModParser.lua`.
- Future reference: PoB2 `Rares.lua`, passive-tree export logic, timeless node mapping, timeless trade IDs, and cluster-jewel data.

All GitHub files are locked to:

- GGG export: `bd87e6512c92b868542eddfb1ba4ea8b6dc2da36`
- [PathOfBuildingCommunity/PathOfBuilding-PoE2](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2): `fd4c1acb7f9f5ffd13372f5387ae16f8e6278c15`

The PoB2 repository is MIT-licensed, but several generated data files explicitly retain Grinding Gear Games copyright notices. Code license and game-data rights are therefore tracked separately; those files remain subject to review before redistribution.

## PoE2DB snapshot policy

[PoE2DB Jewels](https://poe2db.tw/us/Jewels) is an auxiliary catalog cross-check, not the primary authority. It has no invented Git revision. The lock records:

- snapshot ID `poe2db-jewels-2026-09-09t02-09-52z`;
- access time `2026-09-09T02:09:52.176Z`;
- response size `266744` bytes;
- SHA-256 `fa6a61f7213b411ddfbcbdf078507bacca359153b499ea1f159b6d09eab4cbda`;
- required manual-review status.

PoE2DB-derived facts may be promoted only after comparison with the primary sources and human review. No clear dataset redistribution license was confirmed during the 2026-09-09 investigation, so the captured page is not committed or approved for installer inclusion.

## License and attribution findings

| Source family | Finding as of 2026-09-09 | Current control |
| --- | --- | --- |
| GGG skill-tree export | No explicit repository data license confirmed | Metadata lock; download/cache only; do not bundle |
| drydream prepared data/art | Repository license not found | Short-term pin; replacement audit; do not bundle |
| PoB2 | MIT project code; generated game data carries separate GGG notices | Review each file's data rights before redistribution |
| addohm Chinese translation | Fork license does not settle extracted-string rights | Fixed download only; do not distribute with installer |
| PoE2DB | No clear dataset redistribution license confirmed | Snapshot/manual-review auxiliary source only |

These controls supplement, and do not replace, upstream attribution notices or a future legal review.

## Research sources and access record

The following evidence links from the research artifact were checked on 2026-09-09:

- Grinding Gear Games: [skill-tree export repository](https://github.com/grindinggear/poe2-skilltree-export), [Path of Exile developer documentation](https://www.pathofexile.com/developer/docs), and the official Legal/Terms of Use pages linked from the Path of Exile site.
- drydream: [poe2drydream repository](https://github.com/drydream/poe2drydream), whose README identifies the prepared tree, atlases, jump metadata and portrait assets used by the Planner.
- Path of Building Community: [PathOfBuilding-PoE2 repository](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2) and its [LICENSE.md](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/blob/dev/LICENSE.md). Generated data-file notices were inspected separately from the project-code license.
- Chinese translation fork: [cn-item-paste-upstream branch](https://github.com/addohm/PathOfBuilding-PoE2/tree/cn-item-paste-upstream), [ChineseTranslation.lua](https://github.com/addohm/PathOfBuilding-PoE2/blob/cn-item-paste-upstream/src/Data/ChineseTranslation.lua), and [cn-translate README](https://github.com/addohm/PathOfBuilding-PoE2/blob/cn-item-paste-upstream/tools/cn-translate/README.md).
- PoE2DB: [Jewel catalog](https://poe2db.tw/us/Jewels) and the general disclaimer reached through that site's footer. The disclaimer was not treated as conclusive coverage for every machine-extracted catalog field.
- jsDelivr: [GitHub CDN documentation](https://www.jsdelivr.com/?docs=gh), used to distinguish an origin revision from a transport URL. Full commits plus application-level SHA-256 remain mandatory.

## Canonical lock coverage

The lock contains 26 distinct files:

- 19 `active`;
- 2 `optional`;
- 5 `future-reference`.

It covers all eight core runtime manifest entries, all eight class portraits addressable by the current renderer, and all eleven jewel compiler manifest entries. The shared GGG `data.json` is counted once.

Every GitHub entry contains repository, path, full commit SHA, immutable raw transport URL, SHA-256, byte count, purpose, acquisition phase and license state. The PoE2DB entry contains equivalent integrity metadata plus its access timestamp and review state.

## Offline validation and local reproduction

The lock validator performs no network requests:

```bash
node --check tools/validate-upstream-lock.mjs
node --test tools/validate-upstream-lock.test.mjs
node tools/validate-upstream-lock.mjs
```

It rejects invalid schema versions, duplicate IDs, unknown source statuses, abbreviated or moving GitHub revisions, malformed SHA-256 values, invalid byte counts, missing required fields, and non-Git sources that lack timestamped snapshot metadata.

For the accepted snapshot, branch heads were first resolved to full upstream commits through GitHub repository metadata. Each immutable raw file response was then streamed through SHA-256 while counting bytes; no upstream dataset was added to the repository. The PoE2DB response was hashed as a timestamped snapshot. Future refreshes must repeat this procedure against a candidate lock and wait for human promotion.

## Deferred implementation

This task establishes policy and identity only. The following remain separate work:

- changing `electron/main.cjs` or the runtime cache manifest to consume the lock;
- changing the jewel downloader/compiler to consume the lock;
- implementing candidate discovery, download verification, cache migration or fallback;
- resolving the drydream replacement audit and all open license questions;
- deciding installer contents after license review.

Until those tasks are accepted, current runtime and compiler behavior still follows their existing manifests and moving URLs.
