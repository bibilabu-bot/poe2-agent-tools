"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  captureBuildState, idOf, nodeKind, isAscNode, isClassStartNode,
  isLegacyStartArtifactNode, isMasteryVisualNode,
  isInstillExclusiveNode, compareNodeIds, sortedIds,
  ORDINARY_SOCKET_IDS,
} = require("../renderer/tree-snapshot.js");

test("idOf returns string from skill or _id", () => {
  assert.equal(idOf({skill: 123}), "123");
  assert.equal(idOf({_id: "456"}), "456");
  assert.equal(idOf({}), "undefined");
});

test("nodeKind returns kind or small default", () => {
  assert.equal(nodeKind({kind: "notable"}), "notable");
  assert.equal(nodeKind({}), "small");
});

test("isAscNode detects ascendancy field", () => {
  assert.equal(isAscNode({asc: "Asc_Invoker"}), true);
  assert.equal(isAscNode({}), false);
});

test("isClassStartNode detects class start indicators", () => {
  assert.equal(isClassStartNode({kind: "classstart"}), true);
  assert.equal(isClassStartNode({classesStart: [1]}), true);
  assert.equal(isClassStartNode({classStartIndex: [6]}), true);
  assert.equal(isClassStartNode({kind: "small"}), false);
});

test("isLegacyStartArtifact rejects legacy named starts and integer-labeled classstarts", () => {
  assert.equal(isLegacyStartArtifactNode({name: "Marauder"}), true);
  assert.equal(isLegacyStartArtifactNode({name: "Six"}), true);
  assert.equal(isLegacyStartArtifactNode({name: "1", kind: "classstart", group: null}), true);
  assert.equal(isLegacyStartArtifactNode({name: "Warrior"}), false);
});

test("isMasteryVisualNode", () => {
  assert.equal(isMasteryVisualNode({kind: "mastery"}), true);
  assert.equal(isMasteryVisualNode({isOnlyImage: true}), true);
  assert.equal(isMasteryVisualNode({kind: "small"}), false);
});

test("isInstillExclusiveNode matches known set", () => {
  assert.equal(isInstillExclusiveNode({name: "Charity's Reach"}), true);
  assert.equal(isInstillExclusiveNode({name: "Grasp of the Elements"}), true);
  assert.equal(isInstillExclusiveNode({name: "普通节点"}), false);
});

test("compareNodeIds sorts by string code-unit order", () => {
  assert.equal(compareNodeIds("1", "2"), -1);
  assert.equal(compareNodeIds("10", "2"), -1); // string: "10" < "2"
  assert.equal(compareNodeIds("2", "1"), 1);
  assert.equal(compareNodeIds("1", "1"), 0);
});

test("sortedIds sorts and deduplicates", () => {
  assert.deepEqual(sortedIds(["3", "1", "2"]), ["1", "2", "3"]);
  assert.deepEqual(sortedIds(["a", "A"]), ["A", "a"]);
});

test("ORDINARY_SOCKET_IDS contains exactly twelve production IDs", () => {
  assert.deepEqual([...ORDINARY_SOCKET_IDS].sort(compareNodeIds),
                   ["21984","2491","26196","26725","32763","46882","54127","55190","60735","61419","61834","7960"]);
});

test("captureBuildState extracts normal and ascendancy allocations separately", () => {
  const state = {
    allocated: new Set(["1","2","3"]),
    weaponSet1Allocated: new Set(["10","20"]),
    weaponSet2Allocated: new Set([]),
    ascAllocated: new Set(["100"]),
    instillAllocated: new Set([]),
    maxPoints: 122, maxWeaponPoints: 24, maxAscPoints: 8,
    baseClassName: "Warrior", selectedAscendancyId: null,
    classStartId: "0", ascStartId: null,
    ascendancyOptions: [], camera: {x:0,y:0,scale:0.04},
    showAsc: false, showLockedConditional: false, showInstillOnGraph: false, showSmall: true,
    weaponMode: null,
  };
  const bs = captureBuildState(state);
  assert.deepEqual(bs.allocations.normal.sort(compareNodeIds), ["1","2","3"]);
  assert.deepEqual(bs.allocations.weaponSet1.sort(compareNodeIds), ["10","20"]);
  assert.deepEqual(bs.allocations.weaponSet2, []);
  assert.deepEqual(bs.allocations.ascendancy.sort(compareNodeIds), ["100"]);
  assert.equal(bs.budgets.passive, 122);
  assert.equal(bs.budgets.weaponSet, 24);
  assert.equal(bs.budgets.ascendancy, 8);
  assert.equal(bs.baseClassName, "Warrior");
});

test("captureBuildState produces deterministic sorted arrays", () => {
  const state = {
    allocated: new Set(["10","5","20"]),
    weaponSet1Allocated: new Set([]),
    weaponSet2Allocated: new Set([]),
    ascAllocated: new Set([]),
    instillAllocated: new Set([]),
    maxPoints: 0, maxWeaponPoints: 0, maxAscPoints: 0, selectedAscendancyId: null,
    classStartId: null, ascStartId: null, ascendancyOptions: [],
    camera: null, showAsc: false, showLockedConditional: false, showInstillOnGraph: false, showSmall: true,
    weaponMode: null,
  };
  const bs = captureBuildState(state);
  assert.deepEqual(bs.allocations.normal, ["10","20","5"]);
});