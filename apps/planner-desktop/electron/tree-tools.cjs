"use strict";
// Thin wrapper — all classification, adjacency and graph logic lives in
// ../renderer/tree-snapshot.js (dual-mode CJS / browser global).
const ts = require("../renderer/tree-snapshot.js");
const {deriveSemanticTopology} = require("../renderer/semantic-topology.js");

var MAX_NODES = 10_000;
var MAX_EDGES = 30_000;
var MAX_SNAPSHOT_BYTES = 8_000_000;

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

    var full = ts.publishProjectedSnapshot(buildState, _upstreamSnapshotId);
    full.semanticTopology = deriveSemanticTopology(full.nodes, full.adjacency);
    // Derived by the same pure transition used by the renderer write API.
    full.refundImpacts = buildState.refundImpacts || {};

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
      budgetUsage: {
        normal: Number.isFinite(buildState.passivePointsUsed) ? buildState.passivePointsUsed : 0,
        weaponSet1: (buildState.weaponSet1Allocated || []).length,
        weaponSet2: (buildState.weaponSet2Allocated || []).length,
        ascendancy: Number.isFinite(buildState.ascPointsUsed) ? buildState.ascPointsUsed : 0,
        instilled: (buildState.instillAllocated || []).length,
      },
      allocations: { normal: buildState.allocated || [], weaponSet1: buildState.weaponSet1Allocated || [], weaponSet2: buildState.weaponSet2Allocated || [], ascendancy: buildState.ascAllocated || [], instilled: buildState.instillAllocated || [] },
      ascendancyOptions: buildState.ascendancyOptions || [],
    },
    _pathIndex: { generalParent:{}, generalReachable:[], weaponSet1Parent:{}, weaponSet2Parent:{}, ascParent:{}, ascReachable:[] },
  };
}

module.exports = { createTreeSnapshotProvider };
