'use strict';
// Isolated real-renderer button check; public pinned game data + sanitized fixture only.
const { app, BrowserWindow, protocol, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'p2at-wegame-confirm-'));
app.setPath('userData', profile);
protocol.registerSchemesAsPrivileged([{ scheme: 'poe2', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
const cache = process.env.P2AT_GAME_CACHE;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
setTimeout(() => app.exit(1), 60000).unref();
app.whenReady().then(async () => {
  assert.ok(cache, 'Set P2AT_GAME_CACHE to pinned public game-data fixtures');
  const official = JSON.parse(fs.readFileSync(path.join(cache, 'core/official-data.json')));
  const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../fixtures/wegame-share/public-share.sanitized.json')));
  // Public canonical ID observed in the failing candidate; no share/role identity.
  fixture.talentTree.talent_tree.hashes.push(14265);
  const candidate = require('../src/interop/wegame-import-adapter.js').adaptWeGamePassiveImport(fixture, official);
  ipcMain.handle('wegame:import-passives', () => ({ ok: true, value: candidate }));
  ipcMain.handle('agent:status', () => ({ configured: false }));
  ipcMain.handle('data:cache-status', () => ({}));
  ipcMain.handle('app:get-info', () => ({}));
  ipcMain.handle('rag:status', () => ({}));
  ipcMain.handle('settings:retrieval-status', () => ({}));
  const win = new BrowserWindow({ show: false, width: 1300, height: 900,
    webPreferences: { offscreen: true, partition: 'wegame-confirm-test', preload: path.resolve(__dirname, '../electron/preload.cjs'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  win.webContents.session.webRequest.onBeforeRequest((details, done) => done({ cancel: !/^(file|poe2):/.test(details.url) }));
  win.webContents.session.protocol.handle('poe2', request => {
    const url = new URL(request.url);
    const folder = url.hostname === 'localization' ? 'localization-candidates' : url.hostname === 'portraits' ? 'portraits' : 'core';
    const filename = path.join(cache, folder, path.basename(url.pathname));
    return fs.existsSync(filename) ? new Response(fs.readFileSync(filename)) : new Response('fixture unavailable', { status: 404 });
  });
  const run = code => win.webContents.executeJavaScript(code);
  async function until(code) {
    for (let i = 0; i < 250; i++) { if (await run(code)) return; await wait(40); }
    throw Error('Timed out: ' + code + ' / ' + await run("JSON.stringify({open:document.querySelector('#weGameDialog').open,status:document.querySelector('#weGameStatus').textContent})"));
  }
  async function click(id) {
    const point = await run(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    await wait(80);
    if (id === 'weGameApply') await until('!weGameApplyBusy');
  }
  const state = () => run("JSON.stringify(captureBuildTransactionState(),(_k,v)=>v instanceof Set?[...v]:v)");
  async function localStatus(message) {
    const result = await run(`(()=>{const e=document.querySelector('#weGameActionStatus'),r=e.getBoundingClientRect(),d=document.querySelector('#weGameDialog').getBoundingClientRect();return {text:e.textContent,visible:r.top>=d.top&&r.bottom<=d.bottom&&r.top>=0&&r.bottom<=innerHeight};})()`);
    assert.ok(result.text.includes(message), result.text);
    assert.equal(result.visible, true, 'outcome must be visible beside confirmation');
    assert.ok(!result.text.includes('SYNTHETIC_PRIVATE_ERROR'));
  }
  try {
    await win.loadFile(path.resolve(__dirname, '../renderer/index.html'));
    await until("plannerDataReady && !document.querySelector('#weGameDialog').inert");
    await run("document.querySelector('#classSelect').value='Witch';document.querySelector('#classSelect').dispatchEvent(new Event('change'))");
    await click('importWeGame');
    await until("document.querySelector('#weGameDialog').open");
    await run("document.querySelector('#weGameUrl').value='https://www.wegame.com.cn/helper/poe2/#/share/synthetic'");
    await click('weGameRead');
    await until("!document.querySelector('#weGamePreview').hidden");
    assert.equal(await run("byId.has('14265')"), false);
    assert.ok(await run("document.querySelector('#weGameOmissionList').textContent.includes('通用 · 节点 14265')"));
    const before = await state();
    await run("window.__statuses=[];new MutationObserver(()=>window.__statuses.push(document.querySelector('#weGameActionStatus').textContent)).observe(document.querySelector('#weGameActionStatus'),{childList:true});document.querySelector('#weGameDialog').scrollTop=999999");
    assert.ok(await run("document.querySelector('#weGameStatus').getBoundingClientRect().bottom<document.querySelector('#weGameDialog').getBoundingClientRect().top"), 'original top status is offscreen in long preview');
    for (const [id, message] of [['weGameReplaceAck', '请明确确认覆盖'], ['weGamePartialAck', '请勾选实验性部分导入'], ['weGameOmissionAck', '存在将被省略']]) {
      assert.ok(await run(`!document.getElementById('${id}').closest('label').hidden`));
      await click('weGameApply');
      assert.equal(await state(), before, 'unconfirmed import must preserve Build and history');
      await localStatus(message);
      await click(id);
    }
    console.log('PASS missing acknowledgments rejected without Build/history changes');
    await run("window.__savedPreview=weGamePreviewValue;weGamePreviewValue=null");
    await click('weGameApply'); await localStatus('没有可应用的预览');
    assert.equal(await state(), before);
    await run("weGamePreviewValue=structuredClone(window.__savedPreview);weGamePreviewValue.candidate.class.ascendancyId='invalid-fixture'");
    await click('weGameApply'); await localStatus('[ASCENDANCY_MISMATCH]');
    assert.equal(await state(), before);
    await run("weGamePreviewValue=window.__savedPreview;window.__runtime=currentBuildRuntimeState;currentBuildRuntimeState=()=>{throw Error('SYNTHETIC_PRIVATE_ERROR')};void 0");
    await click('weGameApply'); await localStatus('导入校验异常');
    await run('currentBuildRuntimeState=window.__runtime;void 0');
    assert.equal(await state(), before);
    await run("window.__refresh=refreshBuildDependentState;window.__failOnce=true;refreshBuildDependentState=(...args)=>{if(window.__failOnce){window.__failOnce=false;throw Error('SYNTHETIC_PRIVATE_ERROR')}return window.__refresh(...args)};void 0");
    await click('weGameApply'); await localStatus('已恢复原 Build');
    await run('refreshBuildDependentState=window.__refresh;void 0');
    assert.equal(await state(), before, 'finalization failure must roll back Build and history');
    await run("window.__capture=captureBuildTransactionState;captureBuildTransactionState=()=>{throw Error('SYNTHETIC_PRIVATE_ERROR')};void 0");
    await click('weGameApply'); await localStatus('无法确认回滚结果');
    assert.equal(await run("document.querySelector('#saveBuild').disabled"), true);
    await run('captureBuildTransactionState=window.__capture;buildStateUnsafe=false;setBuildControlsReady(plannerDataReady)');
    assert.equal(await state(), before);
    assert.ok(await run("window.__statuses.some(s=>s.includes('正在校验'))"));
    console.log('PASS missing/invalid candidate, unexpected validation, rollback and unexpected transaction feedback');
    await run("document.querySelector('#weGameApply').click();document.querySelector('#weGameDialog').dispatchEvent(new Event('cancel',{cancelable:true}));void 0");
    await until('!weGameApplyBusy');
    assert.equal(await state(), before, 'Escape during progress must cancel before any write');
    assert.equal(await run("document.querySelector('#weGameDialog').open"), false);
    await click('importWeGame');
    await click('weGameRead');
    await until("!document.querySelector('#weGamePreview').hidden");
    for (const id of ['weGameReplaceAck', 'weGamePartialAck', 'weGameOmissionAck']) await click(id);
    console.log('PASS cancellation during progress preserves original Build');
    console.log('BEFORE', await run("JSON.stringify({ready:plannerDataReady,preview:!!weGamePreviewValue,disabled:document.querySelector('#weGameApply').disabled,checked:['weGamePartialAck','weGameOmissionAck','weGameReplaceAck'].map(id=>document.getElementById(id).checked),class:document.querySelector('#weGameClass').value,asc:document.querySelector('#weGameAscendancy').value})"));
    await click('weGameApply');
    console.log('AFTER', await run("JSON.stringify({open:document.querySelector('#weGameDialog').open,status:document.querySelector('#weGameStatus').textContent,feedback:document.querySelector('#buildFeedbackSummary').textContent})"));
    assert.equal(await run("document.querySelector('#weGameDialog').open"), false, 'confirmed import should close dialog');
    assert.equal(await run("currentBuildRuntimeState().allocated.has('14265')"), false);
    console.log('PASS real confirmation click');
  } finally { win.destroy(); }
}).then(() => app.exit(0)).catch(error => { console.error(error.message); app.exit(1); });
