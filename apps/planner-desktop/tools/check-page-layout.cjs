"use strict";
const {app,BrowserWindow}=require("electron");
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const renderer=path.resolve(__dirname,"../renderer");
const output=path.resolve(__dirname,"../../../docs/assets/screenshots/p2at-027");
const source=fs.readFileSync(path.join(renderer,"planner.js"),"utf8");
function extract(name){const start=source.indexOf(`function ${name}(`);assert.ok(start>=0);const end=source.slice(start+1).search(/\n(?:async )?function /);return source.slice(start,start+1+end);}
app.whenReady().then(async()=>{
  const html=fs.readFileSync(path.join(renderer,"index.html"),"utf8")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,"")
    .replace('<link rel="stylesheet" href="agent-panel.css">',`<style>${fs.readFileSync(path.join(renderer,"agent-panel.css"),"utf8")}</style>`);
  const win=new BrowserWindow({show:false,width:1366,height:768,useContentSize:true,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false,offscreen:true}});
  try{
    await win.loadURL("data:text/html;charset=utf-8,"+encodeURIComponent(html));
    const run=code=>win.webContents.executeJavaScript(code);
    win.webContents.debugger.attach("1.3");
    for(const file of ["agent-trace.js","layout-shell.js","agent-panel.js"])await run(fs.readFileSync(path.join(renderer,file),"utf8"));
    await run(`window.plannerLayoutShell.mount(document);var wrap=document.querySelector('#stage'),canvas=document.querySelector('#treeCanvas'),W,H,DPR,camera={x:123,y:456,scale:0.8};var scheduleDraw=()=>{};${extract("resize")} ${extract("screenToWorld")} new ResizeObserver(resize).observe(wrap);window.addEventListener('resize',resize);document.querySelector('#status').textContent='PoE2 · 导航验证';document.querySelector('#desktopBridgeStatus').hidden=true;`);
    const wait=()=>new Promise(r=>setTimeout(r,240));
    fs.mkdirSync(output,{recursive:true});
    for(const [width,height] of [[1366,768],[600,650],[360,560]]){
      win.setContentSize(width,height);await wait();
      await run(`document.querySelector('#switchToPlanner').click()`);await wait();
      const headers=[];
      for(const [page,selector] of [["planner",null],["agent","#switchToAgent"],["settings",'#agentView [data-page="settings"]']]){
        if(selector)await run(`document.querySelector(${JSON.stringify(selector)}).click()`);await wait();
        headers.push(await run(`(()=>{const nav=document.querySelector('#${page}View nav[aria-label="页面切换"]');return [...nav.children].map(e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height]})})()`));
      }
      assert.deepEqual(headers[1],headers[0]);assert.deepEqual(headers[2],headers[0]);
      if(process.argv.includes("--settings")){
        const bounds=await run(`(()=>{const s=document.querySelector('.settings-scroll'),r=s.getBoundingClientRect();s.scrollTop=0;s.focus();return {right:r.right,width:innerWidth,top:r.top,scrollable:s.scrollHeight>s.clientHeight,nested:[...s.querySelectorAll('*')].filter(e=>['auto','scroll'].includes(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight).length}})()`);
        assert.equal(bounds.right,bounds.width);assert.equal(bounds.top,72);assert.equal(bounds.scrollable,true);assert.equal(bounds.nested,0);
        await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent",{type:"keyDown",key:"PageDown",code:"PageDown",windowsVirtualKeyCode:34});
        await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent",{type:"keyUp",key:"PageDown",code:"PageDown",windowsVirtualKeyCode:34});await wait();
        assert.ok(await run(`document.querySelector('.settings-scroll').scrollTop`)>0,"keyboard scroll");
        await run(`document.querySelector('.settings-scroll').scrollTop=0`);
        await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent",{type:"mouseWheel",x:width-20,y:height-50,deltaX:0,deltaY:460});await wait();
        assert.ok(await run(`document.querySelector('.settings-scroll').scrollTop`)>0,"mouse scroll at window edge");
        assert.equal(await run(`document.querySelector('#settingsView .agent-top').getBoundingClientRect().y`),0);
        fs.writeFileSync(path.join(output,`settings-${width}.png`),(await win.webContents.capturePage()).toPNG());
        console.log("SETTINGS_SCROLL",JSON.stringify({width,...bounds}));
      }
      await run(`document.querySelector('#settingsView [data-page="planner"]').click();document.querySelector('#search').value='preserved';`);
      for(const state of ["open","closed"]){
        await run(`document.querySelector('#tool-trigger-search').click()`);await wait();
        const evidence=await run(`(()=>{const s=wrap.getBoundingClientRect(),c=canvas.getBoundingClientRect();const n=document.querySelector('.module-nav').getBoundingClientRect();return {stage:[s.width,s.height],canvas:[c.width,c.height],backing:[canvas.width,canvas.height],world:screenToWorld(W/2,H/2),rail:n.x,vertical:getComputedStyle(document.querySelector('.module-nav')).flexDirection,search:document.querySelector('#search').value,overflow:document.documentElement.scrollWidth>innerWidth}})()`);
        assert.equal(evidence.rail,0);assert.equal(evidence.vertical,"column");assert.equal(evidence.search,"preserved");assert.equal(evidence.overflow,false);
        assert.deepEqual(evidence.world,{x:123,y:456});assert.ok(Math.abs(evidence.stage[0]-evidence.canvas[0])<1);assert.ok(Math.abs(evidence.stage[1]-evidence.canvas[1])<1);
        assert.equal(await run(`(()=>{const b=document.querySelector('#tool-trigger-search'),r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`),true,"rail button must remain pointer-accessible");
        console.log("PAGE_LAYOUT",JSON.stringify({width,height,state,...evidence}));
        fs.writeFileSync(path.join(output,`navigation-${width}-${state}.png`),(await win.webContents.capturePage()).toPNG());
      }
    }
    console.log("PASS: aligned page navigation, vertical tools, preserved controls, Canvas size/coordinate mapping");
  }finally{win.destroy();app.quit();}
}).catch(e=>{console.error(e);app.exit(1)});
