const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildShortestPathIndex,
  createPassiveGraph,
  pathFromIndex,
  reachableEligibleIds,
  shortestEligiblePath,
} = require("../renderer/passive-graph.js");

const eligible = () => true;
const node = (id, extra = {}) => ({ id: String(id), ...extra });
const graph = (nodes, edges, options) => createPassiveGraph(nodes, edges, { getNodeId: item => item.id, ...options });

test("builds stable string-ID adjacency while preserving duplicate and self-edge degree", () => {
  const value = graph([node("a"), node("b"), node("c")], [
    { f: "a", t: "b" },
    { f: "b", t: "a" },
    { f: "a", t: "a" },
    { f: "a", t: "missing" },
  ]);
  assert.deepEqual(value.nodeIds, ["a", "b", "c"]);
  assert.deepEqual(value.neighbors("a"), ["a", "a", "b", "b"]);
  assert.deepEqual(value.neighbors("b"), ["a", "a"]);
  assert.deepEqual(value.neighbors("c"), []);
  assert.deepEqual(value.neighbors("missing"), []);
});

test("finds ordinary target-to-active shortest paths through cycles", () => {
  const value = graph([node("1"), node("2"), node("3"), node("4")], [
    { f: "1", t: "2" }, { f: "2", t: "3" }, { f: "3", t: "1" }, { f: "3", t: "4" },
  ]);
  assert.deepEqual(shortestEligiblePath(value, { starts: ["1"], targetId: "4", isEligible: eligible }), ["4", "3", "1"]);
});

test("uses explicit ascendancy eligibility and rejects other ascendancies", () => {
  const value = graph([
    node("start", { asc: "A" }), node("a", { asc: "A" }), node("b", { asc: "B" }),
  ], [{ f: "start", t: "a" }, { f: "a", t: "b" }]);
  const selectedAscendancy = item => item.asc === "A";
  assert.deepEqual(shortestEligiblePath(value, { starts: ["start"], targetId: "a", isEligible: selectedAscendancy }), ["a", "start"]);
  assert.deepEqual(shortestEligiblePath(value, { starts: ["start"], targetId: "b", isEligible: selectedAscendancy }), []);
});

test("uses general plus weapon-set allocations as multiple starts", () => {
  const value = graph([node("general"), node("ws"), node("target"), node("jewel", { kind: "jewel" })], [
    { f: "general", t: "ws" }, { f: "ws", t: "target" }, { f: "target", t: "jewel" },
  ]);
  const weaponEligible = item => item.kind !== "jewel";
  assert.deepEqual(shortestEligiblePath(value, { starts: ["general", "ws"], targetId: "target", isEligible: weaponEligible }), ["target", "ws"]);
  assert.deepEqual(shortestEligiblePath(value, { starts: ["general", "ws"], targetId: "jewel", isEligible: weaponEligible }), []);
});

test("hidden and conditional nodes are controlled only by the supplied predicate", () => {
  const nodes = [node("start"), node("hidden", { locked: true }), node("target")];
  const value = graph(nodes, [{ f: "start", t: "hidden" }, { f: "hidden", t: "target" }]);
  const unlocked = item => !item.locked;
  assert.deepEqual(shortestEligiblePath(value, { starts: ["start"], targetId: "target", isEligible: unlocked }), []);
  nodes[1].locked = false;
  assert.deepEqual(shortestEligiblePath(value, { starts: ["start"], targetId: "target", isEligible: unlocked }), ["target", "hidden", "start"]);
});

test("returns empty paths for disconnected or unreachable targets", () => {
  const value = graph([node("start"), node("island"), node("blocked", { blocked: true })], [{ f: "start", t: "blocked" }, { f: "blocked", t: "island" }]);
  assert.deepEqual(shortestEligiblePath(value, { starts: ["start"], targetId: "island", isEligible: item => !item.blocked }), []);
  assert.deepEqual(shortestEligiblePath(value, { starts: ["missing"], targetId: "start", isEligible: eligible }), []);
  assert.deepEqual(shortestEligiblePath(value, { starts: ["start"], targetId: "missing", isEligible: eligible }), []);
});

test("chooses equal-length paths by code-unit-sorted starts then neighbors", () => {
  const value = graph([node("z"), node("a"), node("x"), node("y"), node("target")], [
    { f: "z", t: "x" }, { f: "x", t: "target" }, { f: "a", t: "y" }, { f: "y", t: "target" },
  ]);
  assert.deepEqual(shortestEligiblePath(value, { starts: ["z", "a"], targetId: "target", isEligible: eligible }), ["target", "y", "a"]);

  const tied = graph([node("start"), node("b"), node("c"), node("target")], [
    { f: "start", t: "c" }, { f: "c", t: "target" }, { f: "start", t: "b" }, { f: "b", t: "target" },
  ]);
  assert.deepEqual(shortestEligiblePath(tied, { starts: ["start"], targetId: "target", isEligible: eligible }), ["target", "b", "start"]);
});

test("path results do not depend on node, edge, or start input order", () => {
  const nodes = [node("start"), node("b"), node("c"), node("target")];
  const edges = [{ f: "start", t: "c" }, { f: "c", t: "target" }, { f: "start", t: "b" }, { f: "b", t: "target" }];
  const forward = graph(nodes, edges);
  const reversed = graph([...nodes].reverse(), [...edges].reverse());
  const options = { starts: ["start"], targetId: "target", isEligible: eligible };
  assert.deepEqual(shortestEligiblePath(forward, options), shortestEligiblePath(reversed, { ...options, starts: [...options.starts].reverse() }));
});

test("builds reusable indexes and reachable sets for allocation pruning", () => {
  const value = graph([node("a"), node("b"), node("c"), node("island")], [{ f: "a", t: "b" }, { f: "b", t: "c" }]);
  const parent = buildShortestPathIndex(value, { starts: ["a"], isEligible: eligible });
  assert.deepEqual(pathFromIndex(parent, "c"), ["c", "b", "a"]);
  assert.deepEqual([...reachableEligibleIds(value, { starts: ["a"], isEligible: eligible })].sort(), ["a", "b", "c"]);
});

test("does not mutate caller-owned nodes, edges, options, or catalogs", () => {
  const nodes = [node("2", { metadata: { hidden: false } }), node("1")];
  const edges = [{ f: "2", t: "1", metadata: { curved: true } }];
  const options = { getNodeId: item => item.id, allowEdge: () => true };
  const beforeNodes = structuredClone(nodes);
  const beforeEdges = structuredClone(edges);
  const value = createPassiveGraph(nodes, edges, options);
  shortestEligiblePath(value, { starts: new Set(["2"]), targetId: "1", isEligible: eligible });
  assert.deepEqual(nodes, beforeNodes);
  assert.deepEqual(edges, beforeEdges);
  assert.equal(options.getNodeId(nodes[0]), "2");
});

test("exports a browser global without platform dependencies", () => {
  const fs = require("node:fs");
  const vm = require("node:vm");
  const source = fs.readFileSync(require.resolve("../renderer/passive-graph.js"), "utf8");
  const context = { globalThis: {} };
  vm.runInNewContext(source, context);
  assert.equal(typeof context.globalThis.plannerPassiveGraph.createPassiveGraph, "function");
});
