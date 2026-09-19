"use strict";

// Offline, isolated DOM smoke: never loads the application's credential service.
const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "p2at-integration-ui-"));
app.setPath("userData", profile);
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (_details, callback) => callback({ cancel: true }));
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  try {
    await win.loadFile(path.join(__dirname, "../renderer/index.html"));
    const result = await win.webContents.executeJavaScript(`(() => {
      const check = (condition, message) => { if (!condition) throw new Error(message); };
      check(document.querySelector('.content').dataset.layoutMounted === 'true', 'layout did not mount');
      const button = document.getElementById('switchToAgent');
      check(button && button.isConnected && button.getBoundingClientRect().width > 0, 'agent navigation was removed or hidden');
      check(!button.closest('.toolbar'), 'agent navigation must survive toolbar replacement');
      button.click();
      check(!document.getElementById('agentView').hidden && document.getElementById('plannerView').hidden, 'agent switch failed');
      document.getElementById('switchToPlanner').click();
      check(document.getElementById('agentView').hidden && !document.getElementById('plannerView').hidden, 'planner return failed');
      check(document.getElementById('importWeGame').isConnected, 'WeGame action lost');
      check(document.getElementById('weGameDialog').isConnected, 'WeGame dialog lost');
      return 'mounted navigation, page round-trip and WeGame controls passed';
    })()`);
    console.log(result);
    app.exit(0);
  } catch (error) { console.error(error.message); app.exit(1); }
});
