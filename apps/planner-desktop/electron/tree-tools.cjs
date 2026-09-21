"use strict";
// Thin wrapper — all classification, adjacency and graph logic lives in
// ../renderer/tree-snapshot.js (dual-mode CJS / browser global).
const ts = require("../renderer/tree-snapshot.js");

var MAX_NODES = 2400;
var MAX_EDGES = 6000;
var MAX_SNAPSHOT_BYTES = 1_800_000;

function createTreeSnapshotProvider(_localResourceResponse, _upstreamSnapshotId) {
  return async function(buildState) {
    if (!buildState) return null;

    if (buildState._projectionError) {
      return _errorSnapshot(buildState, "snap-projection-error", buildState._projectionError);
    }

    var projectedNodes = buildState.nodes;
    var projectedEdges = buildState.edges;
    if (!Array.isArray(projectedNodes) || projectedNodes.length > MAX_NODES ||
        !Array.isArray(projectedEdges) || projectedEdges.length > MAX_EDGES) {
      return _errorSnapshot(buildState, "snap-overflow", "node/edge count exceeds main-process bound");
    }

    // Reconstruct Set/Map wrappers (renderer sends plain arrays).
    var byIdMap = new Map();
    for (var i = 0; i < projectedNodes.length; i++) {
      byIdMap.set(String(projectedNodes[i].id), projectedNodes[i]);
    }

    var state = {
      nodes: projectedNodes,
      edges: projectedEdges,
      byId: byIdMap,
      allocated: new Set(buildState.allocated || []),
      weaponSet1Allocated: new Set(buildState.weaponSet1Allocated || []),
      weaponSet2Allocated: new Set(buildState.weaponSet2Allocated || []),
      ascAllocated: new Set(buildState.ascAllocated || []),
      instillAllocated: new Set(buildState.instillAllocated || []),
      classStartId: buildState.classStartId || null,
      ascStartId: buildState.ascStartId || null,
      selectedAscendancyId: buildState.selectedAscendancyId || null,
      maxPoints: buildState.maxPoints || 0,
      maxWeaponPoints: buildState.maxWeaponPoints || 0,
      maxAscPoints: buildState.maxAscPoints || 0,
      passivePointsUsed: buildState.passivePointsUsed,
      ascPointsUsed: buildState.ascPointsUsed,
      showSmall: buildState.showSmall !== false,
      showInstillOnGraph: Boolean(buildState.showInstillOnGraph),
      showAsc: Boolean(buildState.showAscendancy),
      showLockedConditional: Boolean(buildState.showLockedConditional),
      weaponMode: buildState.weaponMode || null,
      ascendancyOptions: buildState.ascendancyOptions || [],
    };

    var treeSnap = ts.captureTreeSnapshot(state);
    var build = ts.captureBuildState(state);
    var full = ts.publishFullSnapshot(treeSnap, build, buildState.upstreamSnapshotId || null);

    var measured = JSON.stringify(full).length;
    if (measured > MAX_SNAPSHOT_BYTES) {
      return _errorSnapshot(buildState, "snap-size-exceeded", "serialised " + measured + " bytes exceeds " + MAX_SNAPSHOT_BYTES);
    }

    return full;
  };
}

function _errorSnapshot(buildState, snapId, message) {
  return {
    snapshotId: snapId, _error: message, nodeCount: 0,
    nodes: {}, adjacency: {},
    build: {
      baseClassName: buildState.baseClassName || null,
      selectedAscendancyId: buildState.selectedAscendancyId || null,
      classStartId: buildState.classStartId || null,
      budgets: { passive: buildState.maxPoints || 0, weaponSet: buildState.maxWeaponPoints || 0, ascendancy: buildState.maxAscPoints || 0 },
      budgetUsage: { normal: 0, weaponSet1: 0, weaponSet2: 0, ascendancy: 0, instilled: 0 },
      allocations: { normal: buildState.allocated || [], weaponSet1: buildState.weaponSet1Allocated || [], weaponSet2: buildState.weaponSet2Allocated || [], ascendancy: buildState.ascAllocated || [], instilled: buildState.instillAllocated || [] },
      ascendancyOptions: buildState.ascendancyOptions || [],
    },
    _pathIndex: { generalParent:{}, generalReachable:[], weaponSet1Parent:{}, weaponSet2Parent:{}, ascParent:{}, ascReachable:[] },
  };
}

module.exports = { createTreeSnapshotProvider };