# P2AT-028B live tree bridge follow-up — 2026-09-22

Branch: `task/P2AT-028B-readonly-tree-codex`. Delivery remains REVIEW; no acceptance or main merge claimed.

## Root cause and correction

The real renderer projected 4,759 nodes, including duplicate numeric ID 11184. The official hidden-node sidecar matched nodes by display name, then appended official nodes even when the slim tree already contained the same numeric ID. Graph construction rejected the duplicate. AgentService swallowed the exception, cleared the Python snapshot, and sent only the three memory tools to the model.

The sidecar now replaces an existing numeric-ID entry with complete official metadata, including node kind, socket flag and transformed position; it rebuilds spatial indexing. Blighted/sidecar nodes are excluded from coordinate-fit anchors so repeated loads remain stable. The resulting projection contains 4,742 unique nodes. Snapshot conversion failures now stop before model submission with TREE_SNAPSHOT_FAILED rather than silently dropping BD tools. The provider also preserves baseClassName.

## Evidence

- `npm run check`: passed.
- `npm test`: Node 217 passed, zero failed, one optional official-tree fixture test skipped; Python 89 passed.
- Re-ran the optional fixture suite with P2AT_OFFICIAL_TREE pointing at the verified app cache: 7 passed, zero skipped.
- New `npm run test:tree-bridge` command exercises a hidden real renderer, preload IPC, Electron snapshot provider, Python subprocess and local HTTP endpoint. It asserts outbound tool registration, build result, numeric-ID uniqueness, repeated sidecar load stability and Zarokh's identity/type/official position.
- Independent read-only review: APPROVE; reviewer also ran 33 targeted Node tests and the bridge successfully.
- Opt-in live run through saved remote credentials, model kimi-k3: final three-turn sequence passed. “你能看到我的bd吗” called build_summary; “查看当前天赋树快照的概要信息” called tree_summary; node 54814 path query called find_tree_path and returned 7960→48552→31238→1433→15782→53675→59498→54814, edge distance 7 and 7 new nodes. Test fixture ascendancy usage was 8/8.
- Earlier exploratory remote repetition produced an ungrounded answer with no tool call. This is retained as a limitation: tool availability does not guarantee every stochastic model response follows instructions. The final live sequence used an explicitly reset isolated session and passed; no deterministic model-behavior guarantee is claimed.

## Reproduction and isolation

Run the bridge from apps/planner-desktop with Electron. It uses the existing game-data cache (override P2AT_GAME_CACHE) and a temporary conversation database. P2AT_BRIDGE_LIVE=1 explicitly enables paid remote testing through the existing encrypted connection; P2AT_BRIDGE_MODEL overrides kimi-k3. Browser storage uses a separate in-memory partition. P2AT_BRIDGE_REPORT can give concurrent runs distinct report paths. Credentials are never written to reports. Local test reports and databases are not committed.

The live evidence uses the committed sanitized WeGame fixture, not the owner's unsaved build. With owner confirmation that their build was saved, the old Planner window was closed normally and the repaired worktree app restarted; the new window was confirmed responsive. Read-only tools remain read-only. No snapshot schema or public data-contract changes.
