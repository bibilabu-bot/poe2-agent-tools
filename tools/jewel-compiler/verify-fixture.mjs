#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const generatedFiles = [
  "jewel_mods.json",
  "jewel_sockets.json",
  "jewel_constants.json",
  "unique_jewels.json",
  "jewel_tree_rules.json",
  "compile_report.json"
];

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function removeDynamicFields(fileName, value) {
  if (fileName === "compile_report.json") {
    const { compiled_at: _compiledAt, ...stableValue } = value;
    return stableValue;
  }
  return value;
}

const temporaryRoot = await fs.mkdtemp(
  path.join(os.tmpdir(), "poe2-jewel-fixture-")
);
const temporaryCompiler = path.join(temporaryRoot, "jewel-compiler");

try {
  await fs.cp(here, temporaryCompiler, { recursive: true });
  await fs.rm(path.join(temporaryCompiler, "dist"), {
    recursive: true,
    force: true
  });

  const compile = spawnSync(process.execPath, ["build-jewel-db.mjs"], {
    cwd: temporaryCompiler,
    encoding: "utf8"
  });

  if (compile.stdout) process.stdout.write(compile.stdout);
  if (compile.stderr) process.stderr.write(compile.stderr);
  if (compile.error) throw compile.error;
  assert.equal(compile.status, 0, "fixture compiler exited unsuccessfully");

  for (const fileName of generatedFiles) {
    const expected = removeDynamicFields(
      fileName,
      await readJson(path.join(here, "dist", fileName))
    );
    const actual = removeDynamicFields(
      fileName,
      await readJson(path.join(temporaryCompiler, "dist", fileName))
    );
    assert.deepEqual(actual, expected, `${fileName} does not match the fixture output`);
  }

  console.log(`Verified ${generatedFiles.length} fixture outputs in a temporary copy.`);
} finally {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}
