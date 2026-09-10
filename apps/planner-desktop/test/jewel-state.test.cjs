const test = require("node:test");
const assert = require("node:assert/strict");
const catalog = require("../src/jewels/catalog.js");
const jewels = require("../renderer/jewel-state.js");
const empty = () => ({ instances: [], placements: [] });

test("the reviewed catalog contains six definitions and twelve production ordinary sockets", () => {
  const indexed = jewels.catalogIndex(catalog); assert.equal(indexed.ok, true);
  assert.equal(catalog.definitions.length, 6); assert.equal(catalog.sockets.length, 12);
  assert.deepEqual(catalog.definitions.map(x => x.definitionId), ["poe2-jewel:unique-voices","poe2-jewel:unique-from-nothing","poe2-jewel:unique-controlled-metamorphosis","poe2-jewel:unique-the-adorned","poe2-jewel:unique-flesh-crucible","poe2-jewel:unique-against-the-darkness"]);
  assert.deepEqual(catalog.sockets.map(x => x.nodeId), ["2491","7960","21984","26196","26725","32763","46882","54127","55190","60735","61419","61834"]);
  assert.ok(catalog.sockets.every(x => x.category === "ordinary" && x.officialRawId.startsWith("jewel_slot")));
  assert.ok(catalog.definitions.every(x => ["unsupported","unverified"].includes(x.radius.status)));
});

test("creation uses injected IDs, retries collisions, and does not mutate caller state", () => {
  const state = { instances: [{ id: "jwl_taken", definitionId: catalog.definitions[0].definitionId, properties: {} }], placements: [] }; const before=structuredClone(state); let n=0;
  const result=jewels.createInstance(state,catalog.definitions[1].definitionId,{roll:1},{catalog,idGenerator:()=>++n===1?"jwl_taken":"jwl_new"});
  assert.equal(result.id,"jwl_new"); assert.deepEqual(state,before); assert.equal(result.state.instances.length,2);
});

test("equip, replace, remove placement and delete instance have precise ownership", () => {
  let state={instances:[{id:"jwl_a",definitionId:catalog.definitions[0].definitionId,properties:{}},{id:"jwl_b",definitionId:catalog.definitions[1].definitionId,properties:{}}],placements:[]};
  state=jewels.equipInstance(state,"2491","jwl_a",{catalog}).state; assert.equal(jewels.equippedAt(state,"2491",catalog).instanceId,"jwl_a");
  state=jewels.replaceSocket(state,"2491","jwl_b",{catalog}).state; assert.equal(jewels.equippedAt(state,"2491",catalog).instanceId,"jwl_b");
  state=jewels.removePlacement(state,"2491",undefined,{catalog}).state; assert.equal(state.instances.length,2); assert.equal(state.placements.length,0);
  state=jewels.equipInstance(state,"2491","jwl_b",{catalog}).state; state=jewels.deleteInstance(state,"jwl_b",{catalog}).state; assert.equal(state.instances.length,1); assert.equal(state.placements.length,0);
});

test("unknown definitions, sockets, special sockets, dangling and conflicting placements stay inactive", () => {
  const extended={definitions:catalog.definitions,sockets:[...catalog.sockets,{nodeId:"17788",officialRawId:"special",category:"ascendancy-special"}]};
  const state={instances:[{id:"jwl_a",definitionId:"partner:new",properties:{future:{v:1}}},{id:"jwl_b",definitionId:catalog.definitions[0].definitionId,properties:{}}],placements:[
    {socketNodeId:"999",instanceId:"jwl_a",x:1},{socketNodeId:"17788",instanceId:"jwl_b"},{socketNodeId:"2491",instanceId:"missing"},{socketNodeId:"2491",instanceId:"jwl_b"},{socketNodeId:"7960",instanceId:"jwl_b"}
  ]};
  const result=jewels.normalizeJewelState(state,extended); assert.equal(result.ok,true); assert.equal(result.activePlacements.length,0); assert.ok(result.inactive.length>=5);
});

test("invalid catalogs and duplicate instances are fatal while duplicate placement is normalized", () => {
  assert.ok(jewels.catalogIndex({definitions:[],sockets:[{nodeId:"100",officialRawId:"x",category:"ordinary"},{nodeId:"100",officialRawId:"x",category:"ordinary"}]}).warnings.length);
  assert.equal(jewels.normalizeJewelState({instances:[{id:"jwl_a",definitionId:"poe2-jewel:x",properties:{}},{id:"jwl_a",definitionId:"poe2-jewel:x",properties:{}}],placements:[]},catalog).ok,false);
  const result=jewels.normalizeJewelState({instances:[{id:"jwl_a",definitionId:catalog.definitions[0].definitionId,properties:{}}],placements:[{socketNodeId:"2491",instanceId:"jwl_a"},{socketNodeId:"2491",instanceId:"jwl_a"}]},catalog); assert.equal(result.state.placements.length,1);
});

test("properties enforce key, depth, and cardinality limits", () => {
  const longKey = "x".repeat(257);
  assert.equal(jewels.normalizeJewelState({instances:[{id:"jwl_a",definitionId:catalog.definitions[0].definitionId,properties:{[longKey]:1}}],placements:[]},catalog).ok,false);
  let deep={}; let cursor=deep; for(let i=0;i<65;i+=1){cursor.x={};cursor=cursor.x;}
  assert.equal(jewels.normalizeJewelState({instances:[{id:"jwl_a",definitionId:catalog.definitions[0].definitionId,properties:deep}],placements:[]},catalog).ok,false);
  assert.equal(jewels.normalizeJewelState({instances:Array.from({length:20001},(_,i)=>({id:`jwl_${i}`,definitionId:catalog.definitions[0].definitionId,properties:{}})),placements:[]},catalog).ok,false);
});

test("jewel lifecycle helpers recognize instance-only and placement-only state and clear both", () => {
  const states = [
    { instances: [{ id: "jwl_a" }], placements: [] },
    { instances: [], placements: [{ socketNodeId: "999", instanceId: "missing", future: true }] },
    { instances: [{ id: "jwl_a" }], placements: [{ socketNodeId: "2491", instanceId: "jwl_a" }] },
  ];
  assert.ok(states.every(state => jewels.hasJewelState(state)));
  assert.equal(jewels.hasJewelState(jewels.emptyJewelState()), false);
  for (const state of states) {
    const before = structuredClone(state);
    assert.deepEqual(jewels.clearJewelState(state), { instances: [], placements: [] });
    assert.deepEqual(state, before);
  }
});

test("duplicate placement canonical choice is permutation-invariant and preserves unknown fields", () => {
  const instance = { id: "jwl_a", definitionId: catalog.definitions[0].definitionId, properties: {} };
  const candidates = [
    { socketNodeId: "2491", instanceId: "jwl_a", x: 2, nested: { z: 1, a: 2 } },
    { instanceId: "jwl_a", socketNodeId: "2491", nested: { a: 2, z: 1 }, x: 2 },
    { socketNodeId: "2491", instanceId: "jwl_a", x: 1, future: true },
  ];
  const permutations = [candidates, [...candidates].reverse(), [candidates[1], candidates[2], candidates[0]]];
  const results = permutations.map(placements => jewels.normalizeJewelState({ instances: [instance], placements }, catalog));
  assert.ok(results.every(result => result.ok && result.inactive.filter(item => item.type === "duplicate_placement").length === 2));
  assert.ok(results.every(result => JSON.stringify(result.state.placements) === JSON.stringify(results[0].state.placements)));
  assert.equal(results[0].state.placements[0].future, true);
});
