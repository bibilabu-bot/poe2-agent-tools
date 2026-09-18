"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildReport } = require("../tools/report-wegame-share-coverage.cjs");
const { assertSanitized, canonicalFixtureBytes, schemaFingerprint } = require("../tools/wegame-share-schema.cjs");

const directory = path.join(__dirname, "..", "fixtures", "wegame-share");
const fixturePath = path.join(directory, "public-share.sanitized.json");
const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
const rawFixtureBytes = fs.readFileSync(fixturePath);
// The manifest pins repository LF bytes; normalize transparent Windows checkout conversion.
const fixtureBytes = canonicalFixtureBytes(rawFixtureBytes);
const fixture = JSON.parse(fixtureBytes);
const coverage = JSON.parse(fs.readFileSync(path.join(directory, "passive-id-coverage.json"), "utf8"));
const schemaPaths = JSON.parse(fs.readFileSync(path.join(directory, "schema-paths.json"), "utf8"));

test("WeGame fixture is byte-pinned and omits share/role identity", () => {
  assert.equal(fixtureBytes.length, manifest.fixture.bytes);
  assert.equal(crypto.createHash("sha256").update(fixtureBytes).digest("hex"), manifest.fixture.sha256);
  assert.equal(manifest.fixture.redistribution, "UNVERIFIED");
  assert.equal(manifest.requestTemplate.authenticationObserved, "none");
  assert.equal(manifest.requestTemplate.cookiesSent, false);
  for (const key of ["openid", "role_id", "name", "account_name", "created_time", "last_login_time", "season_game_duration", "total_game_duration"]) {
    assert.equal(Object.hasOwn(fixture.roleInfo.role, key), false, key);
  }
  assert.equal(Object.hasOwn(fixture.roleInfo, "nick_name"), false);
  assert.equal(Object.hasOwn(fixture.roleInfo, "share_code"), false);
  assert.doesNotThrow(() => assertSanitized(fixture));
  for (const key of ["device_id", "deviceId", "roleId", "shareCode", "accessToken", "account_id", "user_id", "authorizationHeader", "cookieValue", "session-id", "clientSecret", "trace_id", "created_time", "last_login_time", "season_game_duration", "total_game_duration", "play_duration"]) {
    assert.throws(() => assertSanitized({ nested: { [key]: "short" } }), /forbidden sensitive key/, key);
  }
  assert.throws(() => assertSanitized({ future: "A".repeat(48) }), /unsanitized opaque identifier/);
});

test("all thirteen raw schema fingerprints are reproducible from value-free paths", () => {
  assert.equal(Object.keys(schemaPaths.responses).length, manifest.responses.length);
  for (const response of manifest.responses) {
    const summary = schemaPaths.responses[response.endpoint];
    assert.ok(summary, response.endpoint);
    assert.equal(schemaFingerprint(summary.paths), response.schemaFingerprint, response.endpoint);
    assert.equal(summary.fingerprint, response.schemaFingerprint, response.endpoint);
  }
});

test("WeGame fixture retains the complete observed Build-bearing structure", () => {
  assert.equal(fixture.roleInfo.result.error_code, 0);
  assert.equal(fixture.roleInfo.role.level, 94);
  assert.equal(fixture.roleInfo.role.class_name, "Gemling Legionnaire");
  assert.equal(fixture.equipments.equipments.length, 15);
  assert.equal(fixture.skills.skills.length, 13);
  assert.equal(fixture.skillsDps.skills_dps.length, 8);
  assert.equal(fixture.talentTree.talent_tree.hashes.length, 102);
  assert.equal(fixture.talentTree.talent_tree.specialisations.set1.length, 24);
  assert.equal(fixture.talentTree.talent_tree.specialisations.set2.length, 24);
  assert.deepEqual(Object.keys(fixture.talentTree.talent_tree.specialisations).sort(), ["set1", "set2"]);
  assert.equal(Object.keys(fixture.talentTree.talent_tree.skill_overrides).length, 53);
  assert.equal(fixture.talentTree.talent_tree.quest_stats.length, 13);
  assert.equal(Object.keys(fixture.talentTree.talent_tree.jewel_data).length, 7);
  assert.equal(fixture.jewels.jewel_data, "");
  assert.match(fixture.equipments.equipments[0].id, /^opaque-item-\d{3}$/);
});

