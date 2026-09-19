"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const ui = require("../renderer/wegame-import-ui.js");

function fixture() {
  return {
    format: "poe2-agent-tools-wegame-passive-import", version: 1,
    candidate: {
      transactional: true, class: { ascendancyId: "Mercenary3" },
      active: {
        normal: [{ numericId: "1", officialId: "n1", active: true }],
        ascendancy: [{ numericId: "2", officialId: "a1", active: true }],
        ordinarySockets: [{ numericId: "3", officialId: "s1", active: true }],
      },
      inactive: { sourceSpecialisations: [
        { sourceLabel: "set1", passives: [{ numericId: "4", officialId: "w1" }] },
        { sourceLabel: "set2", passives: [{ numericId: "5", officialId: "w2" }] },
      ], skillOverrides: [{ sourceKey: "1" }], jewelData: { x: 1 } },
      unresolved: [{ reason: "missing" }],
    }, diagnostics: { total: 4 },
  };
}
function current() {
  return { maxPoints: 100, maxWeaponPoints: 20, maxAscPoints: 8, camera: { x: 1, y: 2, scale: .2 }, showLockedConditional: true, showInstillOnGraph: false };
}
function catalog() {
  return {
    classStartIds: new Map([["Mercenary", "start"]]),
    ascendancyStartIds: new Map([["Mercenary3", "astart"]]),
    ascendanciesByClass: new Map([["Mercenary", new Set(["Mercenary3"])]]),
    nodeIds: new Set(["1", "2", "3", "4", "5"]), normalIds: new Set(["1"]),
    ordinarySocketIds: new Set(["3"]), ascendancyIds: new Map([["2", "Mercenary3"]]),
    weaponEligibleIds: new Set(["4", "5"]),
  };
}

test("summarizes supported and inactive candidate categories", () => {
  assert.deepEqual(ui.summarize(fixture()), { normal: 1, ascendancy: 1, ordinarySockets: 1, sourceSpecialisations: 2, weaponSet1: 1, weaponSet2: 1, skillOverrides: 1, jewelData: 1, unresolved: 1, diagnostics: 4 });
});
test("creates a replacement candidate while retaining budgets and dropping inactive state", () => {
  const result = ui.createPlannerCandidate(fixture(), { baseClassName: "Mercenary", ascendancyId: "Mercenary3", partialImportAcknowledged: true }, current(), catalog());
  assert.deepEqual([...result.allocated], ["start", "1", "3"]);
  assert.deepEqual([...result.ascAllocated], ["astart", "2"]);
  assert.equal(result.maxPoints, 100); assert.deepEqual([...result.weaponSet1Allocated], ["4"]); assert.deepEqual([...result.weaponSet2Allocated], ["5"]); assert.equal(result.preservation, null);
});
test("fails closed for missing catalog IDs, category conflicts and unconfirmed partial import", () => {
  const options = { baseClassName: "Mercenary", ascendancyId: "Mercenary3", partialImportAcknowledged: true };
  const missing = catalog(); missing.nodeIds.delete("1");
  assert.throws(() => ui.createPlannerCandidate(fixture(), options, current(), missing), /missing from/);
  const conflict = catalog(); conflict.ascendancyIds.set("2", "Witch3");
  assert.throws(() => ui.createPlannerCandidate(fixture(), options, current(), conflict), /conflicts/);
  assert.throws(() => ui.createPlannerCandidate(fixture(), { ...options, partialImportAcknowledged: false }, current(), catalog()), /acknowledged/);
  const ineligible = catalog(); ineligible.weaponEligibleIds.delete("4");
  const withOmission=ui.createPlannerCandidate(fixture(), options, current(), ineligible);
  assert.equal(withOmission.weaponSet1Allocated.size,0); assert.deepEqual(withOmission.weaponSetOmissions,[{sourceLabel:"set1",numericId:"4",reason:"not-weapon-eligible"}]);
});
test("transaction helper restores an existing build after commit failure", () => {
  const adapter = require("../renderer/build-state-adapter.js");
  const old = { marker: "nonempty" }; let live = old;
  const result = ui.applyImportTransaction({ marker: "new" }, {
    snapshot: () => live, commit: next => { live = next; throw new Error("render failed"); }, rollback: previous => { live = previous; },
  },adapter);
  assert.equal(result.ok, false); assert.equal(result.unsafe,false); assert.equal(live, old);
});
test("closing the dialog invalidates a late response before preview publication", async () => {
  const gate=ui.createLatestRequestGate();
  const request=gate.begin(); let publishPreview=false;
  const response=Promise.resolve({ok:true});
  gate.invalidate();
  await response;
  if(gate.isCurrent(request)) publishPreview=true;
  assert.equal(publishPreview,false);
});
test("rollback failure marks UI unsafe and both save entry points reject", () => {
  const adapter=require("../renderer/build-state-adapter.js");
  const result=ui.applyImportTransaction({}, {
    snapshot:()=>({}),commit:()=>{throw new Error("commit");},rollback:()=>{throw new Error("rollback");},
  },adapter);
  assert.equal(result.unsafe,true);
  assert.equal(ui.canSaveBuild({ready:true,supported:true,unsafe:result.unsafe}),false,"save handler guard");
  assert.equal(!ui.canSaveBuild({ready:true,supported:true,unsafe:result.unsafe}),true,"save button disabled state");
});
test("mapped weapon sets survive the existing native save and reopen path", () => {
  const adapter = require("../renderer/build-state-adapter.js");
  const codec = require("../renderer/build-codec.js");
  const imported = ui.createPlannerCandidate(fixture(), { baseClassName: "Mercenary", ascendancyId: "Mercenary3", partialImportAcknowledged: true }, current(), catalog());
  const value = adapter.extractBuildValue(imported);
  const decoded = codec.decodeBuildDocument(codec.serializeBuildDocument(value), {
    knownBaseClasses: new Set(["Mercenary"]),
    knownAscendancies: (id, base) => id === "Mercenary3" && base === "Mercenary",
    knownNodeIds: () => true,
    knownInstilledPassives: new Set(),
  });
  assert.equal(decoded.ok, true);
  const reopened = adapter.createBuildCandidate(decoded.value, decoded.preservation, {
    classStartIds: new Map([["Mercenary", "start"]]), ascendancyStartIds: new Map([["Mercenary3", "astart"]]),
  });
  assert.deepEqual([...reopened.weaponSet1Allocated], ["4"]);
  assert.deepEqual([...reopened.weaponSet2Allocated], ["5"]);
});
test("missing Planner weapon nodes are bounded explicit omissions", () => {
  const value=fixture();
  value.candidate.inactive.sourceSpecialisations[0].passives.push({numericId:"52669",officialId:"fire75"});
  const result=ui.createPlannerCandidate(value,{baseClassName:"Mercenary",ascendancyId:"Mercenary3",partialImportAcknowledged:true},current(),catalog());
  assert.deepEqual(result.weaponSetOmissions,[{sourceLabel:"set1",numericId:"52669",reason:"missing-from-planner"}]);
  assert.equal(result.counts.weaponSet1,2); assert.equal(result.counts.weaponSet1Applied,1); assert.equal(result.counts.weaponSetOmitted,1);
});
test("budget summary uses general plus max weapon set and excludes free starts", () => {
  const result=ui.createPlannerCandidate(fixture(),{baseClassName:"Mercenary",ascendancyId:"Mercenary3",partialImportAcknowledged:true},current(),catalog());
  assert.deepEqual(ui.summarizeApplicationBudget(result),{general:2,weaponSet1:1,weaponSet2:1,ascendancy:1,effectivePassive:3});
});
