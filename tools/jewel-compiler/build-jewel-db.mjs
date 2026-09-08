#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const rawDir = path.join(here, "raw");
const distDir = path.join(here, "dist");
await fs.mkdir(distDir,{recursive:true});

async function read(p,required=true){try{return await fs.readFile(p,"utf8");}catch(e){if(required)throw e;return null;}}
async function readJson(p,required=true){const t=await read(p,required);return t==null?null:JSON.parse(t);}
function stripHtml(html){return String(html||"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g," ").trim();}
function quotedStrings(s){const out=[];const re=/"((?:\\.|[^"\\])*)"/g;let m;while((m=re.exec(s)))out.push(m[1].replace(/\\"/g,'"').replace(/\\\\/g,'\\'));return out;}
function parseLuaArrayStrings(line,key){const m=line.match(new RegExp(`${key}\\s*=\\s*\\{([^}]*)\\}`));return m?quotedStrings(m[1]):[];}
function parseLuaArrayNumbers(line,key){const m=line.match(new RegExp(`${key}\\s*=\\s*\\{([^}]*)\\}`));return m?m[1].split(",").map(x=>Number(x.trim())).filter(Number.isFinite):[];}
function parseNumberRange(text){const m=String(text||"").match(/\((-?\d+(?:\.\d+)?)\s*[—-]\s*(-?\d+(?:\.\d+)?)\)/);return m?{min:Number(m[1]),max:Number(m[2])}:null;}

function parseModJewel(text){
  const mods=[];
  for(const rawLine of String(text||"").split(/\r?\n/)){
    const line=rawLine.trim(); if(!line.startsWith('["Jewel'))continue;
    const idm=line.match(/^\["([^"]+)"\]\s*=\s*\{/), typem=line.match(/\btype\s*=\s*"([^"]+)"/), affixm=line.match(/\baffix\s*=\s*"([^"]+)"/), groupm=line.match(/\bgroup\s*=\s*"([^"]+)"/), levelm=line.match(/\blevel\s*=\s*(\d+)/);
    if(!idm)continue;
    const after=affixm?line.slice(line.indexOf(affixm[0])+affixm[0].length):line;
    const statMatch=after.match(/,\s*"((?:\\.|[^"\\])*)"\s*,/);
    const stat=statMatch?statMatch[1].replace(/\\"/g,'"'):null;
    const wk=parseLuaArrayStrings(line,"weightKey"),wv=parseLuaArrayNumbers(line,"weightVal"),weights={};wk.forEach((k,i)=>weights[k]=wv[i]??null);
    mods.push({id:idm[1],type:typem?.[1]??null,affix:affixm?.[1]??null,group:groupm?.[1]??null,level:levelm?Number(levelm[1]):null,stat,range:parseNumberRange(stat),weights,tags:parseLuaArrayStrings(line,"modTags"),stat_order:parseLuaArrayNumbers(line,"statOrder")});
  }
  return mods;
}
function parseMisc(text){const out={};const m=String(text||"").match(/PassiveTreeJewelDistanceMultiplier\s*=\s*([0-9.]+)/);if(m)out.PassiveTreeJewelDistanceMultiplier=Number(m[1]);return out;}
function extractSockets(data){const out=[];for(const [id,n] of Object.entries(data?.nodes||{})){if(!n)continue;if(n.isJewelSocket||n.isJewelSocketExpansion||/Jewel Socket/i.test(String(n.name||""))){out.push({node_id:String(id),name:n.name||"Jewel Socket",x:Number.isFinite(Number(n.x))?Number(n.x):null,y:Number.isFinite(Number(n.y))?Number(n.y):null,group:n.group??null,orbit:n.orbit??null,orbit_index:n.orbitIndex??null,sinister:Boolean(n.isSinisterJewelSocket||n.sinister||/Sinister Jewel Socket/i.test(String(n.name||""))),no_radius:Boolean(n.noRadius),blighted:Boolean(n.isBlighted)});}}return out;}

const UNIQUE_DEFS=[
  {name:"Heroic Tragedy",base:"Timeless Jewel",family:"timeless_conqueror",tokens:["Conquered by the Kalguur"]},
  {name:"Undying Hate",base:"Timeless Jewel",family:"timeless_conqueror",tokens:["Conquered by the Abyssals"]},
  {name:"Grand Spectrum",base:null,family:"global_stack",tokens:["per socketed Grand Spectrum"]},
  {name:"Split Personality",base:"Ruby",family:"alternate_start",tokens:["starting point"]},
  {name:"Voices",base:"Sapphire",family:"grant_sinister_sockets",tokens:["Sinister Jewel sockets"]},
  {name:"Megalomaniac",base:"Diamond",family:"grant_passives",tokens:["Allocates Passive Skill"]},
  {name:"From Nothing",base:"Diamond",family:"disconnected_allocation",tokens:["can be Allocated","without being connected to your tree"]},
  {name:"Controlled Metamorphosis",base:"Diamond",family:"ring_disconnected_allocation",tokens:["Medium-Large Ring","without being connected to your tree"]},
  {name:"Prism of Belief",base:"Diamond",family:"skill_level",tokens:["Level of all Specific Skill Skills"]},
  {name:"The Adorned",base:"Diamond",family:"jewel_effect_multiplier",tokens:["Effect of Jewel Socket Passive Skills","Corrupted Magic Jewels"]},
  {name:"Heart of the Well",base:"Diamond",family:"custom_desecrated",tokens:["Custom Desecrated prefix"]},
  {name:"Flesh Crucible",base:"Diamond",family:"random_keystone",tokens:["Random 1 Keystone Passive Skill"]},
  {name:"Against the Darkness",base:"Time-Lost Diamond",family:"time_lost_radius",tokens:["local jewel effect base radius","Random Jewel Modifiers"]}
];

