"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const endpoint=process.env.P2AT_CDP||"http://127.0.0.1:9333";
const output=path.resolve(__dirname,"../../../docs/assets/screenshots/p2at-022b");
let serial=0;
const pending=new Map();

async function main() {
  const pages=await fetch(`${endpoint}/json/list`).then(response=>response.json());
  const expectedUrl=pathToFileURL(path.resolve(__dirname,"../renderer/index.html")).href;
  const page=pages.find(item=>item.type==="page" && item.url.startsWith(expectedUrl));
  if(!page) throw new Error(`Planner page not found at ${expectedUrl}`);
  const socket=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener("open",resolve,{once:true});socket.addEventListener("error",reject,{once:true});});
  socket.addEventListener("message",event=>{
    const message=JSON.parse(event.data);
    const entry=pending.get(message.id);
    if(!entry)return;
    pending.delete(message.id);
    if(message.error)entry.reject(new Error(message.error.message));else entry.resolve(message.result);
  });
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{
    const result=await send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});
    if(result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
    return result.result.value;
  };
  const wait=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
  await fs.mkdir(output,{recursive:true});
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride",{width:1366,height:768,deviceScaleFactor:1,mobile:false});
  await send("Page.navigate",{url:expectedUrl});
  await wait(1500);
  for(let attempt=0;attempt<20;attempt+=1) {
    const ready=await evaluate(`Boolean(document.querySelector('#classSelect') && !document.querySelector('#classSelect').disabled && document.querySelector('#i18nStatus')?.textContent.includes('节点名称'))`);
    if(ready)break;
    await wait(500);
  }
  const result=await evaluate(`(() => {
    const node=byId.get('52');
    if(!node) throw new Error('node 52 missing');
    languageMode='zh';
    document.querySelector('#langSelect').value='zh';
    showNodeInfo(node);
    focusNode(node,.12);
    const trigger=document.querySelector('[data-panel-target="stats"]');
    if(trigger && trigger.getAttribute('aria-expanded')!=='true') trigger.click();
    const info=document.querySelector('#nodeInfo').innerText;
    const status=document.querySelector('#i18nStatus').innerText;
    const original=node.stats[0];
    const translated=translateStatResult(original,node);
    const numericNode=byId.get('3994');
    const numericOriginal=numericNode?.stats?.[0]||'';
    const numericTranslation=numericNode?translateStatResult(numericOriginal,numericNode):null;
    const htmlProbe='<img src=x onerror=alert(1)>';
    const probe=document.createElement('div'); probe.textContent=htmlProbe;
    const before=[allocated.size,ascAllocated.size,weaponSet1Allocated.size,weaponSet2Allocated.size];
    document.querySelector('#importWeGame').click();
    const importDialogOpened=document.querySelector('#weGameDialog').open;
    document.querySelector('#weGameCancel').click();
    const after=[allocated.size,ascAllocated.size,weaponSet1Allocated.size,weaponSet2Allocated.size];
    return {info,status,original,translated,numericOriginal,numericTranslation,htmlSafe:probe.innerHTML.includes('&lt;img'),nodeCount:nodes.length,allocated:after,importDialogOpened,importCancelPreservedBuild:JSON.stringify(before)===JSON.stringify(after),saveEnabled:!document.querySelector('#saveBuild').disabled,openEnabled:!document.querySelector('#openBuild').disabled};
  })()`);
  if(!result.info.includes("狂热者誓言") || !result.info.includes("再生的溢出生命回复会作用于能量护盾") || result.info.includes("Excess Life Recovery")) throw new Error(`Node 52 display failed: ${JSON.stringify(result)}`);
  if(!result.numericOriginal.includes("6%") || result.numericTranslation?.value?.includes("8%")) throw new Error(`Node 3994 numeric guard failed: ${JSON.stringify(result)}`);
  if(!result.htmlSafe) throw new Error("textContent HTML safety probe failed");
  if(!result.importDialogOpened || !result.importCancelPreservedBuild || !result.saveEnabled || !result.openEnabled) throw new Error(`Build/import regression check failed: ${JSON.stringify(result)}`);
  const screenshot=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false,fromSurface:true});
  const screenshotPath=path.join(output,"node-52-wegame-full-zh.png");
  await fs.writeFile(screenshotPath,Buffer.from(screenshot.data,"base64"));
  socket.close();
  console.log(JSON.stringify({...result,screenshotPath},null,2));
}

main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
