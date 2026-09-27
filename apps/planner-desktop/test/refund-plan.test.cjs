"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const pg=require("../renderer/passive-graph.js"),refund=require("../renderer/refund-plan.js");
const source=fs.readFileSync(path.join(__dirname,"../renderer/planner.js"),"utf8");
function extract(name){const start=source.indexOf("function "+name+"(");const end=source.indexOf("\nfunction ",start+1);assert.ok(start>=0);return source.slice(start,end);}
function scope({edges,normal,ws1=[],ws2=[],asc=["a"],conditional=[]}){
  const ids=[...new Set([...edges.flat(),...normal,...ws1,...ws2,...asc])];
  const nodes=ids.map(id=>({id,asc:id.startsWith("a")?"asc":null}));
  const s={nodes,edges:edges.map(([f,t])=>({f,t})),byId:new Map(nodes.map(n=>[n.id,n])),allocated:new Set(normal),weaponSet1Allocated:new Set(ws1),weaponSet2Allocated:new Set(ws2),ascAllocated:new Set(asc),classStartId:"0",ascStartId:"a",undo:0,
    window:{plannerRefundPlan:refund},idOf:n=>n.id,isAsc:n=>!!n.asc,isMasteryVisual:()=>false,isInstillExclusiveNode:()=>false,
    passiveGraph:pg.createPassiveGraph(nodes,edges.map(([f,t])=>({f,t}))),reachableEligibleIds:pg.reachableEligibleIds,
    clearPreviews(){},rebuildPathIndex(){},rebuildAscPathIndex(){},updatePlannerUI(){},displayNodeName:n=>n.id};
  s.pushUndo=()=>{s.undo++;};
  s.weaponSetForMode=m=>m==="ws1"?s.weaponSet1Allocated:s.weaponSet2Allocated;
  s.weaponSetLabel=m=>m;
  s.isHiddenConditional=n=>conditional.some(([id])=>id===n.id);
  s.constraintSatisfied=(n,active)=>{active ||= new Set([...s.allocated,...s.ascAllocated]);return conditional.filter(([id])=>id===n.id).every(([,req])=>active.has(req));};
  s.constraintSatisfiedWithActive=s.constraintSatisfied;
  s.hiddenDependentsOf=ids=>conditional.filter(([id,req])=>s.allocated.has(id)&&ids.has(req)).map(([id])=>s.byId.get(id));
  s.canTraverseWithActive=(n,active)=>!n.asc&&s.constraintSatisfied(n,active);
  s.canTraverse=n=>s.canTraverseWithActive(n,null);s.canTraverseAsc=n=>n.asc==="asc";
  vm.createContext(s);
  for(const name of ["planCurrentRefund","applyCurrentRefund","pruneWeaponSet","revalidateOrdinaryAllocated","refundNormalTarget","refundWeaponTarget","refundAscTarget"])
    vm.runInContext(extract(name),s);
  return s;
}
const state=s=>JSON.stringify([s.allocated,s.weaponSet1Allocated,s.weaponSet2Allocated,s.ascAllocated].map(x=>[...x].sort()));
const chain={edges:[["0","1"],["1","2"],["2","3"],["a","a1"],["a1","a2"]],normal:["0","1","2","3"],asc:["a","a1","a2"]};
test("confirmed refunds compare live snapshot and exact category sets before one atomic commit",()=>{
  for(const kind of ["missing","stale","same-count","duplicate","wrong-category","valid"]){
    const s=scope(chain),before=state(s),plan=s.planCurrentRefund("1","general");
    s.window.captureBuildState=()=>({});
    s.window.plannerTreeSnapshot={publishProjectedSnapshot:()=>({snapshotId:"live"})};
    const start=source.indexOf("function deallocateConfirmed(");
    vm.runInContext(source.slice(start,source.indexOf("\n}",start)+2),s);
    let confirmation={snapshotId:"live",removedByCategory:structuredClone(plan.removedByCategory)};
    if(kind==="missing")confirmation=null;
    if(kind==="stale")confirmation.snapshotId="old";
    if(kind==="same-count")confirmation.removedByCategory.general[1]="other";
    if(kind==="duplicate")confirmation.removedByCategory.general[1]="1";
    if(kind==="wrong-category"){confirmation.removedByCategory.weaponSet1=confirmation.removedByCategory.general;confirmation.removedByCategory.general=[];}
    const result=s.deallocateConfirmed("1","general",confirmation);
    assert.equal(result.success,kind==="valid");
    assert.equal(s.undo,kind==="valid"?1:0);
    if(kind!=="valid")assert.equal(state(s),before);
  }
});
test("legacy predicate callbacks ignore array indexes and graph node IDs",()=>{
  const s={unlockConstraintOf:n=>n.constraint,constraintAscendancyMatches:()=>true,
    allAllocatedIds:()=>new Set(["required"]),constraintNodeIds:()=>["required"],
    isAsc:()=>false,isMasteryVisual:()=>false,isInstillExclusiveNode:()=>false,
    isLegacyStartArtifact:()=>false,isClassStart:()=>false,isConditionalReveal:()=>true};
  vm.createContext(s);
  for(const name of ["constraintSatisfied","constraintSatisfiedWithActive","canTraverse","canTraverseWithActive"])vm.runInContext(extract(name),s);
  assert.equal([{constraint:{}},{constraint:{}}].filter(s.constraintSatisfied).length,2);
  assert.equal(s.canTraverse({constraint:{}},"node-id"),true);
  assert.equal(s.canTraverseWithActive({constraint:{}},new Set()),false);
});
for(const [label,fixture,id,category,expected] of [
  ["leaf",chain,"3","general",[]],
  ["cut vertex crosses any cluster boundary",chain,"1","general",["2","3"]],
  ["cycle alternative path",{...chain,edges:[...chain.edges,["0","3"]]},"1","general",[]],
  ["weapon I cascade",{...chain,normal:["0"],ws1:["1","2","3"],ws2:["1"]},"1","weaponSet1",["2","3"]],
  ["weapon II independent",{...chain,normal:["0"],ws1:["1","2","3"],ws2:["1"]},"1","weaponSet2",[]],
  ["general also prunes weapon branches",{...chain,normal:["0","1"],ws1:["2","3"],ws2:["2"]},"1","general",["2","3"]],
  ["ascendancy cascade",chain,"a1","ascendancy",["a2"]],
]) test(label+": pure preview equals write and original UI rule",()=>{
  const s=scope(fixture),before=state(s),p=s.planCurrentRefund(id,category);
  assert.equal(p.success,true);assert.deepEqual(p.cascadeNodeIds,expected);
  assert.equal(p.additionalRefundCount,expected.length);assert.equal(p.totalRefundCount,expected.length+1);
  assert.equal(state(s),before);assert.equal(s.undo,0);
  const actual=s.applyCurrentRefund(id,category);assert.equal(actual.success,true);assert.equal(s.undo,1);
  const oracle=scope(fixture);
  if(category==="general")oracle.refundNormalTarget(oracle.byId.get(id));
  else if(category==="ascendancy")oracle.refundAscTarget(oracle.byId.get(id));
  else oracle.refundWeaponTarget(oracle.byId.get(id),category==="weaponSet1"?"ws1":"ws2");
  assert.equal(state(s),state(oracle));
});
test("protected starts and conditional blockers have no invented zero cost",()=>{
  for(const [id,category,fixture,code] of [["0","general",chain,"START_NODE_PROTECTED"],["a","ascendancy",chain,"START_NODE_PROTECTED"],["1","general",{...chain,conditional:[["3","1"]]},"BLOCKED_BY_CONDITIONAL"],["a1","ascendancy",{...chain,conditional:[["3","a1"]]},"BLOCKED_BY_CONDITIONAL"]]){
    const s=scope(fixture),before=state(s),p=s.planCurrentRefund(id,category);
    assert.equal(p.success,false);assert.equal(p.errorCode,code);assert.equal(p.totalRefundCount,undefined);
    assert.equal(state(s),before);assert.equal(s.undo,0);
  }
});

