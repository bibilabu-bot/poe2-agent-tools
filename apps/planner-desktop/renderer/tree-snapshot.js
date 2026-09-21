"use strict";
// Bounded, immutable tree + Build snapshot for the Python tool loop.
// Does NOT touch DOM, Planner globals, network or file system at runtime.
// Callers inject the current Planner state and graph; this module
// produces a narrow JSON-serializable snapshot with precomputed
// eligibility classifications and stable adjacency.

const { createPassiveGraph } = require("./passive-graph.js");

const ORDINARY_SOCKET_IDS = new Set(
  ["2491","7960","21984","26196","26725","32763","46882","54127","55190","60735","61419","61834"]
);

const INSTILL_EXCLUSIVE_NAME_SET = new Set([
  "Charity's Reach","Grasp of the Elements","Unity of Purpose","The Frozen Abyss",
  "Scout's Pride","Kindle the Wild"
]);

const LEGACY_START_ARTIFACT_NAMES = new Set([
  "Six","Marauder","Witch","Ranger","Duelist","Shadow","Templar"
]);

const ALLOCATION_CATEGORY_ORDER = ["normal","weaponSet1","weaponSet2","ascendancy","instilled"];

function compareNodeIds(a, b) {
  const left = String(a), right = String(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedIds(ids) { return [...ids].map(String).sort(compareNodeIds); }

// --- planner.js classification rules replicated as pure, narrow helpers ---
// These MUST match the in-Planner classification. Tests lock the two together.

function idOf(n) { return String(n.skill ?? n._id ?? n.id); }

function nodeKind(n) { return n?.kind || "small"; }

function isAscNode(n) { return Boolean(n?.asc); }

function isClassStartNode(n) {
  return nodeKind(n) === "classstart" || Array.isArray(n?.classesStart) || Array.isArray(n?.classStartIndex);
}

function isLegacyStartArtifactNode(n) {
  if (!n) return false;
  const rawName = String(n.name || "").trim();
  if (LEGACY_START_ARTIFACT_NAMES.has(rawName)) return true;
  if (/^\d+$/.test(rawName) && (n.group == null || nodeKind(n) === "classstart")) return true;
  return false;
}

function isMasteryVisualNode(n) {
  if (!n) return false;
  return nodeKind(n) === "mastery" || n.isOnlyImage === true;
}

function isInstillExclusiveNode(n) {
  return Boolean(n && INSTILL_EXCLUSIVE_NAME_SET.has(String(n.name || "")));
}

function unlockConstraintOf(n, overrideRequirementIdsFn) {
  const uc = n?.unlockConstraint;
  if (uc && typeof uc === "object") return uc;
  const ids = overrideRequirementIdsFn ? overrideRequirementIdsFn(n) : [];
  return ids.length ? { nodes: ids } : null;
}

function isConditionalRevealNode(n, overrideRequirementIdsFn) {
  return Boolean(
    n && !isAscNode(n) && !isMasteryVisualNode(n) && !isInstillExclusiveNode(n) &&
    unlockConstraintOf(n, overrideRequirementIdsFn)
  );
}

function constraintNodeIds(n, overrideRequirementIdsFn) {
  const uc = unlockConstraintOf(n, overrideRequirementIdsFn);
  if (!uc || !Array.isArray(uc.nodes)) return [];
  return uc.nodes.map(String);
}

function constraintAscendancyMatches(n, selectedAscendancyId) {
  const uc = n?.unlockConstraint;
  if (!uc || !uc.ascendancy) return true;
  if (!selectedAscendancyId) return false;
  return String(uc.ascendancy) === String(selectedAscendancyId);
}

function constraintSatisfied(n, activeIds, selectedAscendancyId, overrideRequirementIdsFn) {
  if (!isConditionalRevealNode(n, overrideRequirementIdsFn)) return true;
  if (!constraintAscendancyMatches(n, selectedAscendancyId)) return false;
  for (const req of constraintNodeIds(n, overrideRequirementIdsFn)) {
    if (!activeIds.has(req)) return false;
  }
  return true;
}

const CONDITIONAL_NODE_OVERRIDES = {
  "The Hollowkeeper": { requires: ["First Teachings of the Keeper","First Principle of the Hollow"], visibleConnections:["First Teachings of the Keeper"] },
  "Path of the Renegade": { requires: ["Redblade Discipline","Brinerot Ferocity","Mutewind Agility"] }
};

function overrideRequirementIds(n, byName) {
  if (!n || !byName) return [];
  const ov = CONDITIONAL_NODE_OVERRIDES[String(n.name || "")];
  if (!ov?.requires) return [];
  return ov.requires.map(name => byName.get(name)).filter(Boolean).map(idOf);
}

function allocatableEdgeAllowedNodes(a, b, byName) {
  if (!a || !b) return false;
  if (isMasteryVisualNode(a) || isMasteryVisualNode(b)) return false;
  if (isInstillExclusiveNode(a) || isInstillExclusiveNode(b)) return false;
  for (const [conditional, other] of [[a,b],[b,a]]) {
    const ov = CONDITIONAL_NODE_OVERRIDES[String(conditional.name || "")];
    if (ov?.visibleConnections && !ov.visibleConnections.includes(String(other.name || ""))) return false;
  }
  return true;
}

// --- Snapshot capture ---

function _nameIndex(nodes) {
  const map = new Map();
  for (const n of nodes) { const name = String(n.name || "").trim(); if (name) map.set(name, n); }
  return map;
}

function _activeAllocationSet(state) {
  const set = new Set(state.allocated);
  for (const id of state.ascAllocated) set.add(id);
  return set;
}

function _canTraverse(n, state, activeSet, byName) {
  if (!n || isAscNode(n) || isMasteryVisualNode(n) || isInstillExclusiveNode(n) || isLegacyStartArtifactNode(n)) return false;
  if (isClassStartNode(n) && state.classStartId && idOf(n) !== state.classStartId) return false;
  if (isConditionalRevealNode(n, (nn) => overrideRequirementIds(nn, byName)) &&
      !constraintSatisfied(n, activeSet, state.selectedAscendancyId, (nn) => overrideRequirementIds(nn, byName))) return false;
  return true;
}

function _canTraverseAsc(n, state) {
  return Boolean(n && !isMasteryVisualNode(n) && state.selectedAscendancyId && n.asc === state.selectedAscendancyId);
}

function captureTreeSnapshot(state) {
  if (!state || !Array.isArray(state.nodes) || !state.byId) throw new TypeError("planner state is required");

  const activeSet = _activeAllocationSet(state);
  const byName = _nameIndex(state.nodes);
  const eligibleNodes = [];

  // Build allocatable-edge graph once (matches Planner's passiveGraph).
  const allocGraph = createPassiveGraph(state.nodes, state.edges || [], {
    getNodeId: idOf,
    allowEdge: (a, b) => allocatableEdgeAllowedNodes(a, b, byName),
  });

  for (const node of state.nodes) {
    if (isMasteryVisualNode(node) || isLegacyStartArtifactNode(node)) continue;
    const id = idOf(node);
    if (!id || id === "undefined") continue;
    const kind = nodeKind(node);
    if (kind === "instill" && !state.showInstillOnGraph) continue;
    if (!state.showSmall && kind === "small") continue;

    const neighbors = allocGraph.neighbors(id);
    const generalEligible = _canTraverse(node, state, activeSet, byName);
    const ascEligible = _canTraverseAsc(node, state);
    const isConditionalReveal = isConditionalRevealNode(node, (nn) => overrideRequirementIds(nn, byName));
    const satisfied = isConditionalReveal ? constraintSatisfied(node, activeSet, state.selectedAscendancyId, (nn) => overrideRequirementIds(nn, byName)) : true;

    eligibleNodes.push({
      id,
      name: String(node.name || ""),
      stats: Array.isArray(node.stats) ? node.stats.slice(0, 32) : [],
      statsTotal: Array.isArray(node.stats) ? node.stats.length : 0,
      kind,
      x: Number.isFinite(node.x) ? node.x : 0,
      y: Number.isFinite(node.y) ? node.y : 0,
      orbit: Number.isFinite(node.orbit) ? Number(node.orbit) : null,
      orbitIndex: Number.isFinite(node.orbitIndex) ? Number(node.orbitIndex) : null,
      asc: node.asc || null,
      isJewelSocket: Boolean(node.isJewelSocket),
      isBlighted: Boolean(node.isBlighted),
      isKeystone: kind === "keystone",
      isNotable: kind === "notable",
      isSmall: kind === "small",
      isAscendancy: isAscNode(node),
      isClassStart: isClassStartNode(node),
      isConditionalReveal,
      constraintSatisfied: satisfied,
      isGeneralEligible: generalEligible,
      isAscEligible: ascEligible,
      neighbors: sortedIds(neighbors),
      unlockConstraint: node.unlockConstraint || null,
      isOrdinaryJewelSocket: Boolean(node.isJewelSocket) && ORDINARY_SOCKET_IDS.has(id),
    });
  }

  // Sort nodes by ID for stable iteration
  eligibleNodes.sort((a, b) => compareNodeIds(a.id, b.id));

  const nodeMap = {};
  const adjacency = {};
  for (const n of eligibleNodes) {
    nodeMap[n.id] = n;
    adjacency[n.id] = n.neighbors;
  }

  const generalStarts = sortedIds([state.classStartId, ...state.allocated].filter(id => {
    const n = nodeMap[id];
    return n && n.isGeneralEligible;
  }));

  const { buildShortestPathIndex, reachableEligibleIds } = require("./passive-graph.js");
  const generalParent = buildShortestPathIndex(allocGraph, {
    starts: generalStarts,
    isEligible: (n) => { const nid = idOf(n); const sn = nodeMap[nid]; return sn ? sn.isGeneralEligible : false; },
  });
  const generalReachable = reachableEligibleIds(allocGraph, {
    starts: generalStarts,
    isEligible: (n) => { const nid = idOf(n); const sn = nodeMap[nid]; return sn ? sn.isGeneralEligible : false; },
  });

  let ascStarts = [];
  let ascReachable = new Set();
  if (state.selectedAscendancyId) {
    ascStarts = sortedIds([...state.ascAllocated].filter(id => {
      const n = nodeMap[id];
      return n && n.isAscEligible;
    }));
    ascReachable = reachableEligibleIds(allocGraph, {
      starts: ascStarts,
      isEligible: (n) => { const nid = idOf(n); const sn = nodeMap[nid]; return sn ? sn.isAscEligible : false; },
    });
  }

  const { createHash } = require("node:crypto");
  const treeDigest = createHash("sha256").update(JSON.stringify({
    nodeCount: eligibleNodes.length,
    edgeCount: Object.values(adjacency).reduce((s, a) => s + a.length, 0) / 2,
    parentNodeCount: generalParent.size + (state.selectedAscendancyId ? "1" : "0"),
  })).digest("hex").slice(0, 16);

  return {
    snapshotId: `tree-snapshot-${treeDigest}`,
    nodeCount: eligibleNodes.length,
    adjacency,
    general: {
      starts: generalStarts,
      reachableCount: generalReachable.size,
    },
    ascendancy: state.selectedAscendancyId ? {
      starts: ascStarts,
      reachableCount: ascReachable.size,
      ascendancyId: state.selectedAscendancyId,
    } : null,
    // Path index: map nodeId -> parentId (or null for start nodes)
    // Only includes reachable nodes. Pre-computed by passive-graph.js.
    _pathIndex: {
      generalParent: Object.fromEntries(generalParent),
      generalReachable: Array.from(generalReachable),
      ascParent: state.selectedAscendancyId ? Object.fromEntries(
        buildShortestPathIndex(allocGraph, {
          starts: ascStarts,
          isEligible: (n) => { const nid = idOf(n); const sn = nodeMap[nid]; return sn ? sn.isAscEligible : false; },
        })
      ) : {},
      ascReachable: Array.from(ascReachable),
    },
  };
}

function captureBuildState(state) {
  const classStartId = state.classStartId || null;
  return {
    baseClassName: state.baseClassName || null,
    selectedAscendancyId: state.selectedAscendancyId || null,
    classStartId,
    budgets: {
      passive: Number.isFinite(state.maxPoints) ? state.maxPoints : 0,
      weaponSet: Number.isFinite(state.maxWeaponPoints) ? state.maxWeaponPoints : 0,
      ascendancy: Number.isFinite(state.maxAscPoints) ? state.maxAscPoints : 0,
    },
    budgetUsage: {
      normal: state.allocated ? state.allocated.size : 0,
      weaponSet1: state.weaponSet1Allocated ? state.weaponSet1Allocated.size : 0,
      weaponSet2: state.weaponSet2Allocated ? state.weaponSet2Allocated.size : 0,
      ascendancy: state.ascAllocated ? state.ascAllocated.size : 0,
      instilled: state.instillAllocated ? state.instillAllocated.size : 0,
    },
    allocations: {
      normal: sortedIds(state.allocated || []),
      weaponSet1: sortedIds(state.weaponSet1Allocated || []),
      weaponSet2: sortedIds(state.weaponSet2Allocated || []),
      ascendancy: sortedIds(state.ascAllocated || []),
      instilled: sortedIds(state.instillAllocated || []),
    },
    ascendancyOptions: (state.ascendancyOptions || []).map(a => ({ id: a.id, name: a.name })),
    snapshots: {
      camera: state.camera ? { x: state.camera.x, y: state.camera.y, scale: state.camera.scale } : null,
      weaponMode: state.weaponMode || null,
      showAscendancy: Boolean(state.showAsc),
      showLockedConditional: Boolean(state.showLockedConditional),
    },
  };
}

function publishFullSnapshot(treeSnapshot, buildState, upstreamSnapshotId) {
  if (!treeSnapshot || !buildState) throw new TypeError("tree and build snapshots are required");
  const { createHash } = require("node:crypto");
  const identity = createHash("sha256").update(JSON.stringify({
    treeId: treeSnapshot.snapshotId,
    allocations: buildState.allocations,
    ascendancy: buildState.selectedAscendancyId,
  })).digest("hex").slice(0, 16);
  return {
    snapshotId: `full-snapshot-${identity}`,
    upstreamSnapshotId: upstreamSnapshotId || null,
    ...treeSnapshot,
    build: buildState,
  };
}

// Rollup the full tree node data (with paging support) for Python.
// The heavy path index is published separately.
function publishNodesPage(snapshot, offset = 0, limit = 500) {
  if (!snapshot || !snapshot.adjacency) throw new TypeError("snapshot is required");
  // Rebuild node list from adjacency keys
  // (nodes live on the JS side; we paginate for transport)
  return { offset, limit, complete: true };
}

module.exports = {
  captureTreeSnapshot,
  captureBuildState,
  publishFullSnapshot,
  compareNodeIds,
  sortedIds,
  // Classification helpers (exported for testing)
  idOf, nodeKind, isAscNode, isClassStartNode, isLegacyStartArtifactNode,
  isMasteryVisualNode, isInstillExclusiveNode, isConditionalRevealNode,
  constraintSatisfied, allocatableEdgeAllowedNodes,
  ORDINARY_SOCKET_IDS,
};