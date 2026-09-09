import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateUpstreamLock } from "./validate-upstream-lock.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonical = JSON.parse(await fs.readFile(path.join(root, "data", "upstream-sources.lock.json"), "utf8"));
const runtimeManifest = JSON.parse(await fs.readFile(path.join(root, "apps", "planner-desktop", "data", "cache", "manifest.json"), "utf8"));
const compilerManifest = JSON.parse(await fs.readFile(path.join(root, "tools", "jewel-compiler", "poe2_jewel_sources_manifest.json"), "utf8"));
const clone = value => structuredClone(value);

test("canonical upstream source lock passes offline validation", () => {
  assert.deepEqual(validateUpstreamLock(canonical), []);
});

test("canonical lock covers the runtime manifest and current class portraits", () => {
  const ids = new Set(canonical.sources.map(source => source.id));
  const coreIds = {
    "tree-pre.json": "runtime.drydream.tree-pre",
    "atlas-skills.webp": "runtime.drydream.atlas-skills",
    "atlas-frame.webp": "runtime.drydream.atlas-frame",
    "tree-jump.json": "runtime.drydream.tree-jump",
    "ChineseTranslation.lua": "runtime.translation.zh-cn",
    "mastery-effect-active.json": "runtime.ggg.mastery-effect-metadata",
    "mastery-effect-active.webp": "runtime.ggg.mastery-effect-atlas",
    "official-data.json": "shared.ggg.passive-tree"
  };
  assert.deepEqual(runtimeManifest.core.map(item => item.name).sort(), Object.keys(coreIds).sort());
  for (const id of Object.values(coreIds)) assert.ok(ids.has(id), `missing ${id}`);
  for (const className of ["warrior", "ranger", "witch", "sorceress", "monk", "mercenary", "huntress", "druid"]) {
    assert.ok(ids.has(`runtime.drydream.portrait-${className}`), `missing portrait ${className}`);
  }
});

test("canonical lock covers every jewel compiler manifest source", () => {
  const locked = new Set(canonical.sources.map(source => source.origin.path ?? source.origin.url));
  for (const source of compilerManifest.sources) {
    const url = new URL(source.url);
    const pathName = source.id === "poe2db_jewels"
      ? source.url
      : decodeURIComponent(url.pathname).split("/").slice(4).join("/");
    assert.ok(locked.has(pathName), `missing compiler source ${source.id}: ${pathName}`);
  }
});

test("rejects duplicate IDs and invalid status enums", () => {
  const value = clone(canonical);
  value.sources[1].id = value.sources[0].id;
  value.sources[1].status = "enabled";
  const errors = validateUpstreamLock(value).join("\n");
  assert.match(errors, /duplicates/);
  assert.match(errors, /status is invalid/);
});

test("rejects moving or abbreviated GitHub revisions", () => {
  const value = clone(canonical);
  value.sources[0].origin.revision = "main";
  value.sources[0].transport.url = value.sources[0].transport.url.replace(/[0-9a-f]{40}/, "main");
  assert.match(validateUpstreamLock(value).join("\n"), /full 40-character commit SHA/);
});

test("rejects malformed integrity and missing required fields", () => {
  const value = clone(canonical);
  value.sources[0].integrity.sha256 = "abc";
  value.sources[0].integrity.bytes = 0;
  delete value.sources[0].purpose;
  const errors = validateUpstreamLock(value).join("\n");
  assert.match(errors, /integrity/);
  assert.match(errors, /purpose/);
});

test("requires timestamped snapshots without fake revisions for HTTP sources", () => {
  const value = clone(canonical);
  const source = value.sources.find(item => item.origin.type === "https");
  source.origin.revision = "fake";
  source.snapshot.accessedAt = "2026-09-09";
  const errors = validateUpstreamLock(value).join("\n");
  assert.match(errors, /not valid for a non-Git snapshot/);
  assert.match(errors, /snapshot/);
});
