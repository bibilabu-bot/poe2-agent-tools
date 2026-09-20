"use strict";

// Dedicated Electron test; DOM text alone cannot detect display:none.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
app.on("window-all-closed", () => {}); // Do not mask assertion failures on teardown.

app.whenReady().then(async () => {
  const renderer = path.join(__dirname, "../renderer");
  const html = await fs.readFile(path.join(renderer, "index.html"), "utf8");
  const plannerStyle = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const agentStyle = await fs.readFile(path.join(renderer, "agent-panel.css"), "utf8");
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<style>${plannerStyle}\n${agentStyle}</style>
      <div class="agent-view"><div class="agent-message error">HTTP 402</div>
      <div class="agent-activity error">处理失败</div><div class="agent-status error">模型获取失败</div></div>
      <div id="error" class="error">Planner error</div>`)}`);
    const states = await window.webContents.executeJavaScript(`(() => {
      const read = el => { const s = getComputedStyle(el), r = el.getBoundingClientRect();
        return { display: s.display, position: s.position, width: r.width, height: r.height }; };
      return { agent: [...document.querySelectorAll('.agent-view .error')].map(read), planner: read(document.getElementById('error')) };
    })()`);
    for (const state of states.agent) {
      assert.notEqual(state.display, "none", "agent errors must be visible");
      assert.equal(state.position, "static", "agent errors must remain in normal layout");
      assert.ok(state.width > 0 && state.height > 0, "agent errors must occupy rendered space");
    }
    assert.equal(states.planner.display, "none", "Planner overlay remains hidden until explicitly shown");
    console.log("PASS: message, activity and model/connection errors render; Planner overlay unchanged");
  } finally { window.destroy(); }
}).then(() => app.exit(0), error => { console.error(error.message); app.exit(1); });