test("committed passive coverage records every observed numeric passive ID", () => {
  const { hashes, weaponSet1, weaponSet2, skillOverrides } = coverage.categories;
  assert.deepEqual([hashes.count, weaponSet1.count, weaponSet2.count, skillOverrides.count], [102, 24, 24, 53]);
  for (const category of [hashes, weaponSet1, weaponSet2, skillOverrides]) {
    assert.equal(category.mapped, category.count);
    assert.equal(category.missing, 0);
    assert.equal(category.ambiguous, 0);
  }
  assert.deepEqual(hashes.classifications, { normal: 86, ascendancy: 9, ordinarySocket: 7, specialSocket: 0, missing: 0 });
  assert.deepEqual(weaponSet1.classifications, { normal: 24, ascendancy: 0, ordinarySocket: 0, specialSocket: 0, missing: 0 });
  assert.deepEqual(weaponSet2.classifications, { normal: 24, ascendancy: 0, ordinarySocket: 0, specialSocket: 0, missing: 0 });
  assert.equal(coverage.relations.allAllocationCount, 150);
  assert.equal(coverage.relations.allAllocationUniqueCount, 150);
  assert.equal(coverage.evidence.fixtureSha256, manifest.fixture.sha256);
  assert.deepEqual(coverage.relations.set1Set2Overlap, []);
  assert.deepEqual(coverage.relations.skillOverridesNotInHashes, []);
  assert.deepEqual(hashes.records.map(record => record.numericId), fixture.talentTree.talent_tree.hashes.map(String));
  assert.deepEqual(weaponSet1.records.map(record => record.numericId), fixture.talentTree.talent_tree.specialisations.set1.map(String));
  assert.deepEqual(weaponSet2.records.map(record => record.numericId), fixture.talentTree.talent_tree.specialisations.set2.map(String));
  assert.deepEqual(skillOverrides.records.map(record => record.numericId), Object.keys(fixture.talentTree.talent_tree.skill_overrides));
});

test("locked-tree coverage can be reproduced when an official tree path is supplied", t => {
  const officialTreePath = process.env.P2AT_OFFICIAL_TREE;
  if (!officialTreePath) return t.skip("P2AT_OFFICIAL_TREE not supplied");
  const lockPath = path.join(__dirname, "..", "..", "..", "data", "upstream-sources.lock.json");
  assert.deepEqual(buildReport(fixturePath, officialTreePath, lockPath), coverage);
});

test("coverage reporting pins canonical LF fixture bytes across checkout line endings", t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "p2at-wegame-newline-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const lfFixture = JSON.stringify({ talentTree: { talent_tree: { hashes: [1], specialisations: { set1: [], set2: [] }, skill_overrides: {} } } }, null, 2) + "\n";
  const treeBytes = Buffer.from(JSON.stringify({ nodes: { "1": { id: "one" } }, jewelSlots: [] }), "utf8");
  const lock = { sources: [{ id: "shared.ggg.passive-tree", integrity: { bytes: treeBytes.length, sha256: crypto.createHash("sha256").update(treeBytes).digest("hex") } }] };
  const lfPath = path.join(temporary, "lf.json"), crlfPath = path.join(temporary, "crlf.json"), treePath = path.join(temporary, "tree.json"), lockPath = path.join(temporary, "lock.json");
  fs.writeFileSync(lfPath, lfFixture); fs.writeFileSync(crlfPath, lfFixture.replace(/\n/g, "\r\n")); fs.writeFileSync(treePath, treeBytes); fs.writeFileSync(lockPath, JSON.stringify(lock));
  const lfReport = buildReport(lfPath, treePath, lockPath), crlfReport = buildReport(crlfPath, treePath, lockPath);
  assert.equal(lfReport.evidence.fixtureSha256, crypto.createHash("sha256").update(lfFixture).digest("hex"));
  assert.equal(crlfReport.evidence.fixtureSha256, lfReport.evidence.fixtureSha256);
  assert.deepEqual({ ...crlfReport.evidence, fixture: lfReport.evidence.fixture }, lfReport.evidence);
  const bomHash = crypto.createHash("sha256").update(canonicalFixtureBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(lfFixture)]))).digest("hex");
  assert.notEqual(bomHash, lfReport.evidence.fixtureSha256);
});

test("official tree verification rejects absent and noncanonical cache paths", t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "p2at-wegame-invalid-tree-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const lockPath = path.join(temporary, "lock.json"), wrongTreePath = path.join(temporary, "wrong.json");
  fs.writeFileSync(lockPath, JSON.stringify({ sources: [{ id: "shared.ggg.passive-tree", integrity: { bytes: 2, sha256: crypto.createHash("sha256").update("{}").digest("hex") } }] }));
  fs.writeFileSync(wrongTreePath, "[]");
  assert.throws(() => buildReport(fixturePath, path.join(temporary, "missing.json"), lockPath), /ENOENT/);
  assert.throws(() => buildReport(fixturePath, wrongTreePath, lockPath), /does not match the canonical lock/);
});
