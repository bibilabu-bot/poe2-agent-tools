"use strict";
const fs = require("node:fs"), path = require("node:path"), test = require("node:test"), assert = require("node:assert/strict");
const { adaptWeGamePassiveImport } = require("../src/interop/wegame-import-adapter.js");
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "wegame-share", "public-share.sanitized.json"), "utf8"));
const coverage = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "wegame-share", "passive-id-coverage.json"), "utf8"));
function evidenceTree() {
  const nodes = {}, jewelSlots = [];
  for (const category of Object.values(coverage.categories)) for (const record of category.records) {
    nodes[record.numericId] ||= { id: record.officialId };
    if (record.classification === "ascendancy") nodes[record.numericId].ascendancyId = "Mercenary3";
    if (record.classification === "ordinary-socket") { nodes[record.numericId].isJewelSocket = true; jewelSlots.push(Number(record.numericId)); }
  }
  return { nodes, jewelSlots };
}
test("fixture creates active passive candidates and preserves inactive semantics without mutation", () => {
  const input = { roleInfo: fixture.roleInfo, talentTree: fixture.talentTree }, before = JSON.stringify(input);
  const result = adaptWeGamePassiveImport(input, evidenceTree());
  assert.equal(JSON.stringify(input), before); assert.equal(result.version, 1); assert.equal(result.candidate.transactional, true);
  assert.deepEqual([result.candidate.active.normal.length, result.candidate.active.ascendancy.length, result.candidate.active.ordinarySockets.length], [86, 9, 7]);
  assert.equal(result.candidate.class.ascendancyId, "Mercenary3"); assert.equal(result.candidate.class.status, "requires-confirmation");
  assert.equal(result.candidate.inactive.sourceSpecialisations.length, 2);
  assert.ok(result.candidate.inactive.sourceSpecialisations.every(set => set.requiresDecision && set.targetWeaponSet === null && set.status === "inactive"));
  assert.equal(result.candidate.inactive.skillOverrides.length, 53); assert.ok(result.candidate.inactive.skillOverrides.every(item => item.status === "inactive"));
  assert.ok(result.diagnostics.details.some(item => item.code === "SKILL_OVERRIDES_SEMANTIC_LOSS"));
  assert.equal(result.rawPreservation.equipmentFetched, false); assert.equal(result.rawPreservation.skillsFetched, false);
});
test("unknown and duplicate IDs are bounded, preserved and diagnosed", () => {
  const input = structuredClone({ roleInfo: fixture.roleInfo, talentTree: fixture.talentTree }); input.talentTree.talent_tree.hashes = [506, 506, 999999, -1];
  const result = adaptWeGamePassiveImport(input, evidenceTree());
  assert.equal(result.candidate.active.normal.length, 1); assert.equal(result.candidate.unresolved.length, 2);
  assert.ok(result.diagnostics.details.some(item => item.code === "DUPLICATE_PASSIVE_ID")); assert.ok(result.diagnostics.details.some(item => item.code === "UNKNOWN_PASSIVE_ID"));
});
test("business errors, schema drift and collection limits fail closed", () => {
  assert.throws(() => adaptWeGamePassiveImport({ roleInfo: { result: { error_code: 7 } }, talentTree: fixture.talentTree }, evidenceTree()), error => error.code === "WEGAME_BUSINESS_ERROR");
  assert.throws(() => adaptWeGamePassiveImport({ roleInfo: fixture.roleInfo, talentTree: { result: { error_code: 0 } } }, evidenceTree()), error => error.code === "WEGAME_SCHEMA_DRIFT");
  const huge = structuredClone({ roleInfo: fixture.roleInfo, talentTree: fixture.talentTree }); huge.talentTree.talent_tree.hashes = Array(20001).fill(1);
  assert.throws(() => adaptWeGamePassiveImport(huge, evidenceTree()), error => error.code === "WEGAME_SCHEMA_LIMIT");
});
test("special and ascendancy jewel sockets remain unresolved and inactive", () => {
  const input = structuredClone({ roleInfo: fixture.roleInfo, talentTree: fixture.talentTree }); input.talentTree.talent_tree.hashes = [11184, 17788];
  const officialTree = { nodes: { "11184": { id: "zarokh_gift", isJewelSocket: true, isBlighted: true }, "17788": { id: "crystalline_phylactery", isJewelSocket: true, ascendancyId: "Witch3" } }, jewelSlots: [11184, 17788] };
  const result = adaptWeGamePassiveImport(input, officialTree);
  assert.deepEqual([result.candidate.active.normal.length, result.candidate.active.ascendancy.length, result.candidate.active.ordinarySockets.length], [0, 0, 0]);
  const specialSockets = result.candidate.unresolved.filter(item => item.reason === "special-socket");
  assert.deepEqual(specialSockets.map(item => item.numericId), ["11184", "17788"]); assert.ok(result.diagnostics.details.some(item => item.code === "UNSUPPORTED_SPECIAL_SOCKET"));
});
