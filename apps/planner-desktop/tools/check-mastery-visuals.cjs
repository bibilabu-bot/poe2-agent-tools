"use strict";
const {app,BrowserWindow}=require("electron");
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),assert=require("node:assert/strict");
const {createPassiveGraph}=require("../renderer/passive-graph.js");
const {buildTriggerIndex}=require("../renderer/mastery-visual-state.js");
app.whenReady().then(async()=>{
  const root=path.resolve(__dirname,"../../.."),lock=require(path.join(root,"data/upstream-sources.lock.json"));
  const cache=path.join(app.getPath("appData"),"poe2-planner-desktop/game-data/core");
  function read(file) {
    const entry=lock.sources.find(s=>file==="official-data.json" ? s.id==="shared.ggg.passive-tree"
      : s.origin?.path?.endsWith("/"+file)||s.origin?.path===file);
    assert.ok(entry,"locked source "+file);
    const bytes=fs.readFileSync(path.join(cache,file));
    assert.equal(bytes.length,entry.integrity.bytes);
    assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"),entry.integrity.sha256);
    return bytes;
  }
  const runtime=JSON.parse(read("tree-pre.json")),official=JSON.parse(read("official-data.json"));
  const nodes=Object.entries(runtime.nodes).filter(([id])=>id!=="root").map(([id,n])=>({...n,_id:id}));
  const graph=createPassiveGraph(nodes,runtime.edges,{getNodeId:n=>n._id});
  const index=buildTriggerIndex(nodes,{getId:n=>n._id,isMastery:n=>n.kind==="mastery",
    isEligible:n=>!n.asc&&n.kind!=="classstart",neighbors:id=>graph.neighbors(id)});
  let crossVisualGroup=0;
  for(const [id,ids] of index) {
    const raw=official.nodes[id];
    const expected=[...new Set([...(raw.in||[]),...(raw.out||[])].map(String))]
      .filter(key=>runtime.nodes[key]&&runtime.nodes[key].kind!=="mastery"&&!runtime.nodes[key].asc&&runtime.nodes[key].kind!=="classstart").sort();
    assert.deepEqual(ids,expected,"runtime membership matches official "+id);
    if(ids.some(key=>runtime.nodes[key].group!==runtime.nodes[id].group)) crossVisualGroup++;
  }
  const local="53188";
  assert.equal(runtime.nodes["19044"].group,runtime.nodes[local].group);
  assert.deepEqual(index.get(local),["16256","19044","3567","39567"]);
  const remote=[...index.keys()].find(id=>id!==local&&official.nodes[id].activeEffectImage===official.nodes[local].activeEffectImage
    &&index.get(id).length&&!index.get(id).some(key=>index.get(local).includes(key)));
  assert.ok(remote);
  const remoteTrigger=index.get(remote)[0];
  console.log("MASTERY_MEMBERSHIP "+JSON.stringify({masteries:index.size,crossVisualGroup,local,
    runtimeGroup:runtime.nodes[local].group,officialGroup:official.nodes[local].group,candidates:index.get(local),remote,remoteTrigger}));
  const source=fs.readFileSync(path.join(__dirname,"../renderer/planner.js"),"utf8");
  function extract(name) {
    const start=source.indexOf("function "+name+"(");
    assert.ok(start>=0);
    const next=source.slice(start+1).search(/\n(?:async )?function /);
    return source.slice(start,next<0?source.length:start+1+next);
  }
  const win=new BrowserWindow({show:false,width:640,height:360,webPreferences:{sandbox:true,contextIsolation:true}});
  try {
    await win.loadURL("data:text/html,<canvas id='effect' width='320' height='320'></canvas>");
    const evaluate=code=>win.webContents.executeJavaScript(code);
    await evaluate(fs.readFileSync(path.join(__dirname,"../renderer/mastery-visual-state.js"),"utf8"));
    await evaluate(`
      var nodes=${JSON.stringify(nodes)},masteryTriggerIndex=new Map(${JSON.stringify([...index])});
      var idOf=n=>n._id,isMasteryVisual=n=>n.kind==='mastery',isAsc=n=>!!n.asc;
      var allocated=new Set(),weaponSet1Allocated=new Set(),weaponSet2Allocated=new Set();
      var previewIds=new Set(['19044']),hovered=nodes.find(n=>n._id==='19044');
      var canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d'),camera={scale:.2};
      var masteryEffectAtlas=${read("mastery-effect-active.json").toString("utf8")};
      var masteryEffectsReady=true,masteryEffectImg=new Image();
      ${extract("masteryTriggered")}
      ${extract("masteryAtlasFrame")}
      ${extract("drawMasteryVisuals")}
      var render=id=>{
        const n=nodes.find(n=>n._id===id);
        ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,320,320);
        ctx.setTransform(.2,0,0,.2,160-n.x*.2,160-n.y*.2);
        drawMasteryVisuals({minX:n.x-1,maxX:n.x+1,minY:n.y-1,maxY:n.y+1});
        return ctx.getImageData(0,0,320,320).data.some((v,i)=>i%4===3&&v>0);
      };
      true;
    `);
    await evaluate(`new Promise((resolve,reject)=>{masteryEffectImg.onload=resolve;masteryEffectImg.onerror=()=>reject(new Error('atlas load'));masteryEffectImg.src='data:image/webp;base64,${read("mastery-effect-active.webp").toString("base64")}';})`);
    const evidence=await evaluate(`(()=>{
      allocated.add('${remoteTrigger}');
      const unrelatedLocal=render('${local}'),remoteActive=render('${remote}');
      allocated.add('4828');const localSmallOnly=render('${local}');allocated.delete('4828');
      allocated.add('19044');const localActive=render('${local}');allocated.delete('19044');
      const removed=render('${local}');
      weaponSet1Allocated.add('19044');const ws1=render('${local}');weaponSet1Allocated.clear();
      weaponSet2Allocated.add('19044');const ws2=render('${local}');weaponSet2Allocated.clear();
      return {unrelatedLocal,remoteActive,localSmallOnly,localActive,removed,ws1,ws2,previewOnly:render('${local}')};
    })()`);
    assert.deepEqual(evidence,{unrelatedLocal:false,remoteActive:true,localSmallOnly:false,localActive:true,
      removed:false,ws1:true,ws2:true,previewOnly:false});
    console.log("MASTERY_REAL_RENDER "+JSON.stringify(evidence));
  } finally {win.destroy();}
}).then(()=>app.exit(0),error=>{console.error(error.stack);app.exit(1);});
