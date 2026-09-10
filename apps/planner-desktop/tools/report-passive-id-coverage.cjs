"use strict";
const crypto = require("node:crypto"), fs = require("node:fs"), path = require("node:path");
const { createPassiveIdMap } = require("../src/interop/passive-id-map.js");
function locked(lock, id) { const item = lock.sources.find(x => x.id === id); if (!item) throw Error(`lock ID missing: ${id}`); return item.integrity; }
function readVerified(file, integrity) { const bytes = fs.readFileSync(file); if (bytes.length !== integrity.bytes || crypto.createHash("sha256").update(bytes).digest("hex") !== integrity.sha256) throw Error(`canonical lock verification failed: ${file}`); return JSON.parse(bytes); }
function report(cacheDirectory, lockPath) {
 const lock = JSON.parse(fs.readFileSync(lockPath)); const official = readVerified(path.join(cacheDirectory,"official-data.json"), locked(lock,"shared.ggg.passive-tree")); const pre = readVerified(path.join(cacheDirectory,"tree-pre.json"), locked(lock,"runtime.drydream.tree-pre"));
 const map=createPassiveIdMap(official); const officialIds=Object.keys(official.nodes).sort(), preIds=Object.keys(pre.nodes).sort(), preSet=new Set(preIds), intersection=officialIds.filter(id=>preSet.has(id));
 const mapped=intersection.filter(id=>map.numericToOfficial(id).status==="mapped"); const conflicts=intersection.filter(id=>official.nodes[id]?.name !== pre.nodes[id]?.name);
 const ordinary=["2491","7960","21984","26196","26725","32763","46882","54127","55190","60735","61419","61834"];
 const ordinaryEvidence=ordinary.map(id=>({numericId:id,inOfficialJewelSlots:(official.jewelSlots||[]).map(String).includes(id),isJewelSocket:official.nodes[id]?.isJewelSocket===true}));
 const conflict11184={numericId:"11184",official:official.nodes["11184"]?.id,treePreName:pre.nodes["11184"]?.name,diagnostic:"official/tree-pre semantic conflict; exporter classification required"};
 return { lockSchemaVersion:lock.schemaVersion, officialNodeCount:officialIds.length, treePreNodeCount:preIds.length, numericIntersection:intersection.length, mappedIntersection:mapped.length, treePreUnmapped:preIds.filter(id=>map.numericToOfficial(id).status!=="mapped").sort(), officialNotInTreePre:officialIds.filter(id=>!preSet.has(id)).sort(), mapping:map.getMappingReport(), semanticNameConflicts:conflicts.map(id=>({numericId:id,officialName:official.nodes[id]?.name,treePreName:pre.nodes[id]?.name})).sort((a,b)=>a.numericId < b.numericId ? -1 : a.numericId > b.numericId ? 1 : 0), ordinaryJewelSockets:{ids:ordinary, evidence:ordinaryEvidence, mapped:ordinary.filter(id=>map.numericToOfficial(id).status==="mapped").length}, specialSocketIds:{ascendancy:["17788"],knownConflict:["11184"]}, conflict11184, knownMappings:["2491","7960","26725","17788","11184"].map(id=>map.numericToOfficial(id)) };
}
if(require.main===module) console.log(JSON.stringify(report(process.argv[2],process.argv[3]),null,2)); module.exports={report};
