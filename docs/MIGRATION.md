# PoE2 Planner Migration Notes

## Project identity

This project was migrated from the ChatGPT development session named `制作流放2天赋树图`.

Goal:

- Build a local-first PoE2 build planner.
- Support AI Agent friendly structured data.
- Evolve from passive tree viewer into a full BD planner.

## Current baseline

Latest recovered prototype:

- `poe2_passive_tree_planner_v13_analysis`
- Browser version + Electron desktop experiments.
- Local cache experiment exists.

Implemented concepts:

- Passive tree canvas rendering.
- Zoom/pan navigation.
- Class selection.
- Ascendancy selection.
- Chinese localization layer.
- Passive allocation.
- Weapon Set I / II allocation.
- Hidden conditional nodes.
- Mastery visuals.
- Stat aggregation.
- Search and analysis panels.

## Data sources

Prototype references:

- PoE2 tree export data.
- poe2drydream passive tree preprocessing.
- Path of Building PoE2 Chinese translation data.

The original prototype referenced:

- tree-pre.json
- tree-jump.json
- atlas-skills.webp
- atlas-frame.webp

## Product direction

The final product is not only a tree viewer.

Planned modules:

1. Passive tree planner
2. Skills
3. Equipment
4. Crafting system
5. Build sharing/import/export
6. AI build assistant

## Known problems

- Asset licensing and local packaging need final decisions.
- Third-party atlas resources should be cached with clear attribution.
- Desktop packaging needs cleanup.
- Data update pipeline is not finalized.
