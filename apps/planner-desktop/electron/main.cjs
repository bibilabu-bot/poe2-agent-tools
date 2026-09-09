const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { createBuildFileStore, createBuildIpcHandlers } = require("./build-file-store.cjs");
const {
  createRuntimeResourceCatalog,
  createRuntimeResourceStore,
  publicRuntimeResourceFailure,
} = require("./runtime-resource-store.cjs");
const upstreamLock = require("../../../data/upstream-sources.lock.json");
const cacheManifest = require("../data/cache/manifest.json");

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

const runtimeCatalog = createRuntimeResourceCatalog(upstreamLock, cacheManifest);
const runtimeStore = createRuntimeResourceStore({
  fetchResource: (url) => net.fetch(url, { cache: "no-store" }),
});

const MIME = {
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".lua": "text/plain; charset=utf-8"
};

function mimeFor(file) { return MIME[path.extname(file).toLowerCase()] || "application/octet-stream"; }
function bundledRoot() { return path.join(app.getAppPath(), "data", "cache"); }
function userCacheRoot() { return path.join(app.getPath("userData"), "game-data"); }

function resourcePaths(kind, name) {
  const safeName = path.basename(name);
  const rel = kind === "portrait" ? path.join("portraits", safeName) : path.join("core", safeName);
  return {
    bundled: path.join(bundledRoot(), rel),
    cached: path.join(userCacheRoot(), rel),
  };
}

async function localResourceResponse(kind, name) {
  const descriptor = runtimeCatalog.resolve(kind, name);
  if (!descriptor) return new Response("Not found", { status: 404 });
  const locations = resourcePaths(kind, name);
  const local = await runtimeStore.resolveVerifiedLocal(descriptor, locations.bundled, locations.cached);
  if (local) {
    return new Response(local.bytes, {
      status: 200,
      headers: { "content-type": mimeFor(name), "x-poe2-cache": local.source },
    });
  }

  try {
    const bytes = await runtimeStore.downloadAndCache(descriptor, locations.cached);
    return new Response(bytes, { status: 200, headers: { "content-type": mimeFor(name), "x-poe2-cache": "miss" } });
  } catch (error) {
    const failure = publicRuntimeResourceFailure(error);
    return new Response(failure.message, {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "x-poe2-error": failure.code },
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
  for (const name of runtimeCatalog.coreNames) {
    const descriptor = runtimeCatalog.resolve("data", name);
    const locations = resourcePaths("data", name);
    const local = await runtimeStore.resolveVerifiedLocal(descriptor, locations.bundled, locations.cached);
    rows.push({ name, available: Boolean(local), source: local?.source || null, bytes: local?.bytes.length || 0 });
  }
  return rows;
}

async function syncCoreData() {
  const result=[];
  for(const name of runtimeCatalog.coreNames) {
    const descriptor = runtimeCatalog.resolve("data", name);
    const target = resourcePaths("data", name).cached;
    try {
      const bytes = await runtimeStore.downloadAndCache(descriptor, target);
      result.push({ name, ok: true, bytes: bytes.length });
    } catch(error) {
      const failure = publicRuntimeResourceFailure(error);
      result.push({ name, ok: false, error: failure });
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