test("live capture carries pure plans through snapshot publication without editing Build or undo",async()=>{
  const s=scope(chain),before=state(s);
  Object.assign(s,{baseClassName:"fixture",selectedAscendancyId:"asc",maxPoints:123,maxWeaponPoints:24,maxAscPoints:8,
    instillAllocated:new Set(),ascendancyOptions:[],showAsc:true,showLockedConditional:false,showInstillOnGraph:false,showSmall:true,weaponMode:"general",
    i18n:{ready:true},displayNodeName:n=>n.id,displayStat:x=>x,_plannerSortedIds:ids=>[...ids].sort()});
  const start=source.indexOf("window.captureBuildState = function()");
  vm.runInContext(source.slice(start,source.indexOf("\n};",start)+3),s);
  const captured=s.window.captureBuildState();
  assert.deepEqual(captured.refundImpacts["1"][0].cascadeNodeIds,["2","3"]);
  assert.equal(state(s),before);assert.equal(s.undo,0);
  const {createTreeSnapshotProvider}=require("../electron/tree-tools.cjs");
  const publish=createTreeSnapshotProvider(null,"fixture");
  const full=await publish(JSON.parse(JSON.stringify(captured)));
  assert.equal(full._error,undefined);
  assert.deepEqual(full.refundImpacts["1"][0].cascadeNodeIds,["2","3"]);
  s.applyCurrentRefund("1","general");
  const next=await publish(JSON.parse(JSON.stringify(s.window.captureBuildState())));
  assert.notEqual(full.snapshotId,next.snapshotId);
  assert.equal(next.refundImpacts["1"],undefined);
  // Oversized derived plans must not survive the renderer's compact error projection.
  let first=true;
  s.window.plannerRefundPlan={...refund,describe:plan=>{
    if(!first)return refund.describe(plan);
    first=false;return {cascadeNodeIds:["x".repeat(8000001)]};
  }};
  const beforeOverflow=state(s),undoBefore=s.undo;
  const overflow=s.window.captureBuildState();
  assert.match(overflow._projectionError,/exceeds/);
  assert.equal(JSON.stringify(overflow.refundImpacts),"{}");
  assert.ok(JSON.stringify(overflow).length<8000000);
  const rejected=await publish(JSON.parse(JSON.stringify(overflow)));
  assert.ok(rejected._error);
  assert.equal(rejected.refundImpacts,undefined);
  assert.equal(state(s),beforeOverflow);assert.equal(s.undo,undoBefore);
});
