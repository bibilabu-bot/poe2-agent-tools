#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const engine = require("../renderer/localization-engine.js");
const { cleanStatDisplay } = require("../renderer/stat-utils.js");

function argumentsFrom(values) {
  const result={};
  for(let index=0;index<values.length;index+=2) {
    if(!values[index]?.startsWith("--") || values[index+1] == null) throw new Error(`invalid argument near ${values[index] || "<end>"}`);
    result[values[index].slice(2)]=values[index+1];
  }
  for(const name of ["wegame","official","tree-pre","translation","lock","candidate-config"]) if(!result[name]) throw new Error(`missing --${name}`);
  return result;
}

function digest(file) {
  const bytes=fs.readFileSync(file);
  return {bytes:bytes.length,sha256:crypto.createHash("sha256").update(bytes).digest("hex")};
}

function verify(file, expected, label) {
  const actual=digest(file);
  if(actual.bytes!==expected.bytes || actual.sha256!==expected.sha256) throw new Error(`${label} integrity mismatch`);
  return actual;
}

function legacyPartial(value) {
  const rules=[/\bincreased\b/i,/\breduced\b/i,/\bmore\b/i,/\bless\b/i,/\bAttack Speed\b/i,/\bCast Speed\b/i,/\bMovement Speed\b/i,/\bCritical Hit Chance\b/i,/\bCritical Damage Bonus\b/i,/\bProjectile Damage\b/i,/\bAttack Damage\b/i,/\bSpell Damage\b/i,/\bFire Damage\b/i,/\bCold Damage\b/i,/\bLightning Damage\b/i,/\bChaos Damage\b/i,/\bPhysical Damage\b/i,/\bDamage\b/i,/\bMaximum Life\b/i,/\bMaximum Mana\b/i,/\bEnergy Shield\b/i,/\bArmour\b/i,/\bEvasion Rating\b/i,/\bStrength\b/i,/\bDexterity\b/i,/\bIntelligence\b/i,/\ball Attributes\b/i,/\bElemental Resistances\b/i,/\bMinions\b/i,/\bSkills?\b/i,/\bEnemies\b/i];
  return rules.some(rule=>rule.test(cleanStatDisplay(value)));
}

function increment(target,key) { target[key]=(target[key]||0)+1; }

function main() {
  const args=argumentsFrom(process.argv.slice(2));
  const lock=JSON.parse(fs.readFileSync(args.lock,"utf8"));
  const candidateConfig=JSON.parse(fs.readFileSync(args["candidate-config"],"utf8"));
  const source=id=>lock.sources.find(item=>item.id===id)?.integrity;
  const candidate=candidateConfig.candidates.find(item=>item.name==="wegame-passive-tree-zh-cn.js");
  const inputs={
    wegame:verify(args.wegame,candidate.integrity,"wegame"),
    official:verify(args.official,source("shared.ggg.passive-tree"),"official"),
    treePre:verify(args["tree-pre"],source("runtime.drydream.tree-pre"),"tree-pre"),
    translation:verify(args.translation,source("runtime.translation.zh-cn"),"translation"),
  };
  const official=JSON.parse(fs.readFileSync(args.official,"utf8"));
  const runtime=JSON.parse(fs.readFileSync(args["tree-pre"],"utf8"));
  const pob=engine.parsePobTranslation(fs.readFileSync(args.translation,"utf8"));
  const weGame=engine.parseWeGameModule(fs.readFileSync(args.wegame,"utf8"));
  const overlay=engine.buildLocalization({officialTree:official,weGame,pob});
  const before={names:{},stats:{}};
  const after={names:{},stats:{}};
  const examples={englishStats:[],identityConflicts:[],signatureConflicts:[]};
  const uniqueStats=new Map();
  const uniqueNames=new Map();
  let namedInstances=0;
  let statInstances=0;

  for(const [id,node] of Object.entries(runtime.nodes||{})) {
    if(node.name) {
      namedInstances+=1;
      increment(before.names,pob.passiveZh.get(node.name)&&pob.passiveZh.get(node.name)!==node.name?"pobExact":"english");
      const result=engine.resolveNodeName({id,name:node.name},overlay.names,pob.passiveZh);
      increment(after.names,result.translated ? (result.source==="wegame"?"wegameConsensusOrReviewed":"pobExact") : "english");
      const nameCategory=result.translated ? (result.source==="wegame"?"wegameConsensusOrReviewed":"pobExact") : "english";
      if(!uniqueNames.has(node.name)) uniqueNames.set(node.name,new Set());
      uniqueNames.get(node.name).add(nameCategory);
    }
    for(const stat of node.stats||[]) {
      statInstances+=1;
      const canonical=cleanStatDisplay(stat);
      if(!uniqueStats.has(canonical)) uniqueStats.set(canonical,{instances:0,categories:new Set()});
      uniqueStats.get(canonical).instances+=1;
      const old=engine.translatePobStat(stat,pob);
      increment(before.stats,old.translated ? (old.quality==="pob-exact"?"pobExact":"pobTemplate") : (legacyPartial(stat)?"partialTermFallback":"english"));
      const result=overlay.stats.get(id)?.get(canonical) || old;
      const statCategory=result.translated ? (result.source==="wegame"?"wegameConsensusOrReviewed":result.quality==="pob-exact"?"pobExact":"pobTemplate") : "english";
      increment(after.stats,statCategory);
      uniqueStats.get(canonical).categories.add(statCategory);
      if(!result.translated && examples.englishStats.length<12) examples.englishStats.push({id,name:node.name,stat:canonical});
    }
  }

  for(const [id,node] of Object.entries(official.nodes||{})) {
    const wg=weGame.nodes?.[id];
    if(wg && String(wg.id)!==String(node.id) && examples.identityConflicts.length<12) examples.identityConflicts.push({id,officialRawId:node.id,weGameRawId:wg.id});
  }
  const conservativeCategory=categories=>categories.has("english")?"english":categories.has("pobTemplate")?"pobTemplate":categories.has("pobExact")?"pobExact":"wegameConsensusOrReviewed";
  const afterUnique={names:{},stats:{}};
  for(const categories of uniqueNames.values()) increment(afterUnique.names,conservativeCategory(categories));
  for(const record of uniqueStats.values()) increment(afterUnique.stats,conservativeCategory(record.categories));
  const report={
    schemaVersion:1,
    generatedAt:new Date().toISOString(),
    inputs,
    denominators:{runtimeNodeInstances:Object.keys(runtime.nodes||{}).length,namedNodeInstances:namedInstances,uniqueCanonicalNames:uniqueNames.size,statInstances,uniqueCanonicalStats:uniqueStats.size},
    before,
    after,
    afterUnique,
    gates:{...overlay.diagnostics,candidateStatus:candidate.status,fullUpstreamDataCommitted:false},
    requiredSamples:{
      node52:{name:overlay.names.get("52"),stat:[...(overlay.stats.get("52")||new Map()).values()][0]},
      node3994RuntimeStat:(runtime.nodes?.["3994"]?.stats||[])[0]||null,
      node3994Activated:[...(overlay.stats.get("3994")||new Map()).entries()],
      node46365:[...(overlay.stats.get("46365")||new Map()).entries()],
      infusion13:overlay.names.get(Object.keys(official.nodes||{}).find(id=>official.nodes[id]?.id==="infusion13")||"" )||null,
    },
    examples,
  };
  const output=JSON.stringify(report,null,2);
  if(args.output) fs.writeFileSync(path.resolve(args.output),`${output}\n`);
  process.stdout.write(`${output}\n`);
}

try { main(); } catch(error) { console.error(error.stack||error); process.exitCode=1; }
