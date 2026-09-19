"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../renderer/localization-engine.js");

const POB = `d.passives = {
  ["狂热者誓言"]="Zealot's Oath",
  ["灌注法术伤害"]="Infused Spell Damage",
}
d.classes = {
  ["战士"]="Warrior",
}
d.statLines = {
  {"伤害提高 {0}%","{0}% increased Damage"},
  {"DPS 提高 {0}%","{0}% increased DPS"},
}`;

const WEGAME = `const a=[{name:"战士"}],b={
52:{id:"passive_keystone_zealots_oath",skill:52,name:"狂热者誓言",stats:[\`再生的溢出生命回复会作用于[EnergyShield|能量护盾]。
[EnergyShield|能量护盾]无法充能。\`]},
3994:{id:"deflect49",skill:3994,name:"偏转",stats:["获得相当于[Evasion|闪避值] 8% 的[Deflect|偏转值]"]},
46365:{id:"minion_reservation12",skill:46365,name:"庞大侍从",stats:["召唤生物技能的保留效能降低 25%","你的召唤生物为庞然大物"]},
13:{id:"infusion13",skill:13,name:"灌注消耗几率",stats:["错误语义"]},
14:{id:"attributes_semantic_guard",skill:14,name:"属性",stats:["+5 [Attribute|敏捷]"]}
},c={};export{a as classes,b as nodes,c as skillOverrides};`;

const OFFICIAL = { nodes: {
  52: { id:"passive_keystone_zealots_oath", name:"Zealot's Oath", stats:["Excess Life Recovery from Regeneration is applied to [EnergyShield|Energy Shield]\n[EnergyShield|Energy Shield] does not Recharge"] },
  3994: { id:"deflect49", name:"Deflection", stats:["Gain [Deflect|Deflection Rating] equal to 8% of [Evasion|Evasion Rating]"] },
  46365: { id:"minion_reservation12", name:"Gigantic Minions", stats:["Your Minions are Gigantic","25% reduced Reservation Efficiency of Minion Skills"] },
  13: { id:"infusion13", name:"Infused Spell Damage", stats:["Infused Spells deal 8% increased Damage"] },
  14: { id:"attributes_semantic_guard", name:"Attributes", stats:["+5 [Attribute|Strength]"] },
} };

test("uses verified full WeGame line for node 52 without partial English replacement", () => {
  const pob=engine.parsePobTranslation(POB);
  const overlay=engine.buildLocalization({officialTree:OFFICIAL,weGame:engine.parseWeGameModule(WEGAME),pob});
  const input=OFFICIAL.nodes[52].stats[0];
  const result=overlay.stats.get("52").get("Excess Life Recovery from Regeneration is applied to Energy Shield\nEnergy Shield does not Recharge");
  assert.equal(result.value,"再生的溢出生命回复会作用于能量护盾。\n能量护盾无法充能。");
  assert.equal(result.source,"wegame");
  assert.equal(input,OFFICIAL.nodes[52].stats[0],"canonical input must not be mutated");
});

test("blocks numeric drift, handles reordered stats, and blocks raw-id conflicts", () => {
  const pob=engine.parsePobTranslation(POB);
  const overlay=engine.buildLocalization({officialTree:OFFICIAL,weGame:engine.parseWeGameModule(WEGAME),pob});
  const drift=overlay.stats.get("3994").get("Gain Deflection Rating equal to 8% of Evasion Rating");
  assert.equal(drift.source,"wegame");
  assert.equal(overlay.stats.get("3994").get("Gain Deflection Rating equal to 6% of Evasion Rating"),undefined);
  assert.equal(overlay.stats.get("46365").get("Your Minions are Gigantic").value,"你的召唤生物为庞然大物");
  assert.equal(overlay.stats.get("46365").get("25% reduced Reservation Efficiency of Minion Skills").value,"召唤生物技能的保留效能降低 25%");
  assert.equal(overlay.names.get("13").source,"pob2");
  assert.equal(overlay.diagnostics.identityConflicts,0);
});

test("keeps reviewed infusion13 semantic conflict on reliable PoB name", () => {
  const pob=engine.parsePobTranslation(POB);
  const overlay=engine.buildLocalization({officialTree:OFFICIAL,weGame:engine.parseWeGameModule(WEGAME),pob});
  assert.equal(overlay.names.get("13").value,"灌注法术伤害");
  assert.equal(overlay.names.get("13").source,"pob2");
});

test("rejects same-number different-semantics WeGame text without consensus or explicit review", () => {
  const pob=engine.parsePobTranslation(POB);
  const overlay=engine.buildLocalization({officialTree:OFFICIAL,weGame:engine.parseWeGameModule(WEGAME),pob});
  const result=overlay.stats.get("14").get("+5 Strength");
  assert.equal(result.source,"canonical-english");
  assert.equal(result.value,"+5 Strength");
});

test("PoB templates preserve numbers and legitimate ASCII while missing text stays whole English", () => {
  const pob=engine.parsePobTranslation(POB);
  assert.deepEqual(engine.translatePobStat("17% increased Damage",pob),{
    value:"伤害提高 17%",source:"pob2",quality:"pob-template",translated:true
  });
  assert.equal(engine.translatePobStat("12% increased DPS",pob).value,"DPS 提高 12%");
  assert.deepEqual(engine.translatePobStat("Enemies Recharge Energy Shield",pob),{
    value:"Enemies Recharge Energy Shield",source:"canonical-english",quality:"english-fallback",translated:false,reason:"missing"
  });
});

test("static WeGame parser rejects executable identifiers", () => {
  assert.throws(()=>engine.parseWeGameModule("const a=[],b=runRemoteCode(),c={};export{a as classes,b as nodes,c as skillOverrides};"),/non-literal identifier|unexpected|cannot locate/);
});
