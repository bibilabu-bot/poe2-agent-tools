# P2AT-025A — Product integration handoff

Date: 2026-09-19. Status: ACCEPTED by controller at integration code commit `9b08b1036eae49704e2736be708a2f8f1692f739`.

## Included histories

- P2AT-021C `f288c1c39b024cc00918bfe359dd91bf4b78b400`: WeGame preview, transactional passive import, explicit omissions and experimental owner-confirmed weapon-set mapping.
- P2AT-023A `4006c749a250b72b8c688cf29099760c25b10bb9`: transitional compact toolbar and collapsible panels; visually usable, not final design.
- P2AT-022A `1f4cf3aa419e9f89fdeaa2ca8e21bb9ead77b3ad`: localization research and reproducible coverage tooling.
- P2AT-022B `dc535450c417e945ae847517a36be77c2bcc30f8`: governed whole-line translations, no partial term replacement.
- P2AT-024A `f112fc6d6b8144df480c15a04c48dfcf6becbbe5`: separate general agent page, reusable core, provider adapter and user-approved OS-encrypted credential storage.

All were merged preserving original histories. Toolbar conflicts retain compact Planner actions and add the Agent switch. Both the WeGame dialog and Agent page survive. Syntax-check lists are combined. The controller accepted these five tasks with the integration corrections; the compact layout is accepted as a usable transition, not a final visual design. Two independent final reviews closed the translation and navigation HIGH findings.

## Integration correction

Numeric IDs alone cannot identify a localized name across runtime and official tree versions. Name records now retain their canonical English name. A shared resolver compares that name with the actual runtime name before accepting the overlay; otherwise it translates the actual runtime name through PoB or displays complete English. Production and coverage reporting share this resolver. Regression tests cover observed conflicting IDs 3091, 24060, 18793 and 33639, including an empty WeGame source.

## Verification

- Desktop tests: 152/152, zero skips, using the locally cached lock-validated official tree through `P2AT_OFFICIAL_TREE`.
- Desktop syntax checks: passed.
- Canonical lock tests: 7/7; formal validation passed.
- Jewel fixture: all six outputs verified in a temporary copy.
- Offline real-Electron DOM smoke: layout mounts, Agent navigation remains connected and visible, Agent/Planner page round trip works, and WeGame controls remain present. `tools/integration-ui-smoke.cjs` uses a new empty profile, no application preload and blocks HTTP; it never loads credentials or sends model requests.
- No real model requests, credentials read, tree-data upgrades or upstream datasets committed during integration.
- Controller native Windows acceptance: tree loaded with 8/8 cached resources; Agent navigation was visible and clickable, tree → Agent → tree succeeded and restored zoom 0.024; Build/search panels expanded and collapsed. No model chat request or credential inspection was performed. Existing branch screenshots remain historical task evidence rather than new integrated captures.

## Exclusions and current limits

- P2AT-008E jewel codec is excluded because its acceptance blockers remain open. Native runtime persistence remains schema v1 despite the accepted future v2 contract.
- P2AT-020A particle experiment is not production integration; P2AT-020B has no accepted delivery to merge.
- WeGame import remains partial: property overrides, jewel contents, equipment and skills are not activated or saved. Missing runtime nodes are reported before application.
- Chinese translation still falls back to complete English when identity or semantic evidence is insufficient. The canonical game-data lock is unchanged.

## Agent collaboration entry points

Read `AGENTS.md`, project status/tasks, and `docs/AGENT_FRAMEWORK.md` first.

- `apps/planner-desktop/src/agent-core/`: agent/tool abstractions, explicit tool registry, bounded loop and calculator.
- `apps/planner-desktop/electron/openai-compatible-provider.cjs`: Chat Completions and Responses JSON; Chat Completions SSE only, not Responses SSE.
- `apps/planner-desktop/electron/agent-service.cjs`: controlled session and IPC ownership.
- `apps/planner-desktop/electron/agent-credential-store.cjs`: user-approved safeStorage persistence with no plaintext fallback. Never inspect or commit real credentials.
- `apps/planner-desktop/renderer/agent-panel.js` and `agent-panel.css`: independent Agent page.

The calculator is the only enabled tool. Planner state is not exposed to the agent. Subsequent agent customization must be scoped collaboratively with the owner; this integration does not authorize new tools or access to game state.

## Start

With Electron dependencies installed, run `npm start` in `apps/planner-desktop`. An existing local Electron binary can alternatively launch this checkout by passing its absolute `apps/planner-desktop` path. Credentials and game caches remain external to Git.
