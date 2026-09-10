(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.plannerJewelState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";
  const INSTANCE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
  const DEFINITION_ID = /^[a-z][a-z0-9.-]*:[a-z0-9][a-z0-9._-]*$/;
  const SOCKET_ID = /^(0|[1-9][0-9]{0,255})$/;
  const LIMIT = 20000;
  const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  const clone = value => JSON.parse(JSON.stringify(value));
  function validProperties(value, depth = 0) {
    if (depth > 64 || value === null || ["string", "boolean"].includes(typeof value)) return depth <= 64;
    if (typeof value === "number") return Number.isFinite(value);
    if (Array.isArray(value)) return value.every(item => validProperties(item, depth + 1));
    if (!isRecord(value)) return false;
    return Object.keys(value).every(key => key.length <= 256 && validProperties(value[key], depth + 1));
  }
  const cmpSocket = (a, b) => BigInt(a.socketNodeId) < BigInt(b.socketNodeId) ? -1 : BigInt(a.socketNodeId) > BigInt(b.socketNodeId) ? 1 : a.socketNodeId.localeCompare(b.socketNodeId) || a.instanceId.localeCompare(b.instanceId);
  function catalogIndex(catalog) {
    const errors = []; const warnings = []; const definitions = new Map(); const sockets = new Map();
    if (!catalog || !Array.isArray(catalog.definitions) || !Array.isArray(catalog.sockets)) return { ok: false, errors: ["catalog_missing"] };
    for (const d of catalog.definitions) {
      if (!d || typeof d.definitionId !== "string" || !DEFINITION_ID.test(d.definitionId) || d.definitionId.length > 256 || !["active", "retired"].includes(d.status) || !["unsupported", "unverified"].includes(d.radius?.status) || definitions.has(d.definitionId)) warnings.push("invalid_definition_catalog");
      else definitions.set(d.definitionId, clone(d));
    }
    for (const s of catalog.sockets) {
      if (!s || typeof s.nodeId !== "string" || !SOCKET_ID.test(s.nodeId) || typeof s.officialRawId !== "string" || !s.officialRawId || !["ordinary", "ascendancy-special", "sinister", "blighted"].includes(s.category) || sockets.has(s.nodeId)) warnings.push("invalid_socket_catalog");
      else sockets.set(s.nodeId, clone(s));
    }
    return { ok: true, definitions, sockets, warnings };
  }
  function normalizeJewelState(state, catalog) {
    const index = catalogIndex(catalog); if (!index.ok) return { ok: false, errors: index.errors, state: null, inactive: [] };
    if (!state || !Array.isArray(state.instances) || !Array.isArray(state.placements) || state.instances.length > LIMIT || state.placements.length > LIMIT) return { ok: false, errors: ["invalid_jewel_state"], state: null, inactive: [] };
    const instances = []; const ids = new Set(); const inactive = [];
    for (const item of state.instances) {
      if (!item || typeof item.id !== "string" || !INSTANCE_ID.test(item.id) || typeof item.definitionId !== "string" || !DEFINITION_ID.test(item.definitionId) || item.definitionId.length > 256 || !item.properties || Array.isArray(item.properties) || typeof item.properties !== "object" || !validProperties(item.properties)) return { ok: false, errors: ["invalid_instance"], state: null, inactive: [] };
      if (ids.has(item.id)) return { ok: false, errors: ["duplicate_instance_id"], state: null, inactive: [] };
      ids.add(item.id); instances.push(clone(item)); if (!index.definitions.has(item.definitionId)) inactive.push({ type: "unknown_definition", id: item.id });
    }
    const placements = []; const pair = new Set(); const socketCounts = new Map(); const instanceCounts = new Map();
    for (const item of state.placements) {
      if (!item || typeof item.socketNodeId !== "string" || !SOCKET_ID.test(item.socketNodeId) || typeof item.instanceId !== "string" || !INSTANCE_ID.test(item.instanceId)) return { ok: false, errors: ["invalid_placement"], state: null, inactive: [] };
      const key = `${item.socketNodeId}\u0000${item.instanceId}`; if (pair.has(key)) { inactive.push({ type: "duplicate_placement", placement: clone(item) }); continue; } pair.add(key); placements.push(clone(item));
      socketCounts.set(item.socketNodeId, (socketCounts.get(item.socketNodeId) || 0) + 1); instanceCounts.set(item.instanceId, (instanceCounts.get(item.instanceId) || 0) + 1);
    }
    const activePlacements = placements.filter(p => {
      const reason = !ids.has(p.instanceId) ? "dangling" : !index.sockets.has(p.socketNodeId) ? "unknown_socket" : index.sockets.get(p.socketNodeId).category !== "ordinary" ? "special_socket" : socketCounts.get(p.socketNodeId) > 1 ? "socket_conflict" : instanceCounts.get(p.instanceId) > 1 ? "instance_conflict" : !index.definitions.has(instances.find(i => i.id === p.instanceId).definitionId) ? "unknown_definition" : null;
      if (reason) inactive.push({ type: reason, placement: clone(p) }); return !reason;
    });
    return { ok: true, errors: [], inactive, activePlacements: activePlacements.sort(cmpSocket), state: { instances: instances.sort((a,b) => a.id.localeCompare(b.id)), placements: placements.sort(cmpSocket) } };
  }
  function defaultId() { const bytes = new Uint8Array(16); if (!globalThis.crypto?.getRandomValues) throw new Error("secure_random_unavailable"); globalThis.crypto.getRandomValues(bytes); return `jwl_${Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("")}`; }
  function createInstance(state, definitionId, properties = {}, options = {}) { const next = clone(state); const makeId = options.idGenerator || defaultId; for (let n=0;n<8;n+=1) { const id=makeId(); if (!next.instances.some(x=>x.id===id)) { next.instances.push({id,definitionId,properties:clone(properties)}); return { ...normalizeJewelState(next, options.catalog), id }; } } throw new Error("instance_id_collision_limit"); }
  function equipInstance(state, socketNodeId, instanceId, options = {}) { const next=clone(state); next.placements.push({socketNodeId,instanceId}); return normalizeJewelState(next, options.catalog); }
  function replaceSocket(state, socketNodeId, instanceId, options = {}) { const next=clone(state); next.placements=next.placements.filter(p=>p.socketNodeId!==socketNodeId); next.placements.push({socketNodeId,instanceId}); return normalizeJewelState(next, options.catalog); }
  function removePlacement(state, socketNodeId, instanceId, options = {}) { const next=clone(state); next.placements=next.placements.filter(p=>!(p.socketNodeId===socketNodeId && (instanceId === undefined || p.instanceId===instanceId))); return normalizeJewelState(next, options.catalog); }
  function deleteInstance(state, instanceId, options = {}) { const next=clone(state); next.instances=next.instances.filter(x=>x.id!==instanceId); next.placements=next.placements.filter(x=>x.instanceId!==instanceId); return normalizeJewelState(next, options.catalog); }
  function equippedAt(state, socketNodeId, catalog) { const result=normalizeJewelState(state,catalog); return result.ok ? result.activePlacements.find(p=>p.socketNodeId===socketNodeId) || null : null; }
  return Object.freeze({ catalogIndex, normalizeJewelState, createInstance, equipInstance, replaceSocket, removePlacement, deleteInstance, equippedAt });
});
