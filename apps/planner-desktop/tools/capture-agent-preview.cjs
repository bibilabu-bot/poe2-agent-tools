"use strict";

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");

app.whenReady().then(async () => {
  ipcMain.handle("agent:status", async () => ({ configured: false, targetHost: null, running: false }));
  ipcMain.handle("app:get-info", async () => ({ version: app.getVersion() }));
  ipcMain.handle("data:cache-status", async () => []);
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: "#080a0d",
    webPreferences: {
      preload: path.join(__dirname, "..", "electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  const state = await win.webContents.executeJavaScript("document.getElementById('switchToAgent').click(); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve({ plannerHidden: document.getElementById('plannerView').hidden, agentHidden: document.getElementById('agentView').hidden }))))", true);
  if (!state.plannerHidden || state.agentHidden) throw new Error("Agent view did not become independent of the Planner view");
  console.log(JSON.stringify(state));
  win.show();
  await new Promise((resolve) => setTimeout(resolve, 150));
  const image = await win.webContents.capturePage();
  const output = path.join(__dirname, "..", "..", "..", "docs", "assets", "screenshots", "agent-mvp.png");
  await fs.writeFile(output, image.toPNG());
  console.log(output);
  app.quit();
});
