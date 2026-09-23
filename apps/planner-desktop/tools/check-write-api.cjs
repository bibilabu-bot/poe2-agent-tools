"use strict";
// Exercise window.plannerWriteAPI.allocate / deallocate on a hidden renderer.
// Run: cd apps/planner-desktop && node tools/check-write-api.cjs
const {app,BrowserWindow,protocol,session}=require("electron");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),assert=require("node:assert/strict");

const cache=process.env.P2AT_GAME_CACHE||path.join(process.env.APPDATA,"poe2-planner-desktop","game-data");
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"p2at-write-api-"));
app.setPath("userData",temp);
protocol.registerSchemesAsPrivileged([{scheme:"poe2",privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);

const errors=[];
let stage="init";
setTimeout(()=>{console.error("TIMEOUT at",stage);app.exit(1);},60000).unref();

app.whenReady().then(async()=>{
  stage="ready";

  // Serve cached game data
  session.fromPartition("write-api-test").protocol.handle("poe2",async request=>{
    const url=new URL(request.url),name=path.basename(url.pathname);
    const folder=url.hostname==="localization"?"localization-candidates":url.hostname==="portraits"?"portraits":"core";
    const filename=path.join(cache,folder,name);
    return fs.existsSync(filename)?new Response(fs.readFileSync(filename)):new Response("missing",{status:404});
  });

  const win=new BrowserWindow({show:false,width:1300,height:850,webPreferences:{partition:"write-api-test",preload:path.resolve(__dirname,"../electron/preload.cjs"),contextIsolation:true,nodeIntegration:false,sandbox:false}});
  win.webContents.on("console-message",(_e,_level,message)=>{if(/Error|failed|not defined/i.test(message)&&!/i18n/.test(message))errors.push(message.slice(0,300));});

  await win.loadFile(path.resolve(__dirname,"../renderer/index.html"));
  stage="page-loaded";
  const run=code=>win.webContents.executeJavaScript(code);

  // Wait for renderer bootstrap
  for(let i=0;i<200;i++){
    if(await run("typeof window.plannerWriteAPI!=='undefined' && typeof window.captureBuildState==='function' && i18n.ready"))break;
    await new Promise(r=>setTimeout(r,100));
  }

  const hasAPI=await run("typeof window.plannerWriteAPI!=='undefined' && typeof window.plannerWriteAPI.allocate==='function' && typeof window.plannerWriteAPI.deallocate==='function'");
  console.log("API present:",hasAPI);
  assert.ok(hasAPI,"plannerWriteAPI must be defined after page load");

  // Load WeGame fixture
  const fixture=JSON.parse(fs.readFileSync(path.resolve(__dirname,"../fixtures/wegame-share/public-share.sanitized.json"),"utf-8"));
  const official=JSON.parse(fs.readFileSync(path.join(cache,"core/official-data.json"),"utf-8"));
  const adapted=require("../src/interop/wegame-import-adapter.js").adaptWeGamePassiveImport({
    roleInfo:fixture.roleInfo,talentTree:fixture.talentTree
  },official);
  await run(`applyPlannerBuildState(weGameImportUI.createPlannerCandidate(${JSON.stringify(adapted)},{baseClassName:'Mercenary',ascendancyId:'Mercenary3',partialImportAcknowledged:true},currentBuildRuntimeState(),weGamePlannerCatalog()))`);
  stage="fixture-loaded";
  console.log("Fixture loaded — Mercenary / Gemling Legionnaire");

  // ─── 1. Read current state ───
  const before=await run("window.captureBuildState()");
  console.log("General allocated:",before.allocated.length,"| WS1:",before.weaponSet1Allocated.length,"| WS2:",before.weaponSet2Allocated.length,"| Asc:",before.ascAllocated.length);
  console.log("Passive used:",before.passivePointsUsed,"/",before.maxPoints,"| Asc used:",before.ascPointsUsed,"/",before.maxAscPoints);
  console.log();

  // ─── 2. Allocate a reachable node (pick one from the capture) ───
  const candidates=await run(`(function(){var state=window.captureBuildState();var ids=new Set(state.allocated);return state.nodes.filter(n=>{var ns=byId.get(n.id);if(ids.has(n.id)||!ns||isAsc(ns)||!canTraverse(ns)||isHiddenConditional(ns))return false;var p=pathFromActiveSet(n.id,"general");return p.length>=2&&p.length<=5;}).map(n=>n.id);})()`);
  console.log("Allocation candidates (reachable, non-conditional, non-asc):",candidates);

  let targetId=null;
  for(const cid of candidates){
    const pathInfo=await run(`(function(){var id="${cid}";var p=pathFromActiveSet(id,"general");return p?{len:p.length,first:p[0],last:p[p.length-1]}:null;})()`);
    if(pathInfo&&pathInfo.len>=2&&pathInfo.len<=5){
      targetId=cid;
      console.log("Selected target:",targetId,"— path length:",pathInfo.len);
      break;
    }
  }
  assert.ok(targetId,"Need at least one reachable allocation candidate");

  // ─── 3. Test ALLOCATE ───
  stage="allocate";
  const allocResult=await run(`window.plannerWriteAPI.allocate("${targetId}")`);
  console.log("\nALLOCATE result:",JSON.stringify(allocResult,null,2));
  assert.equal(allocResult.success,true,"Allocate must succeed: "+JSON.stringify(allocResult));
  assert.ok(Array.isArray(allocResult.newIds)&&allocResult.newIds.length>0,"Allocate must return newIds");
  assert.ok(allocResult.cost>0,"Allocate must report cost > 0");

  // Verify state changed
  const afterAlloc=await run("window.captureBuildState()");
  console.log("After allocate — passiveUsed:",afterAlloc.passivePointsUsed,"allocated:",afterAlloc.allocated.length);
  assert.ok(afterAlloc.passivePointsUsed>before.passivePointsUsed,"Passive used must increase");
  assert.ok(afterAlloc.allocated.some(id=>allocResult.newIds.includes(id)),"New IDs must appear in allocated set");

  // ─── 4. Test DEALLOCATE ───
  stage="deallocate";
  // Deallocate the last new node (closest to target)
  const undoId=allocResult.newIds[allocResult.newIds.length-1];
  console.log("\nDeallocating:",undoId);
  const deallocResult=await run(`window.plannerWriteAPI.deallocate("${undoId}")`);
  console.log("DEALLOCATE result:",JSON.stringify(deallocResult,null,2));
  assert.equal(deallocResult.success,true,"Deallocate must succeed: "+JSON.stringify(deallocResult));
  assert.ok(Array.isArray(deallocResult.removedIds)&&deallocResult.removedIds.length>0,"Must return removedIds");

  const afterDealloc=await run("window.captureBuildState()");
  console.log("After deallocate — passiveUsed:",afterDealloc.passivePointsUsed);
  assert.ok(afterDealloc.passivePointsUsed<afterAlloc.passivePointsUsed,"Passive used must decrease after deallocation");

  // ─── 5. Test error paths ───
  stage="error-paths";
  console.log("\n── Error paths ──");

  const errAlloc=await run(`window.plannerWriteAPI.allocate("99999999")`);
  console.log("Allocate invalid ID:",JSON.stringify(errAlloc));
  assert.equal(errAlloc.success,false);
  assert.equal(errAlloc.errorCode,"NODE_NOT_FOUND");

  const classStart=await run("String(classStartId)");
  const errDeallocStart=await run(`window.plannerWriteAPI.deallocate("${classStart}")`);
  console.log("Deallocate class start:",JSON.stringify(errDeallocStart));
  assert.equal(errDeallocStart.success,false);
  assert.equal(errDeallocStart.errorCode,"START_NODE_PROTECTED");

  const errDouble=await run(`window.plannerWriteAPI.deallocate("99999999")`);
  console.log("Deallocate invalid ID:",JSON.stringify(errDouble));
  assert.equal(errDouble.success,false);
  assert.equal(errDouble.errorCode,"NODE_NOT_FOUND");

  // ─── 6. Undo back to original state ───
  stage="undo";
  await run("while(undoStack.length) undo()");
  const restored=await run("window.captureBuildState()");
  console.log("\nAfter full undo:",restored.passivePointsUsed,"used (original:",before.passivePointsUsed,")");
  assert.equal(restored.passivePointsUsed,before.passivePointsUsed,"Full undo must restore original state");

  // ─── Done ───
  console.log("\n─── ALL CHECKS PASSED ───");
  if(errors.length) console.log("Console errors:",errors);
  win.destroy();
  app.exit(0);
}).catch(error=>{
  console.error("FATAL at",stage,":",error.stack);
  if(errors.length) console.error("Console errors:",errors);
  app.exit(1);
});
