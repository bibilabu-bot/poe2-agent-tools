"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {buildTriggerIndex,isTriggered}=require("../renderer/mastery-visual-state.js");
const empty=()=>new Set();
const nodes=[
  {id:"m1",mastery:true,group:1,activeEffectImage:"same.png"},
  {id:"m2",mastery:true,group:2,activeEffectImage:"same.png"},
  {id:"a",group:1,activeEffectImage:"same.png"},{id:"b",group:2,activeEffectImage:"same.png"},
  {id:"unrelated",group:1},{id:"asc",asc:true},{id:"hidden",displayOnly:true}];
function index(list=nodes,links={m1:["a"],m2:["b"]}) {
  return buildTriggerIndex(list,{getId:n=>n.id,isMastery:n=>!!n.mastery,
    isEligible:n=>!n.asc&&!n.displayOnly,neighbors:id=>links[id]});
}
test("shared texture never activates another cluster or unrelated same-group nodes",()=>{
  const map=index();
  assert.deepEqual(map.get("m1"),["a"]);
  assert.equal(isTriggered(map.get("m1"),new Set(["b","unrelated"]),empty(),empty()),false);
  assert.equal(isTriggered(map.get("m2"),new Set(["b"]),empty(),empty()),true);
});
test("direct cluster allocation activates and deallocation extinguishes",()=>{
  const ids=index().get("m1"),allocated=empty();
  allocated.add("a");assert.equal(isTriggered(ids,allocated,empty(),empty()),true);
  allocated.delete("a");assert.equal(isTriggered(ids,allocated,empty(),empty()),false);
});
test("hover/preview is not allocation; weapon groups I and II both follow displayed allocation",()=>{
  const ids=index().get("m1"),preview=new Set(["a"]);
  assert.equal(isTriggered(ids,empty(),empty(),empty(),preview),false);
  for(const group of [1,2]) {
    const ws1=empty(),ws2=empty();(group===1?ws1:ws2).add("a");
    assert.equal(isTriggered(ids,empty(),ws1,ws2),true);
    (group===1?ws1:ws2).clear();assert.equal(isTriggered(ids,empty(),ws1,ws2),false);
  }
});
test("missing membership stays inactive; explicit edges work without group or texture",()=>{
  assert.deepEqual(index(nodes,{}).get("m1"),[]);
  assert.equal(isTriggered(undefined,new Set(["a"]),empty(),empty()),false);
  assert.deepEqual(index([{id:"m",mastery:true},{id:"a"}],{m:["a"]}).get("m"),["a"]);
});
test("explicit cross-visual-group membership is preserved, invalid targets are excluded",()=>{
  assert.deepEqual(index(nodes,{m1:["b","b","missing","m1","m2","asc","hidden"]}).get("m1"),["b"]);
});
