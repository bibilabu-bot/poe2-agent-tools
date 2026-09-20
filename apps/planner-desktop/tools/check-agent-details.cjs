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
  const memoryResult = JSON.stringify({ turn_ids: [7, 8], offset: 0, complete: true, format: "json_text_fragment",
    text: JSON.stringify([{ turn_id: 7, messages: [{ role: "user", content: "<img src=x onerror=alert(1)>" }] }, { turn_id: 8, messages: [{ role: "assistant", content: "中文🙂" }] }]) });
  const isolated = session.fromPartition(`details-test-${Date.now()}`);
  await isolated.protocol.handle("https", () => new Response(html + `<style>${css}</style>`, { headers: { "content-type": "text/html; charset=utf-8" } }));
  const window = new BrowserWindow({ show: false, webPreferences: { session: isolated, sandbox: true, contextIsolation: true } });
  const evaluate = code => window.webContents.executeJavaScript(code);
  async function mount() {
    await window.loadURL("https://agent-details.test/");
    await evaluate(`window.desktopAPI = { agent: {
      getStatus: async () => ({configured:true, baseUrl:'https://test.example',targetHost:'test.example'}),
      listModels: async () => ({ok:true,models:['mock']}), restoreConversation: async () => ({ok:true}),
      send: async () => ({ok:true,text:'演示完成',trace:[
        {name:'search_memory',callId:'s1',ok:true,durationMs:2,arguments:'{"query":"琥珀"}',result:'{"matches":[{"turn_id":7}],"metadata_only":true}'},
        {name:'read_memory',callId:'r1',ok:true,durationMs:4,arguments:'{"start_turn_id":7,"count":2}',result:${JSON.stringify(memoryResult)}}]})
    } }; true;`);
    await evaluate(traceCode + "; true;"); await evaluate(panelCode);
    await evaluate("document.getElementById('switchToAgent').click()");
  }
  async function waitFor(expression) {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error("UI state did not arrive");
  }
  try {
    await mount();
    await waitFor("!document.getElementById('agentSend').disabled");
    await evaluate("document.getElementById('agentModel').value='mock'; document.getElementById('agentInput').value='查看记忆'; document.getElementById('agentComposer').requestSubmit()");
    await waitFor("document.querySelectorAll('.agent-operation').length === 2");
    assert.equal(await evaluate("[...document.querySelectorAll('.agent-operation')].every(d=>!d.open)"), true);
    await evaluate("document.querySelectorAll('.agent-operation summary')[1].click()");
    const first = await evaluate(`(() => { const d=document.querySelectorAll('.agent-operation')[1], p=d.querySelector('pre');
      return {open:d.open, visible:p.getBoundingClientRect().height>0, text:d.textContent, injected:d.querySelectorAll('img').length}; })()`);
    assert.equal(first.open, true); assert.equal(first.visible, true); assert.equal(first.injected, 0);
    assert.match(first.text, /"start_turn_id": 7/); assert.match(first.text, /搜索 #1/); assert.match(first.text, /4 ms/);
    assert.match(first.text, /已解析，缩进展示/); assert.match(first.text, /\n    "turn_id": 7,/);
    assert.ok(!first.text.includes('\\"turn_id\\"'));
    await evaluate("document.querySelectorAll('.agent-operation summary')[1].click()");
    assert.equal(await evaluate("document.querySelectorAll('.agent-operation')[1].open"), false);
    await mount();
    await waitFor("document.querySelectorAll('.agent-operation').length === 2");
    assert.match(await evaluate("document.querySelectorAll('.agent-operation')[1].textContent"), /"count": 2/);
    console.log("PASS: production panel expands/collapses parameters, results, timing and memory links; reload restores details; HTML stays inert");
  } finally { window.destroy(); await isolated.clearStorageData(); }
}).then(() => app.exit(0), error => { console.error(error.stack); app.exit(1); });
