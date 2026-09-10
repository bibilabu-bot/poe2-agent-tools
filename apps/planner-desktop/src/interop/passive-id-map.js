(function initPassiveIdMap(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.plannerPassiveIdMap = api;
})(typeof globalThis === "object" ? globalThis : this, function passiveIdMapFactory() {
  "use strict";

  const compare = (a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const numericId = value => (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) ? value : (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : null);
  const result = (status, extra = {}) => Object.freeze({ status, ...extra });

  function createPassiveIdMap(officialTree, options = {}) {
    const nodes = officialTree && typeof officialTree.nodes === "object" && officialTree.nodes !== null ? officialTree.nodes : null;
    const classify = typeof options.classifyNumeric === "function" ? options.classifyNumeric : () => "unclassified";
    const forward = new Map();
    const reverse = new Map();
    const malformed = [];
    if (nodes) for (const key of Object.keys(nodes).sort(compare)) {
      const id = numericId(key);
      const node = nodes[key];
      if (!id || !node || typeof node !== "object") { malformed.push(String(key)); continue; }
      const rawId = typeof node.id === "string" && node.id ? node.id : null;
      if (!rawId) { forward.set(id, null); continue; }
      forward.set(id, rawId);
      const matches = reverse.get(rawId) || [];
      matches.push(id); reverse.set(rawId, matches);
    }
    for (const matches of reverse.values()) matches.sort(compare);
    const frozenReverse = new Map([...reverse].map(([raw, ids]) => [raw, Object.freeze(ids.slice())]));
    function numericToOfficial(value) {
      const id = numericId(value);
      if (!id) return result("invalid", { input: value });
      if (!forward.has(id)) return result("missing", { numericId: id });
      const rawId = forward.get(id);
      return rawId ? result("mapped", { numericId: id, officialId: rawId }) : result("missing", { numericId: id, reason: "node_has_no_official_id" });
    }
    function officialToNumeric(rawId) {
      if (typeof rawId !== "string" || !rawId) return result("invalid", { input: rawId });
      const ids = frozenReverse.get(rawId);
      if (!ids) return result("missing", { officialId: rawId });
      return ids.length === 1 ? result("mapped", { officialId: rawId, numericId: ids[0] }) : result("ambiguous", { officialId: rawId, numericIds: ids });
    }
    function classifyNumeric(value) {
      const id = numericId(value);
      if (!id) return result("invalid", { input: value });
      if (!forward.has(id)) return result("missing", { numericId: id });
      return result("mapped", { numericId: id, classification: classify(id, nodes[id]) });
    }
    function getMappingReport() {
      const mapped = [...forward].filter(([, raw]) => raw).map(([id, raw]) => ({ numericId: id, officialId: raw })).sort((a,b) => compare(a.numericId,b.numericId));
      const missing = [...forward].filter(([, raw]) => !raw).map(([id]) => id).sort(compare);
      const duplicates = [...frozenReverse].filter(([, ids]) => ids.length > 1).map(([officialId, numericIds]) => ({ officialId, numericIds })).sort((a,b) => compare(a.officialId,b.officialId));
      return Object.freeze({ nodeCount: forward.size, mappedCount: mapped.length, missingOfficialIdCount: missing.length, malformedNodeKeys: Object.freeze(malformed.slice().sort(compare)), missingNumericIds: Object.freeze(missing), duplicateOfficialIds: Object.freeze(duplicates) });
    }
    return Object.freeze({ numericToOfficial, officialToNumeric, classifyNumeric, getMappingReport });
  }
  return Object.freeze({ createPassiveIdMap });
});
