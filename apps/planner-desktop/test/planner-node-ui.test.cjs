"use strict";
const test=require("node:test"), assert=require("node:assert/strict");
const fs=require("node:fs"), path=require("node:path"), vm=require("node:vm");
const source=fs.readFileSync(path.join(__dirname,"../renderer/planner.js"),"utf8");
function extract(name) {
  const start=source.indexOf("function "+name+"(");
  assert.ok(start>=0,name);
  const end=source.indexOf("\nfunction ",start+1);
  return source.slice(start,end<0?source.length:end);
}
test("exact ID is unique, preserves visibility and leaves text search compatible",()=>{
  const fields={"#search":{value:"54814"},"#searchMode":{value:"id"},"#searchCount":{},"#searchPos":{}};
  const nodes=[{id:"54814",name:"Presence"},{id:"154814",name:"Presence"}];
  const scope={nodes,byId:new Map(nodes.map(n=>[n.id,n])),$:id=>fields[id],
    searchMatches:[],searchMatchIds:new Set(),searchMatchIndex:-1,exactSearchStatus:"",
    searchHighlightActive:false,showAsc:true,showSmall:true,kind:n=>n.kind,selectedAscendancyId:null,
    isMasteryVisual:()=>false,isLegacyStartArtifact:()=>false,isInstillExclusiveNode:()=>false,
    isAsc:()=>false,isConditionalReveal:()=>false,visibleNode:n=>!n.hidden,
    searchTypeMatches:()=>true,nodeSearchText:n=>n.name.toLowerCase(),idOf:n=>n.id,scheduleDraw:()=>{}};
  vm.createContext(scope);
  vm.runInContext(extract("recomputeSearchMatches")+extract("updateSearchUI"),scope);
  scope.recomputeSearchMatches(); assert.equal(scope.searchMatches.length,1);
  assert.equal(scope.searchMatches[0].id,"54814");
  fields["#search"].value="548";scope.recomputeSearchMatches();assert.equal(scope.searchMatches.length,0);
  assert.match(fields["#searchCount"].textContent,/找不到/);
  fields["#search"].value="54814";nodes[0].hidden=true;
  scope.recomputeSearchMatches();assert.equal(scope.searchMatches.length,0);
  assert.match(fields["#searchCount"].textContent,/不可见/);assert.equal(nodes[0].hidden,true);
  scope.isAsc=n=>!!n.asc;nodes[0].asc="test";nodes[0].kind="small";
  scope.selectedAscendancyId="test";scope.showSmall=false;
  scope.recomputeSearchMatches();assert.equal(scope.searchMatches.length,0);
  assert.match(fields["#searchCount"].textContent,/不可见/);
  scope.isAsc=()=>false;
  fields["#searchMode"].value="text";fields["#search"].value="presence";
  scope.recomputeSearchMatches();assert.equal(scope.searchMatches.length,2);
});
test("notable labels stay hidden when selected, highlighted or instill-exclusive",()=>{
  const scope={showLabels:true,kind:n=>n.kind,isInstillExclusiveNode:n=>!!n.instill,
    isClassStart:()=>false,selected:null,searchHighlightActive:true};
  vm.createContext(scope);vm.runInContext(extract("shouldDrawNodeLabel"),scope);
  for(const instill of [false,true]) {
    const n={kind:"notable",instill};scope.selected=n;
    assert.equal(scope.shouldDrawNodeLabel(n,"near"),false);
  }
  assert.equal(scope.shouldDrawNodeLabel({kind:"keystone"},"near"),true);
  scope.selected={kind:"small"};assert.equal(scope.shouldDrawNodeLabel(scope.selected,"near"),true);
});
module.exports={extract};
