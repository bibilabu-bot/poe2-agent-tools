# WeGame public-share fixture

This directory contains one minimal, offline, sanitized capture derived from the single
public share URL supplied for P2AT-021A:

`https://www.wegame.com.cn/helper/poe2/#/share/<share-token-redacted>`

Access date: 2026-09-14 (Asia/Shanghai). Redistribution permission for the response data
is **UNVERIFIED**. The fixture is evidence for research and tests, not a claim that the
endpoint is stable, documented, supported, or safe to redistribute in a release.

## Sanitization

- The unique share token is omitted; its SHA-256 is recorded in `manifest.json` only to
  identify this one capture without making the token reusable.
- `openid`, `role_id`, character name, account display name, nickname, login/creation
  timestamps, and play-duration values are removed.
- Opaque 64-hex equipment/gem instance identifiers are replaced consistently with
  `opaque-item-NNN` labels. Stable passive numeric IDs and passive raw IDs are retained
  because they are necessary to reproduce the mapping result.
- Cookies, tokens, device IDs, account headers, trace IDs, IP data, and request headers
  not needed for the contract are not stored.
- No other share was fetched. No login, user cookie, CAPTCHA, device binding, or guessed
  private endpoint was used.

`public-share.sanitized.json` retains the role class/level, equipment, panel attributes,
skills/supports, talent tree, weapon sets, quest stats, skill overrides, and the empty
dedicated jewel response. `passive-id-coverage.json` is derived from the fixture with the
P2AT-013 mapper and the canonical-lock-verified official passive tree. `schema-paths.json`
contains value-free path/type summaries for all thirteen responses so every manifest
fingerprint can be recomputed without retaining the five non-Build response bodies.

The offline sanitizer accepts only an already captured local directory; it performs no
network access. The reporter performs no network access and rejects an official tree that
does not match `data/upstream-sources.lock.json`.
