"use strict";

const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
app.on("window-all-closed", () => {}); // Explicit result below owns exit status.

app.whenReady().then(async () => {
  const renderer = path.join(__dirname, "../renderer");
  const html = (await fs.readFile(path.join(renderer, "index.html"), "utf8"))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<link\b[^>]*>/gi, "");
  const css = await fs.readFile(path.join(renderer, "agent-panel.css"), "utf8");
  const traceCode = await fs.readFile(path.join(renderer, "agent-trace.js"), "utf8");
  const panelCode = await fs.readFile(path.join(renderer, "agent-panel.js"), "utf8");
  const settingsCode = await fs.readFile(path.join(renderer, "retrieval-settings.js"), "utf8");
  const memoryResult = JSON.stringify({ turn_ids: [7, 8], offset: 0, complete: true, format: "json_text_fragment",
    text: JSON.stringify([{ turn_id: 7, messages: [{ role: "user", content: "<img src=x onerror=alert(1)>" }] }, { turn_id: 8, messages: [{ role: "assistant", content: "中文🙂" }] }]) });
  const isolated = session.fromPartition(`details-test-${Date.now()}`);
  await isolated.protocol.handle("https", () => new Response(html + `<style>${css}</style>`, { headers: { "content-type": "text/html; charset=utf-8" } }));
  const window = new BrowserWindow({ show: false, width:1200, height:900, webPreferences: { backgroundThrottling:false, session: isolated, sandbox: true, contextIsolation: true } });
  const evaluate = code => window.webContents.executeJavaScript(code);
  async function mount() {
    await window.loadURL("https://agent-details.test/");
    await evaluate(`window.desktopAPI = { agent: {
      getStatus: async () => ({configured:true, baseUrl:'https://test.example',targetHost:'test.example'}),
      listModels: async () => ({ok:true,models:['mock']}), restoreConversation: async () => ({ok:true}),
      send: async () => ({ok:true,text:'演示完成',trace:[
        {name:'search_memory',callId:'s1',ok:true,durationMs:0,arguments:'{"query":"琥珀"}',result:'{"matches":[{"turn_id":7}],"metadata_only":true}'},
        {name:'read_memory',callId:'r1',ok:true,durationMs:4,arguments:'{"start_turn_id":7,"count":2}',result:${JSON.stringify(memoryResult)}}]})
    } }; true;`);
    await evaluate(traceCode + "; true;"); await evaluate(panelCode);
    await evaluate(`window.savedProfiles={};window.desktopAPI.retrievalSettings={
      status:async()=>({ok:true,...window.savedProfiles}),
      save:async value=>{const profile={baseUrl:value.baseUrl,model:value.model,dimensions:value.dimensions,hasKey:true,verified:false};window.savedProfiles[value.kind]=profile;return {ok:true,profile};},
      clear:async kind=>{delete window.savedProfiles[kind];return {ok:true};}
    }; true;`);
    await evaluate(`window.ragFixture={building:false,ready:false,count:0};window.desktopAPI.rag={
      status:async()=>window.ragFixture,
      build:async()=>{window.ragFixture={building:true,completed:10,total:20};},
      cancel:async()=>{window.ragFixture={building:false,ready:false,error:'构建已停止，可重试'};}
    };true;`);
    await evaluate(settingsCode);
    await evaluate("document.getElementById('switchToAgent').click()");
  }
  async function waitFor(expression) {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error("UI state did not arrive");
  }
  async function checkMinimalLayout() {
    const layout = await evaluate(`(() => {
      const activity = document.querySelector('.agent-activity.done');
      return {stepCount:activity.querySelectorAll('.agent-activity-step').length,
        stepsDisplay:getComputedStyle(activity.querySelector('.agent-activity-steps')).display,
        rows:[...activity.querySelectorAll('.agent-operation')].map(d=>({
          border:getComputedStyle(d).borderTopWidth,background:getComputedStyle(d).backgroundColor,
          summaryBorder:getComputedStyle(d.querySelector('summary')).borderBottomWidth}))};
    })()`);
    assert.equal(layout.stepCount, 0); assert.equal(layout.stepsDisplay, "none");
    for (const row of layout.rows) {
      assert.equal(row.border, "0px"); assert.equal(row.background, "rgba(0, 0, 0, 0)");
      assert.equal(row.summaryBorder, "0px");
    }
  }
  try {
    await mount();
    await waitFor("!document.getElementById('agentSend').disabled");
    await evaluate("document.getElementById('ragBuild').click()");
    await waitFor("document.getElementById('ragStatus').textContent.includes('10 / 20')");
    assert.equal(await evaluate("document.getElementById('ragBuild').disabled"),true);
    await evaluate("document.getElementById('ragCancel').click()");
    await waitFor("document.getElementById('ragStatus').textContent.includes('已停止')");
    assert.equal(await evaluate("document.getElementById('ragBuild').disabled"),false);
    await evaluate("window.desktopAPI.rag.build=async()=>{window.ragFixture={building:false,ready:true,count:5102,version:'fixture-version'};};document.getElementById('ragBuild').click()");
    await waitFor("document.getElementById('ragStatus').textContent.includes('5102 个节点')");
    await waitFor("!document.querySelector('[data-save-profile=embedding]').disabled");
    await evaluate("window.desktopAPI.retrievalSettings.test=async()=>({ok:true,durationMs:12,detail:'返回有效向量'});document.querySelector('[data-test-profile=embedding]').click()");
    await waitFor("document.getElementById('embeddingStatus').textContent.includes('连接测试通过')");
    assert.equal(await evaluate("!!window.savedProfiles.embedding"),false);
    await evaluate("window.desktopAPI.retrievalSettings.test=async()=>({ok:false,error:{message:'HTTP 401：Key 无效'}});document.querySelector('[data-test-profile=embedding]').click()");
    await waitFor("document.getElementById('embeddingStatus').textContent.includes('HTTP 401')");
    assert.equal(await evaluate("document.querySelector('[data-test-profile=embedding]').disabled"),false);
    assert.equal(await evaluate("document.getElementById('embeddingModelSelect').value"), "text-embedding-v4");
    await evaluate("document.getElementById('embeddingModelSelect').value='text-embedding-v2';document.getElementById('embeddingModelSelect').dispatchEvent(new Event('change'))");
    assert.deepEqual(await evaluate("[...document.getElementById('embeddingDimensions').options].map(o=>o.value)"), ["1536"]);
    assert.equal(await evaluate("document.getElementById('embeddingModel').value"), "text-embedding-v2");
    await evaluate("document.getElementById('rerankerModelSelect').value='custom';document.getElementById('rerankerModelSelect').dispatchEvent(new Event('change'));document.getElementById('rerankerModel').value='custom-reranker'");
    assert.equal(await evaluate("document.getElementById('rerankerModel').hidden"), false);
    await evaluate("document.querySelector('[data-save-profile=reranker]').click()");
    await waitFor("document.getElementById('rerankerStatus').textContent.includes('已安全保存')");
    assert.equal(await evaluate("document.getElementById('rerankerModelSelect').value"), "custom");
    assert.equal(await evaluate("window.savedProfiles.reranker.model"), "custom-reranker");
    await evaluate("document.querySelector('[data-clear-profile=reranker]').click()");
    await waitFor("document.getElementById('rerankerStatus').textContent==='未配置'");
    await evaluate("document.querySelector('#agentView [data-page=settings]').click();document.getElementById('agentInput').value='未发送草稿'");
    assert.equal(await evaluate("!document.getElementById('settingsView').hidden && document.getElementById('agentView').hidden && document.getElementById('plannerView').hidden"),true);
    assert.equal(await evaluate("document.getElementById('settingsView').contains(document.getElementById('agentModel')) && !document.getElementById('agentView').querySelector('.agent-settings')"),true);
    await evaluate("document.getElementById('embeddingKey').value='fixture-secret';document.querySelector('[data-save-profile=embedding]').click()");
    await waitFor("document.getElementById('embeddingStatus').textContent.includes('已安全保存')");
    assert.equal(await evaluate("document.getElementById('embeddingKey').value"),"");
    assert.match(await evaluate("document.getElementById('embeddingStatus').textContent"), /未验证接口/);
    assert.equal(await evaluate("document.getElementById('rerankerStatus').textContent"),"未配置");
    assert.equal(await evaluate("JSON.stringify(localStorage).includes('fixture-secret')"),false);
    await evaluate("document.querySelector('[data-clear-profile=embedding]').click()");
    await waitFor("document.getElementById('embeddingStatus').textContent==='未配置'");
    await evaluate("window.desktopAPI.retrievalSettings.save=async()=>({ok:false,error:{message:'测试保存失败'}});document.querySelector('[data-save-profile=embedding]').click()");
    await waitFor("document.getElementById('embeddingStatus').textContent==='测试保存失败'");
    assert.equal(await evaluate("getComputedStyle(document.getElementById('embeddingStatus')).display!=='none'"),true);
    if (process.env.P2AT_SETTINGS_SCREENSHOT) {
      await new Promise(resolve=>setTimeout(resolve,200));
      await fs.writeFile(process.env.P2AT_SETTINGS_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
    }
    await evaluate("document.querySelector('#settingsView [data-page=agent]').click()");
    assert.equal(await evaluate("document.getElementById('agentInput').value"),"未发送草稿");
    await evaluate("document.getElementById('agentModel').value='mock'; document.getElementById('agentInput').value='查看记忆'; document.getElementById('agentComposer').requestSubmit()");
    await waitFor("document.querySelectorAll('.agent-operation').length === 2");
    await checkMinimalLayout();
    assert.equal(await evaluate("[...document.querySelectorAll('.agent-operation')].every(d=>!d.open)"), true);
    assert.match(await evaluate("document.querySelector('.agent-operation summary').textContent"), /已搜索记忆 · <1 ms/);
    assert.equal(await evaluate("[...document.querySelectorAll('.agent-operation summary')].some(s=>/#\\d/.test(s.textContent))"), false);
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.agent-operation-icon')].map(s=>s.dataset.icon)"), ["search", "book"]);
    await evaluate("document.querySelectorAll('.agent-operation summary')[1].click()");
    const first = await evaluate(`(() => { const d=document.querySelectorAll('.agent-operation')[1], p=d.querySelector('pre');
      return {open:d.open, visible:p.getBoundingClientRect().height>0, text:d.textContent, injected:d.querySelectorAll('img').length}; })()`);
    assert.equal(first.open, true); assert.equal(first.visible, true); assert.equal(first.injected, 0);
    assert.match(first.text, /"start_turn_id": 7/); assert.match(first.text, /前序搜索/); assert.match(first.text, /4 ms/);
    assert.match(first.text, /已解析，缩进展示/); assert.match(first.text, /\n    "turn_id": 7,/);
    assert.ok(!first.text.includes('\\"turn_id\\"'));
    await checkMinimalLayout();
    await evaluate("document.querySelectorAll('.agent-operation summary')[1].click()");
    assert.equal(await evaluate("document.querySelectorAll('.agent-operation')[1].open"), false);
    await mount();
    await waitFor("document.querySelectorAll('.agent-operation').length === 2");
    assert.match(await evaluate("document.querySelectorAll('.agent-operation')[1].textContent"), /"count": 2/);
    await checkMinimalLayout();
    const iconVariants = await evaluate(`window.AgentTrace.renderTrace(document,
      ['search_memory','read_memory','update_notebook','calculator','unknown_tool','__proto__'].map(name=>({name,ok:true,result:'{}'})))
      .map(d=>({icon:d.querySelector('svg').dataset.icon,path:d.querySelector('path').getAttribute('d'),hidden:d.querySelector('svg').getAttribute('aria-hidden')}))`);
    assert.deepEqual(iconVariants.map(v=>v.icon), ["search", "book", "pencil", "calculator", "tool", "tool"]);
    assert.equal(new Set(iconVariants.slice(0, 5).map(v=>v.path)).size, 5);
    assert.ok(iconVariants.every(v=>v.hidden === "true"));
    // Constrain the viewport and drive the real submit/render path with a deferred
    // response: waiting activity and completed tool/reply output must stay visible.
    await evaluate(`(() => {
      const list=document.getElementById('agentMessages');
      list.style.height='260px'; list.style.maxHeight='260px';
      window.desktopAPI.agent.send=()=>new Promise(resolve=>window.finishScrollTest=resolve);
      document.getElementById('agentInput').value='长消息\\n'.repeat(80);
      document.getElementById('agentComposer').requestSubmit();
    })()`);
    await waitFor("!!window.finishScrollTest");
    const atBottom = "(()=>{const l=document.getElementById('agentMessages');return l.scrollHeight>l.clientHeight && Math.abs(l.scrollHeight-l.clientHeight-l.scrollTop)<2})()";
    await waitFor(atBottom);
    await evaluate("document.getElementById('agentMessages').scrollTop=0");
    await new Promise(resolve=>setTimeout(resolve,1100));
    assert.equal(await evaluate("document.getElementById('agentMessages').scrollTop"),0, "timer ticks must not pull the reader down");
    await evaluate(`window.finishScrollTest({ok:true,text:'新输出\\n'.repeat(100),trace:[{name:'calculator',ok:true,result:'6'}]})`);
    await waitFor("!document.getElementById('agentSend').disabled");
    await waitFor(atBottom);
    const scrollbarStyles = await evaluate(`['#agentMessages','.agent-operation pre','#agentInput'].map(s=>{
      const style=getComputedStyle(document.querySelector(s));return {scheme:style.colorScheme,color:style.scrollbarColor,width:style.scrollbarWidth};})`);
    for (const style of scrollbarStyles) {
      assert.equal(style.scheme,'dark'); assert.equal(style.width,'thin');
      assert.equal(style.color,'rgb(85, 90, 99) rgb(16, 18, 22)');
    }
    console.log("PASS: dark nested scrollbars; running activity and tool/reply completion follow bottom; timer does not steal scroll position");
    console.log("PASS: production panel expands/collapses parameters, results, timing and memory links; reload restores details; HTML stays inert");
  } finally { window.destroy(); await isolated.clearStorageData(); }
}).then(() => app.exit(0), error => { console.error(error.stack); app.exit(1); });