function locateUniqueEffectsFromHtml(html){
  const text=stripHtml(html); const out=[];
  for(const def of UNIQUE_DEFS){
    const i=text.indexOf(def.name); if(i<0)continue;
    const chunk=text.slice(i,Math.min(text.length,i+900));
    const effects=[];
    for(const token of def.tokens){const ti=chunk.indexOf(token);if(ti>=0){let s=Math.max(0,ti-90),e=Math.min(chunk.length,ti+token.length+180);effects.push(chunk.slice(s,e).replace(/\s+/g," ").trim());}}
    out.push({...def,effects,source:"poe2db_html",verified_tokens:effects.length});
  }
  return out;
}

function inferSpecialRules(modParser,calcSetup){
  const hay=(String(modParser||"")+"\n"+String(calcSetup||""));
  const evidence=[];
  const pats=[
    ["radius_jewel_pipeline",/radiusJewelList|jewelRadiusIndex|nodesInRadius/i],
    ["sinister_exclusion",/sinister/i],
    ["corrupted_jewel_effect",/CorruptedMagicJewelEffect|Corrupted.*JewelEffect/i],
    ["passive_skill_other_effect",/PassiveSkillHasOtherEffect|NodeModifier/i],
    ["time_lost_special_case",/Time%-Lost|Time-Lost/i],
    ["timeless_special_case",/Timeless Jewel/i]
  ];
  for(const [id,re] of pats)evidence.push({id,present:re.test(hay)});
  return evidence;
}

function ruleObjects(uniqueRows,constants,evidence){
  const radiusMul=constants.PassiveTreeJewelDistanceMultiplier??1.2;
  const families={};
  for(const j of uniqueRows)(families[j.family]??=[]).push(j.name);
  return {
    schema_version:2,
    radius:{distance_multiplier:radiusMul,distance_formula:"sqrt((node.x-socket.x)^2+(node.y-socket.y)^2)",implementation:"precompute nodesInRadius per socket/radius"},
    socket_types:{normal:{tree_connected:true,participates_in_radius:true,unique_allowed:true},sinister:{tree_connected:false,participates_in_radius:false,unique_allowed:false,affected_by_jewel_socket_effect:false}},
    families:{
      disconnected_allocation:{planner_effect:"allow nodes in configured radius around a passive target to allocate without graph connectivity"},
      ring_disconnected_allocation:{planner_effect:"same as disconnected_allocation but only nodes within inner..outer ring"},
      grant_sinister_sockets:{planner_effect:"create N display-only sinister jewel sockets"},
      grant_passives:{planner_effect:"grant named passive(s) without normal path cost"},
      jewel_effect_multiplier:{planner_effect:"scale effects of qualifying jewels in normal jewel sockets"},
      alternate_start:{planner_effect:"add an additional valid passive allocation root"},
      time_lost_radius:{planner_effect:"apply radius jewel modifiers to eligible nodes in range"},
      timeless_conqueror:{planner_effect:"replace/modify passives according to seed lookup tables"},
      random_keystone:{planner_effect:"assign a keystone/effect selected by jewel roll"}
    },
    catalog_by_family:families,
    reference_evidence:evidence
  };
}

const modText=await read(path.join(rawDir,"pob2-ModJewel.lua"));
const miscText=await read(path.join(rawDir,"pob2-Misc.lua"));
const tree=await readJson(path.join(rawDir,"ggg-poe2-skilltree-data.json"));
const poe2dbHtml=await read(path.join(rawDir,"poe2db-jewels.html"),false);
const modParser=await read(path.join(rawDir,"pob2-ModParser.lua"),false);
const calcSetup=await read(path.join(rawDir,"pob2-CalcSetup.lua"),false);

const mods=parseModJewel(modText),constants=parseMisc(miscText),sockets=extractSockets(tree);
let uniques=poe2dbHtml?locateUniqueEffectsFromHtml(poe2dbHtml):[];
if(!uniques.length){
  const seed=await readJson(path.join(here,"poe2_jewel_catalog_seed.json"),false)||{};
  uniques=(seed.known_unique_jewels||[]).map((x,i)=>({id:`seed:${i}:${x.name}`,name:x.name,base:x.base||null,family:x.rule_family||"unknown",effects:x.effect||[],source:"seed_fallback",verified_tokens:0}));
}
const evidence=inferSpecialRules(modParser,calcSetup),rules=ruleObjects(uniques,constants,evidence);
const report={schema_version:2,compiled_at:new Date().toISOString(),counts:{jewel_mods:mods.length,jewel_sockets:sockets.length,unique_jewels:uniques.length,rule_families:Object.keys(rules.families).length},constants,source_status:{poe2db:Boolean(poe2dbHtml),mod_parser:Boolean(modParser),calc_setup:Boolean(calcSetup)},warnings:[]};
if(!poe2dbHtml)report.warnings.push("PoE2DB HTML missing: unique catalog fell back to seed.");
if(!modParser||!calcSetup)report.warnings.push("PoB runtime sources missing: special-rule evidence incomplete.");

await fs.writeFile(path.join(distDir,"jewel_mods.json"),JSON.stringify({schema_version:2,mods},null,2));
await fs.writeFile(path.join(distDir,"jewel_sockets.json"),JSON.stringify({schema_version:2,sockets},null,2));
await fs.writeFile(path.join(distDir,"jewel_constants.json"),JSON.stringify({schema_version:2,...constants},null,2));
await fs.writeFile(path.join(distDir,"unique_jewels.json"),JSON.stringify({schema_version:2,jewels:uniques},null,2));
await fs.writeFile(path.join(distDir,"jewel_tree_rules.json"),JSON.stringify(rules,null,2));
await fs.writeFile(path.join(distDir,"compile_report.json"),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
