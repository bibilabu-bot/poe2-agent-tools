"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const engine = require("../renderer/localization-engine.js");
const { cleanStatDisplay } = require("../renderer/stat-utils.js");

// Inputs must come from the existing lock-verified resource loader, never renderer state.
function buildPassiveCorpus({ official, runtime, translation, wegame, sourceVersion }) {
  const pob = engine.parsePobTranslation(translation);
  const overlay = engine.buildLocalization({ officialTree:official, weGame:engine.parseWeGameModule(wegame), pob });
  const nodes = Object.entries(runtime.nodes || {}).map(([id,node]) => {
    const name = engine.resolveNodeName({id,name:node.name || ""},overlay.names,pob.passiveZh);
    const stats = (node.stats || []).map(stat => {
      const original = cleanStatDisplay(stat);
      const resolved = overlay.stats.get(id)?.get(original) || engine.translatePobStat(stat,pob);
      return { original, text:resolved.value, source:resolved.source || resolved.quality };
    });
    const record = { id, name:name.value || node.name || "未命名节点", originalName:node.name || "",
      type:node.kind === "keystone" || node.isKeystone ? "关键天赋" : node.kind === "notable" || node.isNotable ? "核心天赋" : "普通天赋",
      ascendancy:node.ascendancyName || null, stats, nameSource:name.source || name.quality,
      sourceVersion };
    const text = [`名称：${record.name} / ${record.originalName}`, `类型：${record.type}`,
      ...stats.map(s=>`${s.text}\n${s.original}`)].join("\n");
    if (text.length > 12000) throw new Error("Node text exceeds indexing limit");
    return {...record,text};
  });
  if (!nodes.length || nodes.length > 20000) throw new Error("Invalid passive corpus size");
  return {version:crypto.createHash("sha256").update(JSON.stringify(nodes)).digest("hex"), nodes};
}
function passiveCorpusIdentity(lock, candidates) {
  // Include locked bytes AND projection/translation code, not just the lock label.
  const hash = crypto.createHash("sha256").update(JSON.stringify({lock,candidates}));
  for (const file of [__filename, path.join(__dirname,"../renderer/localization-engine.js"), path.join(__dirname,"../renderer/stat-utils.js")]) hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}
module.exports = { buildPassiveCorpus, passiveCorpusIdentity };
