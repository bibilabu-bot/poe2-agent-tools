(function initPassiveGraph(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.plannerPassiveGraph = api;
})(typeof globalThis === "object" ? globalThis : this, function passiveGraphFactory() {
  "use strict";

  function compareNodeIds(a, b) {
    const left = String(a);
    const right = String(b);
    return left < right ? -1 : left > right ? 1 : 0;
  }

  function defaultNodeId(node) {
    return String(node?.skill ?? node?._id ?? node?.id);
  }

  function createPassiveGraph(nodes, edges, options = {}) {
    if (!Array.isArray(nodes) || !Array.isArray(edges)) throw new TypeError("nodes and edges must be arrays");
    const getNodeId = options.getNodeId || defaultNodeId;
    const allowEdge = options.allowEdge || (() => true);
    if (typeof getNodeId !== "function" || typeof allowEdge !== "function") throw new TypeError("graph options must be functions");

    const byId = new Map();
    for (const node of nodes) {
      const id = String(getNodeId(node));
      if (!id || id === "undefined" || byId.has(id)) throw new TypeError(`invalid or duplicate node ID: ${id}`);
      byId.set(id, node);
    }

    const adjacency = new Map([...byId.keys()].map(id => [id, []]));
    for (const edge of edges) {
      const from = String(edge?.f);
      const to = String(edge?.t);
      const fromNode = byId.get(from);
      const toNode = byId.get(to);
      if (!fromNode || !toNode || !allowEdge(fromNode, toNode, edge)) continue;
      adjacency.get(from).push(to);
      adjacency.get(to).push(from);
    }
    for (const [id, neighbors] of adjacency) {
      adjacency.set(id, Object.freeze(neighbors.slice().sort(compareNodeIds)));
    }
    const nodeIds = Object.freeze([...byId.keys()].sort(compareNodeIds));

    return Object.freeze({
      nodeIds,
      has(id) { return byId.has(String(id)); },
      node(id) { return byId.get(String(id)); },
      neighbors(id) { return adjacency.get(String(id)) || Object.freeze([]); },
    });
  }

  function traversalOptions(graph, options) {
    if (!graph || typeof graph.node !== "function" || typeof graph.neighbors !== "function") throw new TypeError("graph is required");
    if (!options || typeof options.isEligible !== "function") throw new TypeError("isEligible predicate is required");
    const starts = [...new Set(Array.from(options.starts || [], String))].sort(compareNodeIds);
    return { starts, isEligible: options.isEligible };
  }

  function buildShortestPathIndex(graph, options) {
    const { starts, isEligible } = traversalOptions(graph, options);
    const parent = new Map();
    const queue = [];
    for (const id of starts) {
      const node = graph.node(id);
      if (!node || !isEligible(node, id)) continue;
      parent.set(id, null);
      queue.push(id);
    }
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      for (const next of graph.neighbors(current)) {
        if (parent.has(next)) continue;
        const node = graph.node(next);
        if (!node || !isEligible(node, next)) continue;
        parent.set(next, current);
        queue.push(next);
      }
    }
    return parent;
  }

  function pathFromIndex(parent, targetId, maximumNodes = parent.size + 1) {
    const target = String(targetId);
    if (!parent.has(target)) return [];
    const path = [];
    let current = target;
    for (let count = 0; current !== null && count <= maximumNodes; count += 1) {
      path.push(current);
      current = parent.get(current);
    }
    return current === null ? path : [];
  }

  function shortestEligiblePath(graph, options) {
    const target = String(options?.targetId);
    if (!graph.has(target) || !options?.isEligible?.(graph.node(target), target)) return [];
    const parent = buildShortestPathIndex(graph, options);
    return pathFromIndex(parent, target, graph.nodeIds.length + 1);
  }

  function reachableEligibleIds(graph, options) {
    return new Set(buildShortestPathIndex(graph, options).keys());
  }

  return Object.freeze({
    buildShortestPathIndex,
    compareNodeIds,
    createPassiveGraph,
    pathFromIndex,
    reachableEligibleIds,
    shortestEligiblePath,
  });
});
