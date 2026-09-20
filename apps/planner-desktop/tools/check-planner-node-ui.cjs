"use strict";
const {app,BrowserWindow}=require("electron");
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),assert=require("node:assert/strict");
const root=path.resolve(__dirname,"../../.."), renderer=path.join(__dirname,"../renderer");
const source=fs.readFileSync(path.join(renderer,"planner.js"),"utf8");
function extract(name) {
  const start=source.indexOf("function "+name+"(");
  const next=source.slice(start+1).search(/\n(?:async )?function /);
  assert.ok(start>=0,name);return source.slice(start,next<0?source.length:start+1+next);
}
app.whenReady().then(async()=>{
  const lock=require(path.join(root,"data/upstream-sources.lock.json"));
  const candidates=require("../data/localization-candidates.json");
  const cache=path.join(app.getPath("appData"),"poe2-planner-desktop/game-data");
  function read(file,integrity) {
    const raw=fs.readFileSync(file);
    assert.equal(raw.length,integrity.bytes);
    assert.equal(crypto.createHash("sha256").update(raw).digest("hex"),integrity.sha256);
    return raw.toString("utf8");
  }
  const core=(file,id)=>read(path.join(cache,"core",file),lock.sources.find(s=>s.id===id).integrity);
  const runtime=JSON.parse(core("tree-pre.json","runtime.drydream.tree-pre"));
  const engine=require("../renderer/localization-engine.js");
  const pob=engine.parsePobTranslation(core("ChineseTranslation.lua","runtime.translation.zh-cn"));
  const overlay=engine.buildLocalization({pob,
    officialTree:JSON.parse(core("official-data.json","shared.ggg.passive-tree")),
    weGame:engine.parseWeGameModule(read(path.join(cache,"localization-candidates/wegame-passive-tree-zh-cn.js"),candidates.candidates[0].integrity))});
  const node={...runtime.nodes["54814"],id:"54814"};
  assert.ok(node.stats.length>=2);
  const html=fs.readFileSync(path.join(renderer,"index.html"),"utf8").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,"");
  const win=new BrowserWindow({show:false,width:800,height:600,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});
  try {
    await win.loadURL("data:text/html;charset=utf-8,"+encodeURIComponent(html));
    const evaluate=code=>win.webContents.executeJavaScript(code);
    await evaluate(fs.readFileSync(path.join(renderer,"stat-utils.js"),"utf8"));
    await evaluate(fs.readFileSync(path.join(renderer,"localization-engine.js"),"utf8"));
    // Run production tooltip and translation functions against verified public data.
    await evaluate(`
      var $=s=>document.querySelector(s), wrap=$('#tip').parentElement;
      var languageMode='en',node=${JSON.stringify(node)},localizationEngine=window.plannerLocalizationEngine;
      var i18n={ready:true,nodeStats:new Map([['54814',new Map(${JSON.stringify([...overlay.stats.get("54814")||[]])})]]),
        statExactZh:new Map(),statIndex:new Map()};
      var idOf=n=>n.id,zhNameOf=()=>${JSON.stringify(overlay.names.get("54814")?.value||node.name)};
      var cleanStatDisplay=window.plannerStatUtils.cleanStatDisplay;
      var isInstillExclusiveNode=()=>false,nodeTypeLabel=()=> '核心天赋',nodeWeaponState=()=>'',nodeAllocated=()=>false;
      var isHiddenConditional=()=>false,isAsc=()=>false,allocated=new Set(),classStartId=null;
      ${extract("translateStatResult")}
      ${extract("positionNodeTip")}
      ${extract("showTip")}
      true;
    `);
    for(const mode of ["en","zh","bi"]) {
      const evidence=await evaluate(`(()=>{
        languageMode='${mode}';showTip({clientX:790,clientY:590},node);
        const t=$('#tip'),r=t.getBoundingClientRect();
        return {text:t.innerText,rows:t.querySelectorAll('.tip-stat').length,
          fits:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight};
      })()`);
      assert.equal(evidence.rows,node.stats.length);assert.equal(evidence.fits,true);
      assert.match(evidence.text,/30%/);assert.match(evidence.text,/4%/);
      console.log("NODE_54814 "+JSON.stringify({mode,...evidence}));
    }
    const long=await evaluate(`(()=>{
      languageMode='en';showTip({clientX:790,clientY:590},{...node,stats:Array.from({length:80},(_,i)=>'Line '+i+'\\nCondition <img src=x>')});
      const t=$('#tip');t.scrollTop=t.scrollHeight;
      return {rows:t.querySelectorAll('.tip-stat').length,scroll:t.scrollTop>0,
        last:t.innerText.includes('Line 79'),injected:t.querySelectorAll('img').length,
        whitespace:getComputedStyle(t.querySelector('.tip-stat')).whiteSpace};
    })()`);
    assert.deepEqual(long,{rows:80,scroll:true,last:true,injected:0,whitespace:"pre-line"});
    const hover=await evaluate(`(()=>{
      $('#tip').style.display='none';
      window.canvas=$('#treeCanvas');window.dragging=false;window.hovered=null;window.hoveredInstill=null;
      window.setPreview=()=>{};window.scheduleDraw=()=>{};window.nearestInstillOverlay=()=>null;
      window.hiddenNodeLocked=()=>false;
      window.addEventListener('error',e=>window.uiError=e.message);
      const r=canvas.getBoundingClientRect();
      window.hoverFixture={...node,stats:Array.from({length:80},(_,i)=>'Attribute '+i+'\\nComplete condition')};
      window.nearestNode=(x,y)=>Math.hypot(x-80,y-80)<20?hoverFixture:null;
      ${extract("bindCanvas")}
      bindCanvas();
      return {x:Math.round(r.left+80),y:Math.round(r.top+80)};
    })()`);
    win.showInactive();
    win.webContents.debugger.attach("1.3");
    const move=point=>win.webContents.debugger.sendCommand("Input.dispatchMouseEvent",{type:"mouseMoved",...point});
    await move(hover);
    await new Promise(resolve=>setTimeout(resolve,50));
    const target=await evaluate(`(()=>{
      const r=$('#tip').getBoundingClientRect();return {x:Math.round(r.left+8),y:Math.round(Math.max(r.top+8,Math.min(r.bottom-8,${hover.y})))};
    })()`);
    for(let step=1;step<=8;step++) {
      await move({x:Math.round(hover.x+(target.x-hover.x)*step/8),y:Math.round(hover.y+(target.y-hover.y)*step/8)});
      await new Promise(resolve=>setTimeout(resolve,15));
    }
    await new Promise(resolve=>setTimeout(resolve,250));
    assert.equal(await evaluate("getComputedStyle($('#tip')).display"),"block");
    await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent",{type:"mouseWheel",...target,deltaX:0,deltaY:200});
    await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(await evaluate("$('#tip').scrollTop>0"),true);
    console.log("PASS: actual pointer enters stable tooltip and mouse wheel scrolls all attributes");
    console.log("PASS: all stats, multiline, inert text and scrollable viewport-bounded tooltip");
  } finally {win.destroy();}
}).then(()=>app.exit(0),error=>{console.error(error.stack);app.exit(1);});
