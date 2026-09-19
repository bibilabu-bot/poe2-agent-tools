"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const test = require("node:test");

const tool = path.join(__dirname, "..", "tools", "report-wegame-localization-coverage.cjs");

function integrity(file) {
  const bytes = fs.readFileSync(file);
  return { bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
}

test("reports stable identity, translation gaps, and version conflicts from synthetic inputs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p2at-wegame-l10n-test-"));
  try {
    const files = {
      wegame: path.join(dir, "tree.js"),
      official: path.join(dir, "official.json"),
      treePre: path.join(dir, "tree-pre.json"),
      translation: path.join(dir, "translation.lua"),
      lock: path.join(dir, "lock.json"),
    };
    fs.writeFileSync(files.wegame, [
      "const n = {",
      "  1: { id: 'raw.one', name: '名称一', stats: ['+10 力量'] },",
      "  2: { id: 'raw.old', name: 'Untranslated', stats: ['20% increased Damage'] },",
      "  3: { id: 'raw.extra', name: '额外', stats: [] }",
      "};",
      "const c = [{ name: '战士', ascendancies: [{ id: 'Class1', name: '升华' }] }],s = {};",
      "export { c as classes, n as nodes, s as skillOverrides };",
    ].join("\n"));
    fs.writeFileSync(files.official, JSON.stringify({
      classes: [{ name: "Warrior", ascendancies: [{ id: "Class1", name: "Ascendancy" }] }],
      nodes: {
        1: { id: "raw.one", name: "Name One", stats: ["+10 to Strength"] },
        2: { id: "raw.new", name: "Untranslated", stats: ["20% increased Damage"] },
      },
      skillOverrides: {},
    }));
    fs.writeFileSync(files.treePre, JSON.stringify({
      nodes: {
        1: { name: "Name One", stats: ["+10 to Strength"] },
        2: { name: "Untranslated", stats: ["20% increased Damage"] },
      },
    }));
    fs.writeFileSync(files.translation, [
      "d.passives = {",
      '  ["名称一"]="Name One",',
      "}",
      "d.classes = {",
      '  ["战士"]="Warrior",',
      "}",
      "d.statLines = {",
      '  {"+{0} 力量","+{0} to Strength"},',
      "}",
    ].join("\n"));
    fs.writeFileSync(files.lock, JSON.stringify({ sources: [
      { id: "shared.ggg.passive-tree", integrity: integrity(files.official) },
      { id: "runtime.drydream.tree-pre", integrity: integrity(files.treePre) },
      { id: "runtime.translation.zh-cn", integrity: integrity(files.translation) },
    ] }));

    const result = spawnSync(process.execPath, [tool,
      "--wegame", files.wegame,
      "--wegame-sha256", integrity(files.wegame).sha256,
      "--official", files.official,
      "--tree-pre", files.treePre,
      "--translation", files.translation,
      "--lock", files.lock,
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.wegameAgainstOfficial.nodes.matchingNumericAndRawIdentity, 1);
    assert.equal(report.wegameAgainstOfficial.nodes.numericIdentityConflicts, 1);
    assert.equal(report.wegameAgainstTreePre.numericMatches, 2);
    assert.equal(report.wegameAgainstTreePre.hanNamedInstances, 1);
    assert.equal(report.wegameAgainstTreePre.noHanNamedInstances, 1);
    assert.equal(report.currentPoBTranslationAgainstComparableOfficial.coveredNameInstances, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("parses the downloaded module as data without executing side effects", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p2at-wegame-l10n-side-effect-"));
  try {
    const marker = path.join(dir, "must-not-exist");
    const files = {
      wegame: path.join(dir, "tree.js"), official: path.join(dir, "official.json"),
      treePre: path.join(dir, "tree-pre.json"), translation: path.join(dir, "translation.lua"), lock: path.join(dir, "lock.json"),
    };
    fs.writeFileSync(files.wegame, `import fs from "node:fs";fs.writeFileSync(${JSON.stringify(marker)},"bad");const c=[],n={},s={};export{c as classes,n as nodes,s as skillOverrides};`);
    fs.writeFileSync(files.official, JSON.stringify({ classes: [], nodes: {}, skillOverrides: {} }));
    fs.writeFileSync(files.treePre, JSON.stringify({ nodes: {} }));
    fs.writeFileSync(files.translation, "");
    fs.writeFileSync(files.lock, JSON.stringify({ sources: [
      { id: "shared.ggg.passive-tree", integrity: integrity(files.official) },
      { id: "runtime.drydream.tree-pre", integrity: integrity(files.treePre) },
      { id: "runtime.translation.zh-cn", integrity: integrity(files.translation) },
    ] }));
    const result = spawnSync(process.execPath, [tool, "--wegame", files.wegame, "--wegame-sha256", integrity(files.wegame).sha256, "--official", files.official, "--tree-pre", files.treePre, "--translation", files.translation, "--lock", files.lock], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(marker), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("rejects input drift against the canonical lock", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p2at-wegame-l10n-drift-"));
  try {
    const file = path.join(dir, "input");
    const lock = path.join(dir, "lock.json");
    fs.writeFileSync(file, "{}");
    fs.writeFileSync(lock, JSON.stringify({ sources: [
      { id: "shared.ggg.passive-tree", integrity: { bytes: 2, sha256: "0".repeat(64) } },
      { id: "runtime.drydream.tree-pre", integrity: integrity(file) },
      { id: "runtime.translation.zh-cn", integrity: integrity(file) },
    ] }));
    const result = spawnSync(process.execPath, [tool, "--wegame", file, "--wegame-sha256", integrity(file).sha256, "--official", file, "--tree-pre", file, "--translation", file, "--lock", lock], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /official integrity mismatch/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fails closed when a required input is missing", () => {
  const result = spawnSync(process.execPath, [tool], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing --wegame/);
});
