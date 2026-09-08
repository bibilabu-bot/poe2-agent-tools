#!/usr/bin/env node
// Download the current PoE2 jewel data truth sources.
// Node 18+ required. Run: node download_poe2_jewel_sources.mjs

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  await fs.readFile(path.join(here, "poe2_jewel_sources_manifest.json"), "utf8")
);

const results = [];
for (const src of manifest.sources) {
  const target = path.join(here, src.target);
  await fs.mkdir(path.dirname(target), { recursive: true });

  process.stdout.write(`Fetching ${src.id} ... `);
  try {
    const res = await fetch(src.url, {
      headers: { "user-agent": "poe2-passive-tree-planner-jewel-data/1.0" }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(target, bytes);
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    results.push({
      id: src.id,
      ok: true,
      url: src.url,
      target: src.target,
      bytes: bytes.length,
      sha256,
      downloaded_at: new Date().toISOString()
    });
    console.log(`${bytes.length} bytes`);
  } catch (error) {
    results.push({
      id: src.id,
      ok: false,
      url: src.url,
      target: src.target,
      error: String(error?.message || error)
    });
    console.log(`FAILED: ${error?.message || error}`);
  }
}

await fs.writeFile(
  path.join(here, "download_result.json"),
  JSON.stringify({ results }, null, 2)
);

const failed = results.filter(x => !x.ok);
console.log(`\nDone: ${results.length - failed.length}/${results.length} sources downloaded.`);
if (failed.length) {
  console.log("Failed:", failed.map(x => x.id).join(", "));
  process.exitCode = 1;
}
