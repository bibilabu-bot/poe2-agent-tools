# P2AT-031B — Prompt workflow navigation (REVIEW)

UI-only changes add five collapsible groups: System, general node lookup, current
Build inspection, Build modification and conversation memory. Classification is by
primary use, not a claim that node tools cannot return Build-dependent information.
Each tool's short purpose and detailed prompt remain on one page; its before hook
is indented and has a child navigation link that focuses the actual editable block.
Future unrecognized primary tool pages fall back to Other tools.

Search is case-insensitive, whitespace-separated AND matching over the page name,
tool/block IDs, group name and current draft text. References in prompt bodies may
match several pages. Search opens matching groups; clearing restores previous
expansion. No-match searches preserve the right-hand page and drafts. Escape clears
a nonempty search first; otherwise the existing dirty-close confirmation applies.
Navigation never rebuilds fields. Saving still submits all fields, including hidden
ones, to the existing API without trimming or rewriting any prompt text.

Only renderer HTML/CSS/editor logic and the synthetic UI checker changed. No Python
or Electron runtime, prompt defaults, custom override format, v6 migration, tool
schema, permissions or model-message assembly changed in this task.

## Evidence (2026-09-23)

- Complete `npm test`: Node 226/226 (zero skips), Python 106/106, including prompt
  default hashes, custom migration and actual model-request prompt equality.
- `npm run check`, explicit editor/checker syntax and `git diff --check` passed.
- Real synthetic Electron `tools/check-prompt-inspector.cjs` passed: all 34 block
  values / 15 pages, five groups, ID/body/group search, hook navigation, keyboard
  Space collapse, search Escape, zero results, collapse/search/page draft retention,
  exact all-block save/read equality, restart/reset, overlength failure preservation,
  busy save/close protection and dirty-close cancellation.
- Captured and visually inspected ordinary and 600x480 / 420x720 layouts. Save and
  close remained visible and hittable; narrow layout has independent directory and
  content scrolling. Native details/summary and tab stops provide keyboard access.
- Independent review: APPROVE, no blockers. Real user files, credentials and
  conversations were not accessed; the checker uses temporary user data and no
  model network calls. The owner's running app was not restarted.

Screenshots in `assets/screenshots/p2at-031b/`:

- [Workflow directory and overview](assets/screenshots/p2at-031b/workflow-overview.png)
- [Hook search](assets/screenshots/p2at-031b/search-hook.png)
- [600x480](assets/screenshots/p2at-031b/narrow-600.png)
- [420x720](assets/screenshots/p2at-031b/narrow-420.png)
- [Close at bottom](assets/screenshots/p2at-031b/close-at-bottom.png)

Expansion/search preferences are in-memory for this opening of the dialog, not new
persisted user settings. Search is literal rather than semantic. This delivery is
REVIEW; controller acceptance and merge remain separate.
