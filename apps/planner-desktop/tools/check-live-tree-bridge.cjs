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
    if(!names.includes("tree_overview")){res.writeHead(400,{"content-type":"application/json"});res.end(JSON.stringify({error:{message:"HTTP request lacks tree_overview"}}));return;}
    const prior=body.messages.find(m=>m.role==="tool");
    if(prior)report.toolResult=JSON.parse(prior.content);
    const semantic=body.messages.find(m=>m.role==='tool'&&m.tool_call_id==='cluster-read');
    if(semantic) report.semanticResult=JSON.parse(semantic.content);
    res.writeHead(200,{"content-type":"text/event-stream"});
    const delta=prior?{content:"已通过工具读取 BD"}:{tool_calls:[{index:0,id:"build-read",type:"function",function:{name:"tree_overview",arguments:"{}"}},{index:1,id:"cluster-read",type:"function",function:{name:"read_tree_cluster",arguments:JSON.stringify({nodeId:'722'})}}]};
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
  const win=new BrowserWindow({show:false,width:1300,height:850,webPreferences:{offscreen:true,backgroundThrottling:false,partition:"tree-bridge-test",preload:path.resolve(__dirname,"../electron/preload.cjs"),contextIsolation:true,nodeIntegration:false,sandbox:false}});
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
    const beforePreview=await run('JSON.stringify(window.captureBuildState())');
    await run(`renderWeGamePreview(${JSON.stringify(adapted)});document.querySelector('#weGameDialog').showModal()`);
    report.semanticPreview=await run("document.querySelector('#weGameSemanticPreview').textContent");
    assert.ok(report.semanticPreview.includes('全树 604 簇'));
    await run("document.querySelector('[aria-label=\"节点 ID 定位\"]').value='722';document.querySelector('#weGameSemanticPreview > button').click()");
    assert.ok((await run("document.querySelector('#weGameSemanticPreview [role=status]').textContent")).includes('attribute:'));
    await run("(()=>{const s=document.querySelector('[aria-label=\"簇详情内容\"]');s.value='boundaries';s.dispatchEvent(new Event('change'));})()");
    assert.ok(await run("document.querySelectorAll('#weGameSemanticPreview li button').length>0"));
    await run("document.querySelector('#weGameSemanticPreview li button').click();document.querySelector('#weGameSemanticPanel').scrollIntoView()");
    report.previewScreenshot=path.join(temp,'semantic-preview.png');
    await new Promise(resolve=>setTimeout(resolve,500));
    fs.writeFileSync(report.previewScreenshot,(await win.webContents.capturePage()).toPNG());
    await run("closeWeGameDialog()");
    assert.equal(await run('JSON.stringify(window.captureBuildState())'),beforePreview);
    await run(`applyPlannerBuildState(weGameImportUI.createPlannerCandidate(${JSON.stringify(adapted)},{baseClassName:'Mercenary',ascendancyId:'Mercenary3',partialImportAcknowledged:true},currentBuildRuntimeState(),weGamePlannerCatalog()))`);
    report.result=await run("window.desktopAPI.agent.send({model:'synthetic',text:'你能看到我的bd吗',toolsEnabled:true,buildState:window.captureBuildState()})");
    assert.equal(report.result.ok,true);
    assert.ok(report.result.trace.some(t=>t.name==="tree_overview"&&t.ok));
    assert.equal(report.toolResult.build.class.base,"Mercenary");
    assert.equal(report.toolResult.build.budgets.ascendancy.used,8);
    assert.equal(report.toolResult.scope, "current_build");
    assert.equal(report.toolResult.tree, undefined);
    assert.ok(report.toolResult.semanticTopology.clusterCount > 0);
    assert.ok(JSON.stringify(report.toolResult).length < 64000);
    assert.equal(report.toolResult.semanticTopology.complete, true);
    assert.equal(report.toolResult.semanticTopology.items.length, report.toolResult.semanticTopology.clusterCount);
    assert.ok(report.requests.every(r=>!r.tools.some(n=>["tree_summary","build_summary","list_tree_clusters"].includes(n))));
    assert.ok(report.result.trace.some(t=>t.name==='read_tree_cluster'&&t.ok));
    assert.ok(report.semanticResult.clusterId.startsWith('attribute:'));
    const liveState=await run('window.captureBuildState()');
    const topology=(await snapshotProvider(liveState)).semanticTopology;
    const published=await snapshotProvider(liveState);
    const ascIds=new Set(topology.excludedAscendancyNodeIds);
    const physical=new Set();
    for(const [id,neighbors] of Object.entries(published.adjacency)) for(const next of neighbors){
      if(!ascIds.has(id)&&!ascIds.has(next)&&published.adjacency[next])physical.add(JSON.stringify([id,next].sort()));
    }
    const reconstructed=topology.clusters.flatMap(c=>c.edges).concat(topology.clusterEdges.flatMap(e=>e.physicalEdges),topology.unclassifiedEdges);
    assert.deepEqual(new Set(reconstructed.map(e=>JSON.stringify(e))),physical);
    const alternative={...liveState,allocated:[],weaponSet1Allocated:[],weaponSet2Allocated:[],ascAllocated:[],selectedAscendancyId:null};
    assert.deepEqual((await snapshotProvider(alternative)).semanticTopology,topology);
    report.semanticCounts={clusters:topology.clusters.length,clusterEdges:topology.clusterEdges.length,
      types:Object.fromEntries(['attribute','jewel','passive'].map(type=>[type,topology.clusters.filter(c=>c.type===type).length])),
      classified:Object.keys(topology.nodeToCluster).length,unclassified:topology.unclassifiedNodes.length,
      ascendancy:topology.excludedAscendancyNodeIds.length};
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
      report.liveBuildRead=report.liveResult.trace.some(t=>t.name==="tree_overview"&&t.ok);
      report.liveChecks=[];
      for(const [text,tool] of [["查看当前天赋树快照的概要信息","tree_overview"],["查询节点 54814 到当前已点天赋树的最短路径和距离","find_tree_path"]]) {
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
