"use strict";
// Main-process tree snapshot builder.
// Reads canonical tree data (already cached) and combines with Build state
// from the renderer to produce a narrow snapshot for Python tree tools.
const path = require("node:path");
const fs = require("node:fs");

let _snapshotCache = null;

function _readCached(name, readFn) {
  // readFn: (kind, name) → Promise<Response>
  return readFn("data", name).then(r => {
    if (!r.ok) throw new Error(`tree data unavailable: ${name} HTTP ${r.status}`);
    return r.json();
  });
}

async function _captureSnapshot(readResourceFn, snapshotId, buildState) {
  // readResourceFn: (kind, name) => Promise<Response>
  // Returns the minimal snapshot for Python tree tools.
  const [official] = await Promise.all([
    _readCached("official-data.json", readResourceFn),
  ]);
  // Build state comes from the renderer (Planner allocations).
  return {
    snapshotId: `tree-${snapshotId || "unknown"}`,
    nodeCount: Object.keys(official.nodes || {}).length,
    nodes: _compactNodes(official, buildState),
    adjacency: _buildAdjacency(official, buildState),
    build: {
      baseClassName: buildState.baseClassName || null,
      selectedAscendancyId: buildState.selectedAscendancyId || null,
      classStartId: buildState.classStartId || null,
      budgets: {
        passive: buildState.maxPoints || 0,
        weaponSet: buildState.maxWeaponPoints || 0,
        ascendancy: buildState.maxAscPoints || 0,
      },
      budgetUsage: {
        normal: buildState.allocated?.length || 0,
        weaponSet1: buildState.weaponSet1Allocated?.length || 0,
        weaponSet2: buildState.weaponSet2Allocated?.length || 0,
        ascendancy: buildState.ascAllocated?.length || 0,
        instilled: buildState.instillAllocated?.length || 0,
      },
      allocations: {
        normal: buildState.allocated || [],
        weaponSet1: buildState.weaponSet1Allocated || [],
        weaponSet2: buildState.weaponSet2Allocated || [],
        ascendancy: buildState.ascAllocated || [],
        instilled: buildState.instillAllocated || [],
      },
      ascendancyOptions: buildState.ascendancyOptions || [],
    },
  };
}

function _compactNodes(official, buildState) {
  const nodes = [];
  const allocatedNormal = new Set(buildState.allocated || []);
  const allocatedWS1 = new Set(buildState.weaponSet1Allocated || []);
  const allocatedWS2 = new Set(buildState.weaponSet2Allocated || []);
  const allocatedAsc = new Set(buildState.ascAllocated || []);
  const allocatedInstill = new Set(buildState.instillAllocated || []);

  for (const [rawId, raw] of Object.entries(official.nodes || {})) {
    if (rawId === "root") continue;
    const id = String(rawId);
    const kind = _nodeKind(raw);
    // Only include visible, passive-tree nodes (not mastery visuals, not pure images)
    if (kind === "mastery" || raw.isOnlyImage) continue;
    if (kind === "classstart" && !raw.classesStart && !raw.classStartIndex) continue;

    const allocatedCategories = [];
    if (allocatedNormal.has(id)) allocatedCategories.push("normal");
    if (allocatedWS1.has(id)) allocatedCategories.push("weaponSet1");
    if (allocatedWS2.has(id)) allocatedCategories.push("weaponSet2");
    if (allocatedAsc.has(id)) allocatedCategories.push("ascendancy");
    if (allocatedInstill.has(id)) allocatedCategories.push("instilled");

    nodes.push({
      id,
      name: String(raw.name || ""),
      stats: Array.isArray(raw.stats) ? raw.stats.slice(0, 32) : [],
      statsTotal: Array.isArray(raw.stats) ? raw.stats.length : 0,
      kind,
      x: Number.isFinite(Number(raw.x)) ? Number(raw.x) : 0,
      y: Number.isFinite(Number(raw.y)) ? Number(raw.y) : 0,
      asc: raw.ascendancyId || raw.asc || null,
      isJewelSocket: Boolean(raw.isJewelSocket),
      isKeystone: Boolean(raw.isKeystone),
      isNotable: Boolean(raw.isNotable),
      isAscendancy: Boolean(raw.ascendancyId || raw.asc),
      isClassStart: kind === "classstart",
      allocated: allocatedCategories.length > 0,
      allocationCategories: allocatedCategories,
    });
  }

  return nodes.sort((a, b) => String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
}

function _buildAdjacency(official, buildState) {
  const adj = {};
  const nodeIds = new Set(Object.keys(official.nodes || {}));
  const edges = official.edges || [];
  const allocatedNormal = new Set(buildState.allocated || []);

  for (const id of Object.keys(official.nodes || {})) {
    if (id === "root") continue;
    adj[id] = [];
  }

  for (const edge of edges) {
    const from = String(edge.f);
    const to = String(edge.t);
    if (nodeIds.has(from) && nodeIds.has(to)) {
      if (adj[from]) adj[from].push(to);
      if (adj[to]) adj[to].push(from);
    }
  }

  // Sort neighbors for determinism
  for (const id of Object.keys(adj)) {
    adj[id].sort((a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
    adj[id] = Object.freeze([...new Set(adj[id])]);
  }

  return adj;
}

function _nodeKind(raw) {
  if (raw.kind) return raw.kind;
  if (raw.isKeystone) return "keystone";
  if (raw.isNotable) return "notable";
  if (raw.isJewelSocket) return "jewel";
  if (Array.isArray(raw.classesStart) || Array.isArray(raw.classStartIndex)) return "classstart";
  return "small";
}

function _buildSnapshot(req, buildState) {
  // req: the resource reader from main.cjs (localResourceResponse)
  return _captureSnapshot(req, buildState.snapshotId || "build", buildState);
}

function createTreeSnapshotProvider(localResourceResponse, upstreamSnapshotId) {
  return async function(buildState) {
    if (!buildState) return null;
    // Use a simple inline reader since we're in main process context
    const reader = async (kind, name) => {
      const res = await localResourceResponse(kind, name);
      return { ok: res.ok, json: () => res.json() };
    };
    return _captureSnapshot(reader, upstreamSnapshotId, buildState);
  };
}

module.exports = { createTreeSnapshotProvider };