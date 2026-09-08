const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const fssync = require("node:fs");
const { pathToFileURL } = require("node:url");
const { createBuildFileStore, createBuildIpcHandlers } = require("./build-file-store.cjs");

protocol.registerSchemesAsPrivileged([{
  scheme: "poe2",
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true
  }
}]);

const CORE_SOURCES = {
  "tree-pre.json": "https://cdn.jsdelivr.net/gh/drydream/poe2drydream@main/public/tree-pre.json",
  "atlas-skills.webp": "https://cdn.jsdelivr.net/gh/drydream/poe2drydream@main/public/atlas-skills.webp",
  "atlas-frame.webp": "https://cdn.jsdelivr.net/gh/drydream/poe2drydream@main/public/atlas-frame.webp",
  "tree-jump.json": "https://cdn.jsdelivr.net/gh/drydream/poe2drydream@main/public/tree-jump.json",
  "ChineseTranslation.lua": "https://cdn.jsdelivr.net/gh/addohm/PathOfBuilding-PoE2@cn-item-paste-upstream/src/Data/ChineseTranslation.lua",
  "mastery-effect-active.json": "https://cdn.jsdelivr.net/gh/grindinggear/poe2-skilltree-export@main/assets/mastery-effect-active.json",
  "mastery-effect-active.webp": "https://cdn.jsdelivr.net/gh/grindinggear/poe2-skilltree-export@main/assets/mastery-effect-active.webp",
  "official-data.json": "https://cdn.jsdelivr.net/gh/grindinggear/poe2-skilltree-export@main/data.json"
};

const MIME = {
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".lua": "text/plain; charset=utf-8"
};

function mimeFor(file) { return MIME[path.extname(file).toLowerCase()] || "application/octet-stream"; }
function bundledRoot() { return path.join(app.getAppPath(), "data", "cache"); }
function userCacheRoot() { return path.join(app.getPath("userData"), "game-data"); }

async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }

async function resolveCachedFile(kind, name) {
  const safeName = path.basename(name);
  const rel = kind === "portrait" ? path.join("portraits", safeName) : path.join("core", safeName);
  const bundled = path.join(bundledRoot(), rel);
  if (await exists(bundled)) return { path: bundled, source: "bundled" };
  const cached = path.join(userCacheRoot(), rel);
  if (await exists(cached)) return { path: cached, source: "cache" };
  return { path: cached, source: null };
}

function remoteFor(kind, name) {
  if (kind === "data") return CORE_SOURCES[name] || null;
  if (kind === "portrait" && /^background-[a-z0-9-]+\.webp$/i.test(name)) {
    return `https://cdn.jsdelivr.net/gh/drydream/poe2drydream@main/public/assets/${name}`;
  }
  return null;
}

async function downloadToCache(kind, name, target) {
  const remote = remoteFor(kind, name);
  if (!remote) throw new Error(`Unknown local resource: ${kind}/${name}`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const res = await net.fetch(remote, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${remote}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const temp = target + ".part";
  await fs.writeFile(temp, bytes);
  await fs.rename(temp, target);
  return bytes;
}

async function localResourceResponse(kind, name) {
  const resolved = await resolveCachedFile(kind, name);
  if (resolved.source) return net.fetch(pathToFileURL(resolved.path).toString());

  try {
    const bytes = await downloadToCache(kind, name, resolved.path);
    return new Response(bytes, { status: 200, headers: { "content-type": mimeFor(name), "x-poe2-cache": "miss" } });
  } catch (error) {
    return new Response(`Local resource unavailable and first-time download failed:\n${error.message}`, {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  }
}

async function registerLocalDataProtocol() {
  protocol.handle("poe2", async (request) => {
    const u = new URL(request.url);
    const kind = u.hostname;
    const name = decodeURIComponent(u.pathname.replace(/^\//, ""));
    if (kind !== "data" && kind !== "portrait") return new Response("Not found", { status: 404 });
    return localResourceResponse(kind, name);
  });
}

async function coreCacheStatus() {
  const rows=[];
  for (const name of Object.keys(CORE_SOURCES)) {
    const r=await resolveCachedFile("data",name);
    let bytes=0;
    if(r.source){ try { bytes=(await fs.stat(r.path)).size; } catch {} }
    rows.push({name,available:Boolean(r.source),source:r.source,bytes});
  }
  return rows;
}

async function syncCoreData() {
  const result=[];
  for(const name of Object.keys(CORE_SOURCES)) {
    const target=path.join(userCacheRoot(),"core",name);
    try {
      const bytes=await downloadToCache("data",name,target);
      result.push({name,ok:true,bytes:bytes.length});
    } catch(error) {
      result.push({name,ok:false,error:error.message});
    }
  }
  return result;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 980,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#0b0d10",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (event, url) => { if (!url.startsWith("file://")) event.preventDefault(); });
  return win;
}

async function ensureBuildDir() {
  const dir=path.join(app.getPath("userData"),"builds"); await fs.mkdir(dir,{recursive:true}); return dir;
}

const buildIpcHandlers = createBuildIpcHandlers({
  dialogs: dialog,
  ensureBuildDir,
  store: createBuildFileStore()
});

ipcMain.handle("app:get-info", async () => ({version:app.getVersion(),electron:process.versions.electron,chrome:process.versions.chrome,node:process.versions.node,platform:process.platform,userData:app.getPath("userData")}));
ipcMain.handle("data:cache-status", coreCacheStatus);
ipcMain.handle("data:sync-core", syncCoreData);
ipcMain.handle("data:get-path", async () => ({bundledData:bundledRoot(),userData:userCacheRoot()}));

ipcMain.handle("build:save-json", buildIpcHandlers.save);
ipcMain.handle("build:open-json", buildIpcHandlers.open);

app.whenReady().then(async()=>{await registerLocalDataProtocol();createWindow();app.on("activate",()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});});
app.on("window-all-closed",()=>{if(process.platform!=="darwin")app.quit();});
