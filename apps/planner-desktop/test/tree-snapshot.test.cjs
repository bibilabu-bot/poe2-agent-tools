"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  captureTreeSnapshot, captureBuildState, publishFullSnapshot,
  idOf, nodeKind, isAscNode, isClassStartNode,
  isLegacyStartArtifactNode, isMasteryVisualNode,
  isInstillExclusiveNode, compareNodeIds, sortedIds,
  ORDINARY_SOCKET_IDS,
} = require("../renderer/tree-snapshot.js");
const { createTreeSnapshotProvider } = require("../electron/tree-tools.cjs");

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

test("ascendancy usage excludes every zero-cost ascendancy start artifact", () => {
  const state = {
    nodes:[{skill:"a",kind:"ascstart"},{skill:"b",kind:"ascstart"},{skill:"c",kind:"notable"},{skill:"d",kind:"small"}],
    allocated:new Set(), weaponSet1Allocated:new Set(), weaponSet2Allocated:new Set(),
    ascAllocated:new Set(["a","b","c","d"]), instillAllocated:new Set(), ascStartId:"a",
    maxPoints:123,maxWeaponPoints:24,maxAscPoints:8,selectedAscendancyId:"Gemling",ascendancyOptions:[],
  };
  assert.equal(captureBuildState(state).budgetUsage.ascendancy, 2);
});

test("ascendancy usage excludes multiple-choice effects", () => {
  const state = {
    nodes:[{skill:"start",kind:"ascstart"},{skill:"parent",kind:"notable"},{skill:"choice",kind:"asc",isMultipleChoiceOption:true}],
    allocated:new Set(), weaponSet1Allocated:new Set(), weaponSet2Allocated:new Set(),
    ascAllocated:new Set(["start","parent","choice"]), instillAllocated:new Set(), ascStartId:"start",
    maxPoints:123,maxWeaponPoints:24,maxAscPoints:8,selectedAscendancyId:"Mercenary3",ascendancyOptions:[],
  };
  assert.equal(captureBuildState(state).budgetUsage.ascendancy, 1);
});

test("complete catalog ignores canvas filters and publishes node 54814 with every Chinese stat", () => {
  const nodes = [
    {skill:"1", name:"职业起点", kind:"classstart", classesStart:[0], stats:[], x:0, y:0},
    {skill:"54814", name:"Heart of Flame", localizedName:"烈焰之心", kind:"small",
      stats:["12% increased Fire Damage", "+5% to Fire Resistance", "3% chance to Ignite on Hit"],
      localizedStats:["造成的火焰伤害提高 12%", "+5% 火焰抗性", "击中时有 3% 几率点燃"], x:1, y:1},
    {skill:"9", name:"可灌注节点", kind:"instill", stats:["法术伤害提高 7%"], x:2, y:2},
  ];
  const state = {nodes, edges:[{f:"1",t:"54814"},{f:"54814",t:"9"}], allocated:new Set(["1"]),
    weaponSet1Allocated:new Set(), weaponSet2Allocated:new Set(), ascAllocated:new Set(), instillAllocated:new Set(),
    classStartId:"1", selectedAscendancyId:null, ascendancyOptions:[], showSmall:false, showInstillOnGraph:false};
  const tree = captureTreeSnapshot(state);
  const build = captureBuildState(state);
  const full = publishFullSnapshot(tree, build, "upstream-test");
  const target = full.nodes.find(node => node.id === "54814");
  assert.equal(full.nodeCount, 3);
  assert.equal(target.name, "烈焰之心");
  assert.equal(target.englishName, "Heart of Flame");
  assert.deepEqual(target.stats, nodes[1].localizedStats);
  assert.ok(full.nodes.some(node => node.id === "9"));
});

test("snapshot identity changes for budgets and allocations while identical input is stable", () => {
  const tree = {snapshotId:"tree-a", nodeCount:1, nodes:[{id:"1"}], adjacency:{"1":[]}, general:{}, ascendancy:null, _pathIndex:{}};
  const base = {selectedAscendancyId:null, budgets:{passive:100,weaponSet:24,ascendancy:8}, budgetUsage:{normal:0},
    allocations:{normal:[],weaponSet1:[],weaponSet2:[],ascendancy:[],instilled:[]}};
  const first = publishFullSnapshot(tree, base, "upstream");
  assert.equal(first.snapshotId, publishFullSnapshot(tree, structuredClone(base), "upstream").snapshotId);
  assert.notEqual(first.snapshotId, publishFullSnapshot(tree, {...base,budgets:{...base.budgets,passive:101}}, "upstream").snapshotId);
  assert.notEqual(first.snapshotId, publishFullSnapshot(tree, {...base,allocations:{...base.allocations,normal:["1"]}}, "upstream").snapshotId);
});

test("main-process provider accepts more than the old 2400-node catalog without truncation", async () => {
  const nodes = Array.from({length:2401}, (_, index) => ({id:String(index + 1), name:`节点 ${index + 1}`, stats:[], kind:"small", x:index, y:0}));
  const snapshot = await createTreeSnapshotProvider(null, "upstream")({nodes,edges:[],allocated:[],weaponSet1Allocated:[],
    weaponSet2Allocated:[],ascAllocated:[],instillAllocated:[],maxPoints:122,maxWeaponPoints:24,maxAscPoints:8,
    classStartId:null,selectedAscendancyId:null,ascendancyOptions:[]});
  assert.equal(snapshot.nodeCount, 2401);
  assert.ok(snapshot.nodes.some(node => node.id === "2401"));
  assert.equal(snapshot._error, undefined);
});
