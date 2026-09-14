"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createPassiveIdMap } = require("../src/interop/passive-id-map.js");

const ORDINARY_SOCKETS = new Set(["2491", "7960", "21984", "26196", "26725", "32763", "46882", "54127", "55190", "60735", "61419", "61834"]);

function readVerifiedOfficialTree(officialTreePath, lockPath) {
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  const source = lock.sources.find(item => item.id === "shared.ggg.passive-tree");
  if (!source) throw new Error("canonical lock lacks shared.ggg.passive-tree");
  const bytes = fs.readFileSync(officialTreePath);
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== source.integrity.bytes || digest !== source.integrity.sha256) {
    throw new Error("official passive tree does not match the canonical lock");
  }
  return { tree: JSON.parse(bytes), source };
}

function reportCategory(name, values, tree, mapper) {
  const ids = values.map(String);
  const records = ids.map(numericId => {
    const mapping = mapper.numericToOfficial(numericId);
    const node = tree.nodes[numericId];
    let classification = "missing";
    if (node) {
      if (ORDINARY_SOCKETS.has(numericId)) classification = "ordinary-socket";
      else if (node.isJewelSocket) classification = "special-socket";
      else if (typeof node.ascendancyId === "string") classification = "ascendancy";
      else classification = "normal";
    }
    return { numericId, mappingStatus: mapping.status, officialId: mapping.officialId || null, classification };
  });
  const count = classification => records.filter(record => record.classification === classification).length;
  return {
    name,
    count: records.length,
    uniqueCount: new Set(ids).size,
    mapped: records.filter(record => record.mappingStatus === "mapped").length,
    missing: records.filter(record => record.mappingStatus === "missing").length,
    ambiguous: records.filter(record => record.mappingStatus === "ambiguous").length,
    classifications: {
      normal: count("normal"),
      ascendancy: count("ascendancy"),
      ordinarySocket: count("ordinary-socket"),
      specialSocket: count("special-socket"),
      missing: count("missing")
    },
    records
  };
}

function buildReport(fixturePath, officialTreePath, lockPath) {
  const fixtureBytes = fs.readFileSync(fixturePath);
  const fixture = JSON.parse(fixtureBytes);
  const talent = fixture.talentTree.talent_tree;
  const { tree, source } = readVerifiedOfficialTree(officialTreePath, lockPath);
  const mapper = createPassiveIdMap(tree);
  const hashes = reportCategory("hashes", talent.hashes, tree, mapper);
  const set1 = reportCategory("specialisations.set1", talent.specialisations.set1, tree, mapper);
  const set2 = reportCategory("specialisations.set2", talent.specialisations.set2, tree, mapper);
  const overrides = reportCategory("skill_overrides keys", Object.keys(talent.skill_overrides), tree, mapper);
  const all = [...talent.hashes, ...talent.specialisations.set1, ...talent.specialisations.set2].map(String);
  return {
    format: "poe2-agent-tools-wegame-share-coverage",
    version: 1,
    evidence: {
      officialTreeLockId: source.id,
      officialTreeSha256: source.integrity.sha256,
      fixture: path.basename(fixturePath),
      fixtureSha256: crypto.createHash("sha256").update(fixtureBytes).digest("hex")
    },
    categories: { hashes, weaponSet1: set1, weaponSet2: set2, skillOverrides: overrides },
    relations: {
      allAllocationCount: all.length,
      allAllocationUniqueCount: new Set(all).size,
      set1Set2Overlap: talent.specialisations.set1.filter(id => talent.specialisations.set2.includes(id)).map(String),
      hashesSet1Overlap: talent.specialisations.set1.filter(id => talent.hashes.includes(id)).map(String),
      hashesSet2Overlap: talent.specialisations.set2.filter(id => talent.hashes.includes(id)).map(String),
      skillOverridesNotInHashes: Object.keys(talent.skill_overrides).filter(id => !talent.hashes.map(String).includes(id))
    }
  };
}

if (require.main === module) {
  const [fixturePath, officialTreePath, lockPath] = process.argv.slice(2);
  if (!fixturePath || !officialTreePath || !lockPath) {
    throw new Error("usage: node report-wegame-share-coverage.cjs <fixture> <official-tree> <lock>");
  }
  process.stdout.write(JSON.stringify(buildReport(fixturePath, officialTreePath, lockPath), null, 2) + "\n");
}

module.exports = { buildReport, readVerifiedOfficialTree, reportCategory };
