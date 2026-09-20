"use strict";
const {app,BrowserWindow,ipcMain}=require("electron");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),http=require("node:http"),assert=require("node:assert/strict");
const {PythonAgentClient}=require("../electron/python-agent-client.cjs");
const {AgentService,createAgentIpcHandlers}=require("../electron/agent-service.cjs");
const {spawnSync}=require("node:child_process");
const atomicSelection=process.argv.includes("--atomic-selection");
const renderer=path.resolve(__dirname,"../renderer"),output=path.resolve(__dirname,"../../../docs/assets/screenshots/p2at-027");
app.whenReady().then(async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"p2at-sessions-"));
  const requests=[];
  const server=http.createServer((req,res)=>{
    let body="";req.on("data",chunk=>body+=chunk);req.on("end",()=>{
      const input=JSON.parse(body);requests.push(input);
      const text=input.messages.filter(m=>m.role==="user").at(-1).content;
      res.writeHead(200,{"Content-Type":"text/event-stream"});
      const event=value=>res.write(`data: ${JSON.stringify(value)}\n\n`);
      event({choices:[{index:0,delta:{content:`合成回复：${text}`},finish_reason:null}]});
      if(text==="取消测试")return; // Connection remains open until cancellation kills the client.
      event({choices:[{index:0,delta:{},finish_reason:text==="失败测试"?"length":"stop"}]});
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const client=new PythonAgentClient({memoryPath:path.join(temp,"memory.sqlite3")});
  let service=new AgentService({client,modelLister:async()=>["synthetic"]});
  const config={baseUrl:`http://127.0.0.1:${server.address().port}/v1`,apiKey:"synthetic-only-key"};
  await service.configure(config);
  let win;
  const bindings={"agent:status":"status","agent:configure":"configure","agent:clear-config":"clear","agent:list-models":"models","agent:send":"send","agent:cancel":"cancel","agent:reset":"reset","agent:restore-conversation":"restore","agent:sessions":"sessions","agent:select-session":"selectSession","agent:session-history":"sessionHistory"};
  let handlers=createAgentIpcHandlers(service,e=>e.sender===win?.webContents);
  let failHistory=false, failSelectResponse=false;
  for(const [channel,name] of Object.entries(bindings))ipcMain.handle(channel,(...args)=>{
    if(name==="sessionHistory" && failHistory){failHistory=false;return {ok:false,error:{message:"合成历史读取失败"}};}
    if(name==="selectSession" && failSelectResponse){failSelectResponse=false;return handlers[name](...args).then(()=>({ok:false,error:{message:"合成切换响应失败"}}));}
    return handlers[name](...args);
  });
  const html=fs.readFileSync(path.join(renderer,"index.html"),"utf8").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,"")
    .replace('<link rel="stylesheet" href="agent-panel.css">',`<style>${fs.readFileSync(path.join(renderer,"agent-panel.css"),"utf8")}</style>`);
  win=new BrowserWindow({show:false,width:1200,height:800,useContentSize:true,webPreferences:{preload:path.resolve(__dirname,"../electron/preload.cjs"),sandbox:true,contextIsolation:true,offscreen:true,backgroundThrottling:false}});
  const run=code=>win.webContents.executeJavaScript(code);
  const wait=async predicate=>{for(let i=0;i<160;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,50));}throw Error("UI condition timed out");};
  async function load(){await win.loadURL("data:text/html;charset=utf-8,"+encodeURIComponent(html));for(const file of ["agent-trace.js","agent-panel.js"])await run(fs.readFileSync(path.join(renderer,file),"utf8"));await wait(()=>run(`!document.querySelector('#agentSend').disabled`));await run(`document.querySelector('#switchToAgent').click();document.querySelector('#desktopBridgeStatus').hidden=true;`);}
  const send=async text=>{await run(`document.querySelector('#agentInput').value=${JSON.stringify(text)};document.querySelector('#agentComposer').requestSubmit()`);await wait(()=>run(`!document.querySelector('#agentSend').disabled`));await wait(()=>Promise.resolve(!service.active));};
  try{
    await load();await send("会话甲 · 合成档案");
    await wait(()=>run(`document.querySelector('#sessionList').textContent.includes('会话甲')`));
    const first=(await service.sessionOperation("sessions")).selectedId;
    await run(`document.querySelector('#agentNewChat').click()`);await wait(()=>run(`!document.querySelector('#agentSend').disabled`));
    await send("会话乙 · 独立档案");await wait(()=>run(`document.querySelectorAll('#sessionList button').length===2 && document.querySelector('#sessionList').textContent.includes('会话乙')`));
    const second=(await service.sessionOperation("sessions")).selectedId;
    assert.notEqual(first,second);assert.ok(!JSON.stringify(requests.at(-1)).includes("会话甲"));
    if(atomicSelection){
      failSelectResponse=true;
      await run(`document.querySelectorAll('#sessionList button')[1].click()`);
      await wait(()=>run(`document.querySelector('#agentMessages').textContent.includes('会话读取失败')`));
      assert.equal(await run(`document.querySelector('#agentSend').disabled && !document.querySelector('#agentMessages').textContent.includes('会话乙')`),true);
      await run(`document.querySelector('#sessionRetry').click()`);
      await wait(()=>run(`!document.querySelector('#agentSend').disabled && document.querySelector('#agentMessages').textContent.includes('会话甲')`));
      await run(`document.querySelectorAll('#sessionList button')[0].click()`);
      await wait(()=>run(`!document.querySelector('#agentSend').disabled && document.querySelector('#agentMessages').textContent.includes('会话乙')`));
    }
    failHistory=true;
    await run(`document.querySelectorAll('#sessionList button')[1].click()`);
    await wait(()=>run(`document.querySelector('#agentMessages').textContent.includes('会话读取失败')`));
    assert.equal(await run(`document.querySelector('#agentSend').disabled && !document.querySelector('#agentMessages').textContent.includes('会话乙')`),true);
    await run(`document.querySelector('#sessionRetry').click()`);
    await wait(()=>run(`document.querySelector('#agentMessages').textContent.includes('会话甲') && !document.querySelector('#agentSend').disabled`));
    assert.equal(await run(`document.querySelector('#agentMessages').textContent.includes('会话乙')`),false);
    client.terminate();service=new AgentService({client,modelLister:async()=>["synthetic"]});await service.configure(config);handlers=createAgentIpcHandlers(service,e=>e.sender===win.webContents);
    await load();assert.equal((await service.sessionOperation("sessions")).selectedId,first);
    assert.equal(await run(`document.querySelector('#agentMessages').textContent.includes('会话甲')`),true);
    await send("失败测试");const failed=await service.sessionOperation("session_history",{conversationId:first});assert.equal(failed.turns.length,1);
    await run(`document.querySelector('#agentInput').value='取消测试';document.querySelector('#agentComposer').requestSubmit()`);
    await wait(()=>run(`document.querySelector('.streaming')?.textContent.includes('取消测试')`));
    assert.equal(await run(`[...document.querySelectorAll('#sessionList button')].every(b=>b.disabled)&&document.querySelector('#agentNewChat').disabled`),true);
    assert.equal((await service.sessionOperation("select_session",{conversationId:second})).error.code,"RUN_IN_PROGRESS");
    await run(`document.querySelector('#agentStop').click()`);await wait(()=>run(`!document.querySelector('#agentSend').disabled`));
    assert.equal((await service.sessionOperation("session_history",{conversationId:first})).turns.length,1);
    await run(`document.querySelectorAll('#sessionList button')[0].click()`);await wait(()=>run(`document.querySelector('#agentMessages').textContent.includes('会话乙') && !document.querySelector('#agentSend').disabled`));
    assert.equal(await run(`/失败测试|取消测试|会话甲/.test(document.querySelector('#agentMessages').textContent)`),false);
    fs.mkdirSync(output,{recursive:true});
    if(atomicSelection){
      await run(`document.querySelectorAll('#sessionList button')[1].click()`);
      await wait(()=>run(`!document.querySelector('#agentSend').disabled && document.querySelector('#agentMessages').textContent.includes('会话甲')`));
      const corrupt=spawnSync(client.executable,["-X","utf8","-c",`import sqlite3,sys
db=sqlite3.connect(sys.argv[1])
db.execute("INSERT INTO turns VALUES (?,2,'2026-09-20','synthetic-corrupt','broken-json','',11)",(sys.argv[2],))
db.commit()
db.close()`,path.join(temp,"memory.sqlite3"),second],{windowsHide:true,encoding:"utf8"});
      assert.equal(corrupt.status,0,corrupt.stderr);
      await run(`document.querySelectorAll('#sessionList button')[0].click()`);
      await wait(()=>run(`document.querySelector('#agentMessages').textContent.includes('会话读取失败')`));
      assert.equal(await run(`document.querySelector('#agentSend').disabled`),true);
      assert.equal((await service.sessionOperation("sessions")).selectedId,first);
      await new Promise(r=>setTimeout(r,120));fs.writeFileSync(path.join(output,"sessions-atomic-failure.png"),(await win.webContents.capturePage()).toPNG());
      await run(`document.querySelector('#sessionRetry').click()`);await wait(()=>run(`!document.querySelector('#agentSend').disabled`));
      await send("甲故障后继续");assert.ok(!JSON.stringify(requests.at(-1)).includes("会话乙"));
      client.terminate();service=new AgentService({client,modelLister:async()=>["synthetic"]});await service.configure(config);handlers=createAgentIpcHandlers(service,e=>e.sender===win.webContents);
      await load();assert.equal((await service.sessionOperation("sessions")).selectedId,first);
      assert.equal(await run(`document.querySelector('#agentMessages').textContent.includes('会话乙')`),false);
      console.log("PASS: damaged second SQLite turn rolls selection back; failed selection response blocks send until reconciliation; restart and next send remain on A");
    }else{
      await new Promise(r=>setTimeout(r,120));fs.writeFileSync(path.join(output,"sessions-desktop.png"),(await win.webContents.capturePage()).toPNG());
      win.setContentSize(420,650);await run(`document.querySelector('#sessionToggle').click()`);await new Promise(r=>setTimeout(r,180));fs.writeFileSync(path.join(output,"sessions-narrow.png"),(await win.webContents.capturePage()).toPNG());
    }
    console.log("PASS: real SQLite + Python + preload + renderer; independent sessions, restart, scoped context, length failure, cancel, busy guard, no cross-session UI");
  }finally{win.destroy();client.terminate();server.closeAllConnections();server.close();for(const channel of Object.keys(bindings))ipcMain.removeHandler(channel);app.quit();}
}).catch(e=>{console.error(e);app.exit(1)});
