const assert = require("node:assert/strict");
const test = require("node:test");

// Minimal reference copy of planner.js's pre-extraction BFS. These fixtures
// freeze category behavior before the production implementation is replaced.
function legacyAdjacency(nodes, edges, allowEdge = () => true) {
  const byId = new Map(nodes.map(node => [String(node.id), node]));
  const adjacency = new Map(nodes.map(node => [String(node.id), []]));
  for (const edge of edges) {
    const a = String(edge.f);
    const b = String(edge.t);
    if (!byId.has(a) || !byId.has(b) || !allowEdge(byId.get(a), byId.get(b))) continue;
    adjacency.get(a).push(b);
    adjacency.get(b).push(a);
  }
  return { byId, adjacency };
}

function legacyShortest(graph, starts, targetId, canTraverse) {
  const target = graph.byId.get(String(targetId));
  if (!target || !canTraverse(target)) return [];
  const queue = [];
  const parent = new Map();
  for (const id of starts) {
    const node = graph.byId.get(String(id));
    if (!node || !canTraverse(node)) continue;
    parent.set(String(id), null);
    queue.push(String(id));
  }
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    for (const next of graph.adjacency.get(current) || []) {
      if (parent.has(next)) continue;
      const node = graph.byId.get(next);
      if (!canTraverse(node)) continue;
      parent.set(next, current);
      if (next === String(targetId)) {
        const path = [];
        for (let id = next; id !== null; id = parent.get(id)) path.push(id);
        return path;
      }
      queue.push(next);
    }
  }
  return [];
}

test("characterizes ordinary and disconnected planner paths", () => {
  const graph = legacyAdjacency(
    [{ id: "start" }, { id: "middle" }, { id: "target" }, { id: "island" }],
    [{ f: "start", t: "middle" }, { f: "middle", t: "target" }],
  );
  assert.deepEqual(legacyShortest(graph, new Set(["start"]), "target", () => true), ["target", "middle", "start"]);
  assert.deepEqual(legacyShortest(graph, new Set(["start"]), "island", () => true), []);
});

test("characterizes selected-ascendancy traversal restriction", () => {
  const nodes = [
    { id: "asc-start", asc: "Mercenary1" },
    { id: "asc-node", asc: "Mercenary1" },
    { id: "other-asc", asc: "Mercenary2" },
  ];
  const graph = legacyAdjacency(nodes, [
    { f: "asc-start", t: "asc-node" },
    { f: "asc-node", t: "other-asc" },
  ]);
  const selected = node => node?.asc === "Mercenary1";
  assert.deepEqual(legacyShortest(graph, ["asc-start"], "asc-node", selected), ["asc-node", "asc-start"]);
  assert.deepEqual(legacyShortest(graph, ["asc-start"], "other-asc", selected), []);
});

test("characterizes weapon-set paths from general plus set-specific starts", () => {
  const nodes = [
    { id: "general" },
    { id: "ws-existing" },
    { id: "target" },
    { id: "jewel", kind: "jewel" },
  ];
  const graph = legacyAdjacency(nodes, [
    { f: "general", t: "ws-existing" },
    { f: "ws-existing", t: "target" },
    { f: "target", t: "jewel" },
  ]);
  const weaponEligible = node => node && node.kind !== "jewel";
  assert.deepEqual(legacyShortest(graph, ["general", "ws-existing"], "target", weaponEligible), ["target", "ws-existing"]);
  assert.deepEqual(legacyShortest(graph, ["general", "ws-existing"], "jewel", weaponEligible), []);
});

test("characterizes locked and unlocked conditional-node traversal", () => {
  const nodes = [{ id: "start" }, { id: "conditional", locked: true }, { id: "target" }];
  const graph = legacyAdjacency(nodes, [
    { f: "start", t: "conditional" },
    { f: "conditional", t: "target" },
  ]);
  assert.deepEqual(legacyShortest(graph, ["start"], "target", node => !node.locked), []);
  nodes[1].locked = false;
  assert.deepEqual(legacyShortest(graph, ["start"], "target", node => !node.locked), ["target", "conditional", "start"]);
});
