"use strict";
// Exercise the real renderer, preload, snapshot provider, Python RPC and HTTP tool list.
// Default: isolated local endpoint and conversation database. P2AT_BRIDGE_LIVE=1
// opts into saved remote credentials; browser state and chat remain isolated.
const {app,BrowserWindow,protocol,ipcMain,safeStorage,session}=require("electron");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),http=require("node:http"),assert=require("node:assert/strict");
const {PythonAgentClient}=require("../electron/python-agent-client.cjs");
const {AgentService,createAgentIpcHandlers}=require("../electron/agent-service.cjs");
const {createTreeSnapshotProvider}=require("../electron/tree-tools.cjs");
const reportPath=process.env.P2AT_BRIDGE_REPORT||path.join(os.tmpdir(),"p2at-live-tree-bridge.json");
const cache=process.env.P2AT_GAME_CACHE||path.join(process.env.APPDATA,"poe2-planner-desktop","game-data");
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"p2at-tree-bridge-"));
app.setPath("userData",process.env.P2AT_BRIDGE_LIVE ? path.join(app.getPath("appData"),"poe2-planner-desktop") : temp);
protocol.registerSchemesAsPrivileged([{scheme:"poe2",privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
const report={errors:[],requests:[]};
const checkpoint=stage=>{report.stage=stage;fs.writeFileSync(reportPath,JSON.stringify(report,null,2));};
setTimeout(()=>{checkpoint("timeout");app.exit(1);},process.env.P2AT_BRIDGE_LIVE ? 480000 : 60000).unref();
app.whenReady().then(async()=>{
  checkpoint("ready");
  const server=http.createServer(async(req,res)=>{
    let raw="";for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw),names=(body.tools||[]).map(t=>t.function?.name||t.name);
    report.requests.push({tools:names});
    checkpoint("model-request");
    if(!names.includes("build_summary")){res.writeHead(400,{"content-type":"application/json"});res.end(JSON.stringify({error:{message:"HTTP request lacks build_summary"}}));return;}
    const prior=body.messages.find(m=>m.role==="tool");
    if(prior)report.toolResult=JSON.parse(prior.content);
    res.writeHead(200,{"content-type":"text/event-stream"});
    const delta=prior?{content:"已通过工具读取 BD"}:{tool_calls:[{index:0,id:"build-read",type:"function",function:{name:"build_summary",arguments:"{}"}}]};
    res.end(`data: ${JSON.stringify({choices:[{delta,finish_reason:prior?"stop":"tool_calls"}]})}\n\ndata: [DONE]\n\n`);
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const client=new PythonAgentClient({memoryPath:path.join(temp,"memory.sqlite3")});
  const service=new AgentService({client});
  const snapshotProvider=createTreeSnapshotProvider(null,"test-locked-tree");
  service.treeSnapshotProvider=async state=>{try{return await snapshotProvider(state);}catch(error){report.projectionFailure=error.stack;throw error;}};
  const request=client.request.bind(client);
  client.request=async(method,params,...rest)=>{
    let result;
    try{result=await request(method,params,...rest);}catch(error){if(method==="tree_snapshot")report.rpcFailure=error.message;throw error;}
    if(method==="tree_snapshot")report.snapshotReply=result;
    return result;
  };
  await service.configure({baseUrl:`http://127.0.0.1:${server.address().port}/v1`,apiKey:"synthetic"});
  checkpoint("configured");
  session.fromPartition("tree-bridge-test").protocol.handle("poe2",async request=>{
    const url=new URL(request.url),name=path.basename(url.pathname);
    const folder=url.hostname==="localization"?"localization-candidates":url.hostname==="portraits"?"portraits":"core";
    const filename=path.join(cache,folder,name);
    return fs.existsSync(filename)?new Response(fs.readFileSync(filename)):new Response("missing",{status:404});
  });
  const win=new BrowserWindow({show:false,width:1300,height:850,webPreferences:{partition:"tree-bridge-test",preload:path.resolve(__dirname,"../electron/preload.cjs"),contextIsolation:true,nodeIntegration:false,sandbox:false}});
  win.webContents.on("console-message",(_e,_level,message)=>{if(/Error|failed|not defined/i.test(message))report.errors.push(message.slice(0,500));});
  const handlers=createAgentIpcHandlers(service,e=>e.sender===win.webContents);
  ipcMain.handle("agent:send",handlers.send);
  ipcMain.handle("agent:status",()=>({configured:false}));
  ipcMain.handle("data:cache-status",()=>({}));
  ipcMain.handle("app:get-info",()=>({}));
  try{
    await win.loadFile(path.resolve(__dirname,"../renderer/index.html"));
    checkpoint("page-loaded");
    const run=code=>win.webContents.executeJavaScript(code);
    for(let i=0;i<200;i++){
      if(await run("typeof window.captureBuildState==='function' && i18n.ready"))break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    report.renderer=await run("({capture:typeof window.captureBuildState,ready:i18n.ready,status:document.querySelector('#status').textContent})");
    report.capture=await run("(()=>{const s=window.captureBuildState();return {error:s._projectionError,nodes:s.nodes?.length,edges:s.edges?.length}})()");
    assert.equal(await run("new Set(window.captureBuildState().nodes.map(n=>n.id)).size"),report.capture.nodes);
    await run("loadOfficialHiddenSidecar()");
    assert.equal(await run("window.captureBuildState().nodes.length"),report.capture.nodes);
    checkpoint("captured");
    const fixture=JSON.parse(fs.readFileSync(path.resolve(__dirname,"../fixtures/wegame-share/public-share.sanitized.json")));
    const official=JSON.parse(fs.readFileSync(path.join(cache,"core/official-data.json")));
    report.zarokh=await run("(async()=>{const n=byId.get('11184');const data=await (await fetch(OFFICIAL_TREE_URL)).json();const expected=transformOfficialPoint(officialNodePosition(data,data.nodes['11184'],officialOrbitCounts(data)));return {name:n.name,kind:n.kind,isJewelSocket:n.isJewelSocket,isBlighted:n.isBlighted,positionMatches:n.x===expected.x&&n.y===expected.y};})()");
    assert.deepEqual(report.zarokh,{name:"Zarokh's Gift",kind:"jewel",isJewelSocket:true,isBlighted:true,positionMatches:true});
    const adapted=require("../src/interop/wegame-import-adapter.js").adaptWeGamePassiveImport({roleInfo:fixture.roleInfo,talentTree:fixture.talentTree},official);
    await run(`applyPlannerBuildState(weGameImportUI.createPlannerCandidate(${JSON.stringify(adapted)},{baseClassName:'Mercenary',ascendancyId:'Mercenary3',partialImportAcknowledged:true},currentBuildRuntimeState(),weGamePlannerCatalog()))`);
    report.result=await run("window.desktopAPI.agent.send({model:'synthetic',text:'你能看到我的bd吗',toolsEnabled:true,buildState:window.captureBuildState()})");
    assert.equal(report.result.ok,true);
    assert.ok(report.result.trace.some(t=>t.name==="build_summary"&&t.ok));
    assert.equal(report.toolResult.class.base,"Mercenary");
    assert.equal(report.toolResult.budgets.ascendancy.used,8);
    if(process.env.P2AT_BRIDGE_LIVE) {
      const {AgentCredentialStore}=require("../electron/agent-credential-store.cjs");
      const connection=await new AgentCredentialStore({userDataPath:path.join(app.getPath("appData"),"poe2-planner-desktop"),safeStorage}).load();
      assert.ok(connection,"Saved connection is required for opt-in live testing");
      await service.configure(connection);
      await service.reset();
      report.liveModel=process.env.P2AT_BRIDGE_MODEL||"kimi-k3";
      checkpoint("live-started");
      report.liveResult=await run(`window.desktopAPI.agent.send({model:${JSON.stringify(report.liveModel)},text:'你能看到我的bd吗',toolsEnabled:true,buildState:window.captureBuildState()})`);
      checkpoint("live-completed");
      assert.equal(report.liveResult.ok,true,JSON.stringify(report.liveResult.error));
      report.liveBuildRead=report.liveResult.trace.some(t=>t.name==="build_summary"&&t.ok);
      report.liveChecks=[];
      for(const [text,tool] of [["查看当前天赋树快照的概要信息","tree_summary"],["查询节点 54814 到当前已点天赋树的最短路径和距离","find_tree_path"]]) {
        const result=await run(`window.desktopAPI.agent.send({model:${JSON.stringify(report.liveModel)},text:${JSON.stringify(text)},toolsEnabled:true,buildState:window.captureBuildState()})`);
        report.liveChecks.push({text,result});
        checkpoint("live-"+tool);
        assert.equal(result.ok,true,JSON.stringify(result.error));
        assert.ok(result.trace.some(t=>t.name===tool&&t.ok),"Remote model must invoke "+tool);
      }
      assert.ok(report.liveBuildRead,"Remote model must read the build");
    }
    report.ok=true;
  }catch(error){report.ok=false;report.failure=error.stack;}
  finally{fs.writeFileSync(reportPath,JSON.stringify(report,null,2));win.destroy();client.terminate();server.close();app.exit(report.ok?0:1);}
}).catch(error=>{fs.writeFileSync(reportPath,JSON.stringify({ok:false,failure:error.stack}));app.exit(1);});
