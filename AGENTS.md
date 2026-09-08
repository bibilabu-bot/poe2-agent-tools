# Agent operating guide

This repository is managed through a controller/executor workflow.

## Source of truth

Before changing anything, read these files in order:

1. `README.md`
2. `docs/PROJECT_STATUS.md`
3. `docs/TASKS.md`
4. `docs/ARCHITECTURE.md`
5. `docs/DECISIONS.md`

For assigned work, follow the task ID and acceptance criteria in `docs/TASKS.md`. Do not expand the task scope without explicit approval.

## Roles

- The project-controller conversation owns priorities, task definitions, architecture decisions and acceptance.
- Executor conversations implement exactly one assigned task in a separate branch or worktree.
- Executors must not mark their own task accepted. They report evidence; the controller performs acceptance.

## Required executor handoff

Every completed task must report:

- task ID and branch name;
- commit hash;
- files changed;
- tests/checks run and their results;
- known limitations or follow-up work;
- whether the working tree is clean;
- anything that changes architecture, data contracts or project assumptions.

Do not commit generated dependencies, local caches, credentials or unrelated changes.

## Branch and commit convention

- Branch: `task/<task-id>-short-name`
- Commit: `<type>(<scope>): <summary>`
- One task should remain independently reviewable and mergeable.

Direct pushes to `main` are reserved for controller-owned project metadata or explicitly authorized recovery work.

## Current technical constraints

- Node.js 20+ is the supported baseline.
- `apps/planner-desktop` is the main product.
- `apps/planner-web` is a migration reference, not the default feature target.
- Runtime game data currently comes from external sources and the Electron cache layer.
- The planner core is monolithic; behavior-preserving tests must precede major decomposition.
