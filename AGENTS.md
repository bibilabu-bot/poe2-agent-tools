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
- Executor conversations implement exactly one assigned task.
- Executors must not mark their own task accepted. They report evidence; the controller performs acceptance.

## Executor environments

Every task in `docs/TASKS.md` must name an assignment target:

- **Codex local executor**: use for repository edits, builds, tests, local application inspection and branch/commit work.
- **ChatGPT chat executor**: prefer for research, design proposals, reviews, data-contract drafts and other work that does not require reliable access to a local checkout.

ChatGPT chat tasks receive repository context through the GitHub URL plus an explicit branch, directory and output contract. If a chat task produces only a report or proposal, it must return a complete artifact that a later Codex task can commit without reconstructing missing context.

Local executor conversations must use an isolated Git worktree. They must not switch branches in the controller's checkout. Multiple Codex conversations can share filesystem state, so using one checkout for both controller metadata and implementation tasks can move `HEAD` underneath another conversation.

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

- Worktree: a task-specific Codex worktree based on the latest `main`
- Branch: `task/<task-id>-short-name`
- Commit: `<type>(<scope>): <summary>`
- One implementation task should remain independently reviewable and mergeable.

Research-only ChatGPT tasks may return an artifact without a commit when the task explicitly permits it. The controller then accepts the artifact or dispatches a separate Codex integration task; the controller does not silently turn the proposal into implementation.

Direct pushes to `main` are reserved for controller-owned project metadata or explicitly authorized recovery work.

## Current technical constraints

- Node.js 20+ is the supported baseline.
- `apps/planner-desktop` is the main product.
- `apps/planner-web` is a migration reference, not the default feature target.
- Runtime game data currently comes from external sources and the Electron cache layer.
- The planner core is monolithic; behavior-preserving tests must precede major decomposition.
