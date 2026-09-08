# PoE2 Agent Tools Architecture

## Current module: Passive Tree Planner

Migrated baseline: `poe2_passive_tree_planner_v13_analysis`

Capabilities:
- Passive tree rendering
- Class and ascendancy selection
- Allocation preview
- Weapon Set I / II support
- Chinese localization layer
- Stat aggregation
- Hidden/mastery handling

## Planned structure

```
apps/
  planner-web/
  planner-desktop/
tools/
  jewel-compiler/
data/
  tree/
  atlas/
  translation/
```

The current prototype is being refactored from a single HTML/JS application into maintainable modules.
