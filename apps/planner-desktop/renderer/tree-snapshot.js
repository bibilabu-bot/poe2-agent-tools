(function initTreeSnapshot(root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.plannerTreeSnapshot = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function treeSnapshotFactory() {
  "use strict";

  var pg = typeof plannerPassiveGraph !== "undefined" ? plannerPassiveGraph
    : typeof require === "function" ? require("./passive-graph.js") : null;
  if (!pg) throw new Error("plannerPassiveGraph is required");

  var createPassiveGraph = pg.createPassiveGraph;
  var buildShortestPathIndex = pg.buildShortestPathIndex;
  var reachableEligibleIds = pg.reachableEligibleIds;

  var ORDINARY_SOCKET_IDS = new Set(
    ["2491","7960","21984","26196","26725","32763","46882","54127","55190","60735","61419","61834"]
  );

  var INSTILL_EXCLUSIVE_NAME_SET = new Set([
    "Charity's Reach","Grasp of the Elements","Unity of Purpose","The Frozen Abyss",
    "Scout's Pride","Kindle the Wild"
  ]);

  var LEGACY_START_ARTIFACT_NAMES = new Set([
    "Six","Marauder","Witch","Ranger","Duelist","Shadow","Templar"
  ]);

  var CONDITIONAL_NODE_OVERRIDES = {
    "The Hollowkeeper": { requires: ["First Teachings of the Keeper","First Principle of the Hollow"], visibleConnections:["First Teachings of the Keeper"] },
    "Path of the Renegade": { requires: ["Redblade Discipline","Brinerot Ferocity","Mutewind Agility"] }
  };

  function compareNodeIds(a, b) {
    var left = String(a), right = String(b);
    return left < right ? -1 : left > right ? 1 : 0;
  }

  function sortedIds(ids) {
    if (!ids) return [];
    if (ids instanceof Set) ids = Array.from(ids);
    if (!Array.isArray(ids)) return [];
    return ids.map(String).sort(compareNodeIds);
  }

  function idOf(n) { return String(n.skill != null ? n.skill : n._id != null ? n._id : n.id != null ? n.id : "undefined"); }

  function nodeKind(n) { return n && n.kind ? n.kind : "small"; }

  function isAscNode(n) { return Boolean(n && n.asc); }

  function isClassStartNode(n) {
    return nodeKind(n) === "classstart" || Array.isArray(n && n.classesStart) || Array.isArray(n && n.classStartIndex);
  }

  function isLegacyStartArtifactNode(n) {
    if (!n) return false;
    var rawName = String(n.name || "").trim();
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

  function unlockConstraintOf(n, overrideReqFn) {
    if (!n) return null;
    var uc = n.unlockConstraint;
    if (uc && typeof uc === "object") return uc;
    var ids = typeof overrideReqFn === "function" ? overrideReqFn(n) : [];
    return ids && ids.length ? { nodes: ids } : null;
  }

  function isConditionalRevealNode(n, overrideReqFn) {
    return Boolean(
      n && !isAscNode(n) && !isMasteryVisualNode(n) && !isInstillExclusiveNode(n) &&
      unlockConstraintOf(n, overrideReqFn)
    );
  }

  function constraintAscendancyMatches(n, selectedAscendancyId) {
    if (!n) return true;
    var uc = n.unlockConstraint;
    if (!uc || !uc.ascendancy) return true;
    if (!selectedAscendancyId) return false;
    return String(uc.ascendancy) === String(selectedAscendancyId);
  }

  function constraintSatisfied(n, activeIds, selectedAscendancyId, overrideReqFn) {
    if (!isConditionalRevealNode(n, overrideReqFn)) return true;
    if (!constraintAscendancyMatches(n, selectedAscendancyId)) return false;
    var reqs = [];
    if (typeof overrideReqFn === "function") reqs = overrideReqFn(n) || [];
    if (!reqs.length) {
      var uc = n && n.unlockConstraint;
      reqs = (uc && Array.isArray(uc.nodes)) ? uc.nodes.map(String) : [];
    }
    for (var i = 0; i < reqs.length; i++) { if (!activeIds.has(reqs[i])) return false; }
    return true;
  }

  function _emptyOverrideFn() { return []; }

  function allocatableEdgeAllowedNodes(a, b, byName) {
    if (!a || !b) return false;
    if (isMasteryVisualNode(a) || isMasteryVisualNode(b)) return false;
    if (isInstillExclusiveNode(a) || isInstillExclusiveNode(b)) return false;
    for (var i = 0; i < 2; i++) {
      var conditional = i === 0 ? a : b, other = i === 0 ? b : a;
      var ov = CONDITIONAL_NODE_OVERRIDES[String(conditional.name || "")];
      if (ov && ov.visibleConnections && !ov.visibleConnections.includes(String(other.name || ""))) return false;
    }
    return true;
  }

  function _nameIndex(nodes) {
    var map = new Map();
    for (var i = 0; i < nodes.length; i++) { var nm = String(nodes[i].name || "").trim(); if (nm) map.set(nm, nodes[i]); }
    return map;
  }

  function _activeAllocationSet(state) {
    var s = new Set(state.allocated || []);
    var asc = state.ascAllocated;
    if (asc) { if (asc.forEach) asc.forEach(function(id) { s.add(id); }); else for (var i = 0; i < asc.length; i++) s.add(String(asc[i])); }
    return s;
  }

  function _canTraverse(n, state, activeSet, byName) {
    if (!n || isAscNode(n) || isMasteryVisualNode(n) || isInstillExclusiveNode(n) || isLegacyStartArtifactNode(n)) return false;
    if (isClassStartNode(n) && state.classStartId && idOf(n) !== state.classStartId) return false;
    if (isConditionalRevealNode(n, _emptyOverrideFn) && !constraintSatisfied(n, activeSet, state.selectedAscendancyId, _emptyOverrideFn)) return false;
    return true;
  }

  function _canTraverseAsc(n, state) {
    return Boolean(n && !isMasteryVisualNode(n) && state.selectedAscendancyId && n.asc === state.selectedAscendancyId);
  }

  function captureTreeSnapshot(state) {
    if (!state || !Array.isArray(state.nodes)) throw new TypeError("planner state with nodes[] is required");
    var activeSet = _activeAllocationSet(state);
    var byName = _nameIndex(state.nodes);
    var allocGraph = createPassiveGraph(state.nodes, state.edges || [], { getNodeId: idOf, allowEdge: function(a, b) { return allocatableEdgeAllowedNodes(a, b, byName); } });
    var eligibleNodes = [];
    for (var i = 0; i < state.nodes.length; i++) {
      var node = state.nodes[i]; if (!node) continue;
      if (isMasteryVisualNode(node) || isLegacyStartArtifactNode(node)) continue;
      var nid = idOf(node); if (!nid || nid === "undefined") continue;
      var knd = nodeKind(node);
      // The agent catalog describes the loaded tree, not the current canvas
      // presentation. Display toggles must never hide searchable/readable nodes.
      var neighbors = allocGraph.neighbors(nid);
      var generalEligible = _canTraverse(node, state, activeSet, byName);
      var ascEligible = _canTraverseAsc(node, state);
      var isCond = isConditionalRevealNode(node, _emptyOverrideFn);
      var satisfied = isCond ? constraintSatisfied(node, activeSet, state.selectedAscendancyId, _emptyOverrideFn) : true;
      eligibleNodes.push({
        id: nid, name: String(node.localizedName || node.name || ""), englishName: String(node.name || ""),
        stats: Array.isArray(node.localizedStats) ? node.localizedStats : (Array.isArray(node.stats) ? node.stats : []),
        kind: knd,
        x: Number.isFinite(node.x) ? node.x : null, y: Number.isFinite(node.y) ? node.y : null,
        asc: node.asc || null,
        isJewelSocket: Boolean(node.isJewelSocket), isBlighted: Boolean(node.isBlighted),
        isKeystone: knd === "keystone", isNotable: knd === "notable", isSmall: knd === "small",
        isAscendancy: isAscNode(node), isClassStart: isClassStartNode(node),
        isConditionalReveal: isCond, constraintSatisfied: satisfied,
        isGeneralEligible: generalEligible, isAscEligible: ascEligible,
        isOrdinaryJewelSocket: Boolean(node.isJewelSocket) && ORDINARY_SOCKET_IDS.has(nid),
        neighbors: sortedIds(neighbors),
        unlockConstraint: node.unlockConstraint || null,
        ascendancyId: node.asc || node.ascendancyId || null,
        isGenericAttribute: node.isGenericAttribute === true,
        sourceStats: Array.isArray(node.sourceStats) ? node.sourceStats : (node.stats || []),
        group: node.group ?? null, orbit: node.orbit ?? null, orbitIndex: node.orbitIndex ?? null,
      });
    }
    eligibleNodes.sort(function(a, b) { return compareNodeIds(a.id, b.id); });
    var nodeMap = {}, adjacency = {};
    for (var j = 0; j < eligibleNodes.length; j++) { var en = eligibleNodes[j]; nodeMap[en.id] = en; adjacency[en.id] = en.neighbors; }

    // --- general: starts = classStartId + allocated ---
    var generalStarts = sortedIds(([state.classStartId]).concat(Array.from(state.allocated || [])).filter(function(id) { var sn = nodeMap[id]; return sn && sn.isGeneralEligible; }));
    var generalParent = buildShortestPathIndex(allocGraph, { starts: generalStarts, isEligible: function(n) { var nid = idOf(n); var sn = nodeMap[nid]; return sn ? sn.isGeneralEligible : false; } });
    var generalReachable = reachableEligibleIds(allocGraph, { starts: generalStarts, isEligible: function(n) { var nid = idOf(n); var sn = nodeMap[nid]; return sn ? sn.isGeneralEligible : false; } });

    // --- weaponSet1: starts = weaponSet1Allocated (no classStart) ---
    var ws1Starts = sortedIds(state.weaponSet1Allocated || []);
    var ws1Parent = ws1Starts.length ? buildShortestPathIndex(allocGraph, { starts: ws1Starts, isEligible: function(n) { var nid = idOf(n); var sn = nodeMap[nid]; return sn ? sn.isGeneralEligible : false; } }) : new Map();

    // --- weaponSet2: starts = weaponSet2Allocated ---
    var ws2Starts = sortedIds(state.weaponSet2Allocated || []);
    var ws2Parent = ws2Starts.length ? buildShortestPathIndex(allocGraph, { starts: ws2Starts, isEligible: function(n) { var nid = idOf(n); var sn = nodeMap[nid]; return sn ? sn.isGeneralEligible : false; } }) : new Map();

    // --- ascendancy ---
    var ascStarts = [], ascParent = {}, ascReachable = new Set();
    if (state.selectedAscendancyId) {
      ascStarts = sortedIds(Array.from(state.ascAllocated || []).filter(function(id) { var sn = nodeMap[id]; return sn && sn.isAscEligible; }));
      var ascIdx = buildShortestPathIndex(allocGraph, { starts: ascStarts, isEligible: function(n) { var nid = idOf(n); var sn = nodeMap[nid]; return sn ? sn.isAscEligible : false; } });
      ascParent = Object.fromEntries(ascIdx);
      ascReachable = reachableEligibleIds(allocGraph, { starts: ascStarts, isEligible: function(n) { var nid = idOf(n); var sn = nodeMap[nid]; return sn ? sn.isAscEligible : false; } });
    }

    var treeDigest = _digest({
      nodes: eligibleNodes.map(function(n) { return [n.id, n.name, n.stats, n.kind, n.neighbors]; }),
      generalParent: Object.fromEntries(generalParent),
      ascendancyParent: ascParent,
    });
    var snapshotId = "tree-" + treeDigest.slice(5);

    return {
      snapshotId: snapshotId, nodeCount: eligibleNodes.length, nodes: eligibleNodes, adjacency: adjacency,
      general: { starts: generalStarts, reachableCount: generalReachable.size },
      ascendancy: state.selectedAscendancyId ? { starts: ascStarts, reachableCount: ascReachable.size, ascendancyId: state.selectedAscendancyId } : null,
      _pathIndex: {
        generalParent: Object.fromEntries(generalParent), generalReachable: Array.from(generalReachable),
        weaponSet1Parent: Object.fromEntries(ws1Parent),
        weaponSet2Parent: Object.fromEntries(ws2Parent),
        ascParent: ascParent, ascReachable: Array.from(ascReachable),
      },
    };
  }

  function captureBuildState(state) {
    var allocatedIds = new Set([].concat(
      sortedIds(state.allocated || []), sortedIds(state.weaponSet1Allocated || []),
      sortedIds(state.weaponSet2Allocated || []), sortedIds(state.ascAllocated || [])
    ));
    var highlights = (state.nodes || []).filter(function(node) {
      return allocatedIds.has(idOf(node)) && ["notable", "keystone"].includes(nodeKind(node));
    }).sort(function(a, b) { return compareNodeIds(idOf(a), idOf(b)); }).slice(0, 40).map(function(node) {
      return { id: idOf(node), name: String(node.name || ""), kind: nodeKind(node), stats: Array.isArray(node.stats) ? node.stats : [] };
    });
    var fallbackAscUsed = sortedIds(state.ascAllocated || []).filter(function(nodeId) {
      var node = (state.nodes || []).find(function(candidate) { return idOf(candidate) === nodeId; });
      return nodeId !== state.ascStartId && !(node && (
        nodeKind(node) === "ascstart"
        || node.isAscendancyStart === true
        || node.isMultipleChoiceOption === true
      ));
    }).length;
    return {
      baseClassName: state.baseClassName || null,
      selectedAscendancyId: state.selectedAscendancyId || null,
      classStartId: state.classStartId || null,
      ascStartId: state.ascStartId || null,
      budgets: {
        passive: Number.isFinite(state.maxPoints) ? state.maxPoints : 0,
        weaponSet: Number.isFinite(state.maxWeaponPoints) ? state.maxWeaponPoints : 0,
        ascendancy: Number.isFinite(state.maxAscPoints) ? state.maxAscPoints : 0,
      },
      budgetUsage: {
        normal: state.passivePointsUsed != null ? state.passivePointsUsed : (state.allocated ? (state.classStartId && state.allocated.has ? Math.max(0, state.allocated.size - 1) : (Array.isArray(state.allocated) ? state.allocated.length : 0)) : 0),
        weaponSet1: state.weaponSet1Allocated ? (state.weaponSet1Allocated.size != null ? state.weaponSet1Allocated.size : state.weaponSet1Allocated.length) : 0,
        weaponSet2: state.weaponSet2Allocated ? (state.weaponSet2Allocated.size != null ? state.weaponSet2Allocated.size : state.weaponSet2Allocated.length) : 0,
        ascendancy: state.ascPointsUsed != null ? state.ascPointsUsed : fallbackAscUsed,
        instilled: state.instillAllocated ? (state.instillAllocated.size != null ? state.instillAllocated.size : state.instillAllocated.length) : 0,
      },
      allocations: {
        normal: sortedIds(state.allocated || []),
        weaponSet1: sortedIds(state.weaponSet1Allocated || []),
        weaponSet2: sortedIds(state.weaponSet2Allocated || []),
        ascendancy: sortedIds(state.ascAllocated || []),
        instilled: Array.from(state.instillAllocated || []).sort(),
      },
      highlights: highlights,
      ascendancyOptions: (state.ascendancyOptions || []).map(function(a) { return { id: a.id, name: a.name }; }),
      weaponMode: state.weaponMode || null,
      showAscendancy: Boolean(state.showAsc),
      showLockedConditional: Boolean(state.showLockedConditional),
      showInstillOnGraph: Boolean(state.showInstillOnGraph),
    };
  }

  function _stableValue(value) {
    if (Array.isArray(value)) return value.map(_stableValue);
    if (value && typeof value === "object") {
      var result = {};
      Object.keys(value).sort().forEach(function(key) { result[key] = _stableValue(value[key]); });
      return result;
    }
    return value;
  }

  function _digest(data) {
    var s = JSON.stringify(_stableValue(data));
    var h = 0;
    for (var i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return "snap-" + (h >>> 0).toString(36);
  }

  function publishFullSnapshot(treeSnapshot, buildState, upstreamId) {
    if (!treeSnapshot || !buildState) throw new TypeError("tree and build snapshots are required");
    var identity = _digest({
      treeId: treeSnapshot.snapshotId,
      normal: (buildState.allocations.normal || []).join(","),
      ws1: (buildState.allocations.weaponSet1 || []).join(","),
      ws2: (buildState.allocations.weaponSet2 || []).join(","),
      asc: (buildState.allocations.ascendancy || []).join(","),
      inst: (buildState.allocations.instilled || []).join(","),
      ascendancy: buildState.selectedAscendancyId || "",
      budgets: buildState.budgets,
      budgetUsage: buildState.budgetUsage,
    });
    return {
      snapshotId: identity, upstreamSnapshotId: upstreamId || null,
      nodeCount: treeSnapshot.nodeCount, nodes: treeSnapshot.nodes, adjacency: treeSnapshot.adjacency,
      general: treeSnapshot.general, ascendancy: treeSnapshot.ascendancy,
      _pathIndex: treeSnapshot._pathIndex, build: buildState,
    };
  }

  return Object.freeze({
    captureTreeSnapshot: captureTreeSnapshot, captureBuildState: captureBuildState,
    publishFullSnapshot: publishFullSnapshot,
    compareNodeIds: compareNodeIds, sortedIds: sortedIds,
    idOf: idOf, nodeKind: nodeKind, isAscNode: isAscNode,
    isClassStartNode: isClassStartNode, isLegacyStartArtifactNode: isLegacyStartArtifactNode,
    isMasteryVisualNode: isMasteryVisualNode, isInstillExclusiveNode: isInstillExclusiveNode,
    isConditionalRevealNode: isConditionalRevealNode, constraintSatisfied: constraintSatisfied,
    allocatableEdgeAllowedNodes: allocatableEdgeAllowedNodes, ORDINARY_SOCKET_IDS: ORDINARY_SOCKET_IDS,
  });
});
