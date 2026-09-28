'use strict';
// Real isolated Electron renderer + preload + atomic file store; synthetic Builds only.
const {app,BrowserWindow,protocol,ipcMain,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'p2at-008f-'));
app.setPath('userData',temp);
protocol.registerSchemesAsPrivileged([{scheme:'poe2',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
const evidence=path.resolve(__dirname,'../../..','docs/assets/screenshots/p2at-008f');
fs.mkdirSync(evidence,{recursive:true});
const report={checks:[],errors:[]};
app.whenReady().then(async()=>{
  const cache=process.env.P2AT_GAME_CACHE||path.join(process.env.APPDATA,'poe2-planner-desktop/game-data');
  const lock=require('../../../data/upstream-sources.lock.json');
  for(const [file,id] of [['tree-pre.json','runtime.drydream.tree-pre'],['official-data.json','shared.ggg.passive-tree']]) {
    const bytes=fs.readFileSync(path.join(cache,'core',file)),item=lock.sources.find(s=>s.id===id);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),item.integrity.sha256);
  }
  const partition='jewel-test';
  session.fromPartition(partition).protocol.handle('poe2',request=>{
    const url=new URL(request.url),name=path.basename(url.pathname);
    const folder=url.hostname==='localization'?'localization-candidates':url.hostname==='portraits'?'portraits':'core';
    const filename=path.join(cache,folder,name);
    return fs.existsSync(filename)?new Response(fs.readFileSync(filename)):new Response('missing',{status:404});
  });
  const buildPath=path.join(temp,'synthetic.json');
  const handlers=require('../electron/build-file-store.cjs').createBuildIpcHandlers({
    ensureBuildDir:async()=>temp,dialogs:{showSaveDialog:async()=>({filePath:buildPath}),showOpenDialog:async()=>({filePaths:[buildPath]})}
  });
  ipcMain.handle('build:save-json',handlers.save);ipcMain.handle('build:open-json',handlers.open);
  for(const key of ['agent:status','rag:status','settings:retrieval-status'])ipcMain.handle(key,()=>({configured:false}));
  ipcMain.handle('data:cache-status',()=>[]);ipcMain.handle('app:get-info',()=>({version:'test-008F'}));
  ipcMain.handle('agent:sessions',()=>({sessions:[]}));
  const win=new BrowserWindow({show:false,width:1366,height:900,webPreferences:{partition,offscreen:true,backgroundThrottling:false,preload:path.resolve(__dirname,'../electron/preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:false}});
  win.webContents.on('console-message',(_e,_l,message)=>{if(/ReferenceError|TypeError|SyntaxError/.test(message))report.errors.push(message);});
  const run=code=>win.webContents.executeJavaScript(code);
  try {
    await win.loadFile(path.resolve(__dirname,'../renderer/index.html'));
    for(let i=0;i<200;i++){if(await run('typeof plannerDataReady!=="undefined" && plannerDataReady'))break;await new Promise(r=>setTimeout(r,100));}
    assert.equal(await run('plannerDataReady'),true);
    assert.equal(await run('liveJewelCatalog.sockets.length'),12);
    await run('window.confirm=()=>true;selectClass(classOptions[0].name);');
    const socket=await run(`(()=>{const list=liveJewelCatalog.sockets.map(s=>({id:s.nodeId,path:pathFromActiveSet(s.nodeId,'general')})).filter(s=>s.path.length).sort((a,b)=>a.path.length-b.path.length);return list[0].id;})()`);
    assert.equal((await run(`allocateNodeById('${socket}','general')`)).success,true);
    await run(`showNodeInfo(byId.get('${socket}'));document.querySelector('#jewelCreate').click();document.querySelector('#jewelEquip').click();`);
    assert.equal(await run('jewelState.placements.length'),1);
    const first=await run('jewelState.placements[0].instanceId');
    assert.equal((await run(`planCurrentRefund('${socket}','general')`)).errorCode,'JEWEL_EQUIPPED');
    assert.equal((await run(`deallocateNodeById('${socket}','general')`)).success,false);
    await run(`refundNormalTarget(byId.get('${socket}'))`);
    assert.equal(await run(`allocated.has('${socket}')`),true);
    report.checks.push('real socket equip and direct/API/preview refund blocked');
    await run(`document.querySelector('#jewelDefinition').selectedIndex=1;document.querySelector('#jewelCreate').click();document.querySelector('#jewelEquip').click();`);
    assert.notEqual(await run('jewelState.placements[0].instanceId'),first);
    assert.equal(await run('jewelState.instances.length'),2);
    const occupied=await run('JSON.stringify(jewelState)');
    await run('window.confirm=()=>false;resetBuild();selectClass(classOptions[1].name);window.confirm=()=>true;true;');
    assert.equal(await run('JSON.stringify(jewelState)'),occupied);
    fs.writeFileSync(path.join(evidence,'equipped.png'),(await win.webContents.capturePage()).toPNG());
    await run(`document.querySelector('#jewelClose').click();saveCurrentBuild()`);
    await run('refreshLocalizedUI()');assert.equal(await run("document.querySelector('#jewelManager').open"),false);
    const saved=fs.readFileSync(buildPath,'utf8');assert.equal(JSON.parse(saved).schemaVersion,2);
    await run('resetBuild()');assert.equal(await run('jewelState.instances.length'),0);
    await run('openBuild()');assert.equal(await run('jewelState.instances.length'),2);
    assert.equal(await run('jewelState.placements.length'),1);
    assert.equal(await run(`allocated.has('${socket}')`),true);
    report.checks.push('replace preserves inventory; real Save IPC -> reset -> Open IPC restores allocations and jewels');
    await run(`showNodeInfo(byId.get('${socket}'));document.querySelector('#jewelRemove').click();`);
    assert.equal(await run('jewelState.placements.length'),0);assert.equal(await run('jewelState.instances.length'),2);
    await run(`document.querySelector('#jewelCopy').click();`);assert.equal(await run('jewelState.instances.length'),3);
    await run(`document.querySelector('#jewelDelete').click();`);assert.equal(await run('jewelState.instances.length'),2);
    fs.writeFileSync(path.join(evidence,'inventory.png'),(await win.webContents.capturePage()).toPNG());
    await run(`document.querySelector('#jewelClose').click();`);
    assert.equal((await run(`deallocateNodeById('${socket}','general')`)).success,true);
    report.checks.push('remove keeps instance; copy/delete; refund succeeds after unequip');
    const before=await run('JSON.stringify(currentBuildRuntimeState().jewelState)');
    fs.writeFileSync(buildPath,'{"schemaVersion":99}');await run('openBuild()');
    assert.equal(await run('JSON.stringify(currentBuildRuntimeState().jewelState)'),before);
    report.checks.push('invalid file leaves current jewels unchanged');
    const v1=JSON.parse(saved);v1.schemaVersion=1;delete v1.build.jewels;v1.future={opaque:[1,2]};
    fs.writeFileSync(buildPath,JSON.stringify(v1));const oldBytes=fs.readFileSync(buildPath,'utf8');
    await run('openBuild()');assert.equal(fs.readFileSync(buildPath,'utf8'),oldBytes);
    assert.equal(await run('jewelState.instances.length'),0);
    await run('saveCurrentBuild()');const migrated=JSON.parse(fs.readFileSync(buildPath,'utf8'));
    assert.equal(migrated.schemaVersion,2);assert.deepEqual(migrated.future,{opaque:[1,2]});
    v1.build.jewels={privateData:'synthetic',instances:[{legacy:1}]};
    fs.writeFileSync(buildPath,JSON.stringify(v1));const collisionBytes=fs.readFileSync(buildPath,'utf8');
    await run('openBuild();');await run('saveCurrentBuild()');
    assert.equal(fs.readFileSync(buildPath,'utf8'),collisionBytes);
    report.checks.push('reset/class cancel preserves jewels; localization does not reopen dialog; v1 stays unchanged until Save; private collision never overwrites source');
    assert.deepEqual(report.errors,[]);
    fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  } finally {win.destroy();app.quit();}
}).catch(error=>{console.error(error);app.exit(1);});
