# Tree overview sections — REVIEW

Owner-authorized follow-up: remove the allocation-directory mode from
`tree_overview`, retaining current-Build cluster navigation and physical boundaries.
No numbered task ID was assigned for this follow-up.

- Baseline: `cbb33c0e00820f0295b075ae813866cb61e5867d` (main).
- Branch: `task/tree-overview-no-allocations`.
- Independent of the unmerged RAG transient-retry branch.

## Contract and compatibility

`tree_overview.section` now accepts only `clusters` and `boundaries`.
The default remains the complete current-Build cluster graph, with existing
before-hook summaries and named edges. Legacy offset/limit values do not paginate
clusters. Boundaries retain physical edges, endpoint allocation flags, the 20-item
page bound and `nextOffset` behavior.

The retired `allocations` value fails with `INVALID_TOOL_ARGUMENTS` through both
argument parsing and direct execution, including unavailable/degraded snapshots.
It is not silently redirected. The `allocationsPage` response and
`build.detailTools.allocatedIds` hint are removed. Default purpose/detail prompts
and their documented copies no longer direct the model to that entry point.

This does not delete Build allocation state, allocation counts/budgets, saved
Builds, node/cluster detail tools, write tools, or other tools' contracts. No new
tool, model-round policy, full-tree scan optimization or data migration is added.

Existing private prompt overrides are **not inspected, rewritten or reset** by
this task. Custom text may still mention the removed mode; the owner can edit it
in prompt maintenance. Such text cannot restore the schema/runtime entry point.
The existing lossless prompt migration is unchanged; a synthetic v5 override
containing obsolete mode instructions is tested for exact preservation through
load, migration and save. Old archived tool calls are not rewritten.

## Verification

- Focused tree-tool, cluster-summary and prompt suites: 61 tests passed.
- Full `npm test`: Node 226/226 (zero skips), Python 108/108.
- `npm run check` and `git diff --check` passed; independent review APPROVE,
  with no blocking findings.
- New tests cover schema/parser/runner rejection, degraded snapshots, retained
  allocation counts without ID-directory output, complete 25-cluster/24-edge
  output, hook invocation and summaries, unchanged boundary paging and endpoint
  flags, and source Build immutability.
- Existing node reads, cluster reads, writes and prompt migration remain covered.
- Tests use synthetic providers and local locked data only; no paid API calls,
  private credentials/prompts, index rebuilds or user application restarts.

Executor delivery is REVIEW; integration and application restart belong to the
controller. No main merge is performed by this task.
