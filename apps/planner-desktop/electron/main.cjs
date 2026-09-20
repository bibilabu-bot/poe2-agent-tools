const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, safeStorage, Menu } = require("electron");
const { installEditContextMenu } = require("./edit-context-menu.cjs");
const { buildPassiveCorpus, passiveCorpusIdentity } = require("./passive-corpus.cjs");
const { createRagManager } = require("./rag-manager.cjs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const fs = require("node:fs/promises");
const { createBuildFileStore, createBuildIpcHandlers } = require("./build-file-store.cjs");
const {
  createRuntimeResourceCatalog,
  createRuntimeResourceStore,
  publicRuntimeResourceFailure,
} = require("./runtime-resource-store.cjs");
const upstreamLock = require("../../../data/upstream-sources.lock.json");
const cacheManifest = require("../data/cache/manifest.json");
const localizationCandidates = require("../data/localization-candidates.json");
const { createBoundedCandidateFetch, createLocalizationCandidateCatalog } = require("./localization-candidate.cjs");
const { createTrustedPlannerSenderPredicate, createWeGameImportService, createWeGameIpcHandler } = require("./wegame-import-service.cjs");
const { AgentService, createAgentIpcHandlers } = require("./agent-service.cjs");
const { AgentCredentialStore } = require("./agent-credential-store.cjs");
const { createRetrievalSettings } = require("./retrieval-settings.cjs");
const { OpenAICompatibleProvider } = require("./openai-compatible-provider.cjs");
const { PythonAgentError, PythonAgentClient } = require("./python-agent-client.cjs");

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
const localizationCatalog = createLocalizationCandidateCatalog(localizationCandidates);

const fetchRuntimeResource=createBoundedCandidateFetch(
  (url,options={})=>net.fetch(url,{cache:"no-store",...options}),
  localizationCatalog,
);
const runtimeStore = createRuntimeResourceStore({
  fetchResource: fetchRuntimeResource,
});

const MIME = {
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".lua": "text/plain; charset=utf-8",
  ".js": "text/plain; charset=utf-8"
};

function mimeFor(file) { return MIME[path.extname(file).toLowerCase()] || "application/octet-stream"; }
function bundledRoot() { return path.join(app.getAppPath(), "data", "cache"); }
function userCacheRoot() { return path.join(app.getPath("userData"), "game-data"); }

function resourcePaths(kind, name) {
  const safeName = path.basename(name);
  const rel = kind === "portrait"
    ? path.join("portraits", safeName)
    : kind === "localization"
      ? path.join("localization-candidates", safeName)
      : path.join("core", safeName);
  return {
    bundled: path.join(bundledRoot(), rel),
    cached: path.join(userCacheRoot(), rel),
  };
}

async function localResourceResponse(kind, name) {
  const descriptor = kind === "localization" ? localizationCatalog.resolve(name) : runtimeCatalog.resolve(kind, name);
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
    const signal=kind==="localization" ? AbortSignal.timeout(15000) : undefined;
    const bytes = await runtimeStore.downloadAndCache(descriptor, locations.cached,{signal});
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
    if (kind !== "data" && kind !== "portrait" && kind !== "localization") return new Response("Not found", { status: 404 });
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

async function loadOfficialTree({ signal } = {}) {
  signal?.throwIfAborted();
  const name = "official-data.json";
  const descriptor = runtimeCatalog.resolve("data", name);
  const locations = resourcePaths("data", name);
  let local = await runtimeStore.resolveVerifiedLocal(descriptor, locations.bundled, locations.cached);
  signal?.throwIfAborted();
  if (!local) local = { bytes: await runtimeStore.downloadAndCache(descriptor, locations.cached, { signal }) };
  signal?.throwIfAborted();
  return JSON.parse(local.bytes.toString("utf8"));
}

const weGameImportService = createWeGameImportService({ fetch: (url, options) => net.fetch(url, options), loadOfficialTree });
const agentService = new AgentService({
  client: new PythonAgentClient({ memoryPath: path.join(app.getPath("userData"), "agent-memory.sqlite3") }),
  modelLister: async ({ baseUrl, apiKey, signal }) => {
    const provider = new OpenAICompatibleProvider({
      baseUrl,
      apiKey,
      fetch: (url, options) => net.fetch(url, options),
    });
    try { return await provider.listModels({ signal }); }
    catch (error) {
      throw new PythonAgentError(error.code || "MODEL_LIST_FAILED", error.message || "获取模型列表失败");
    } finally { provider.clearSecret(); }
  },
});
let agentCredentialStore = null;
let plannerWindow = null;
const plannerPageUrl = pathToFileURL(path.join(__dirname, "..", "renderer", "index.html")).href;

const isTrustedPlannerSender = createTrustedPlannerSenderPredicate(() => plannerWindow?.webContents || null, plannerPageUrl);

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
  installEditContextMenu(win, Menu);
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (event, url) => { if (url !== plannerPageUrl) event.preventDefault(); });
  plannerWindow = win;
  win.on("closed", () => { if (plannerWindow === win) { void agentService.clearConfig(); plannerWindow = null; } });
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
ipcMain.handle("wegame:import-passives", createWeGameIpcHandler(weGameImportService, isTrustedPlannerSender));
const agentIpcHandlers = createAgentIpcHandlers(agentService, isTrustedPlannerSender, {
  save: (...args) => agentCredentialStore.save(...args),
  clear: (...args) => agentCredentialStore.clear(...args),
});
ipcMain.handle("agent:status", agentIpcHandlers.status);
ipcMain.handle("agent:configure", agentIpcHandlers.configure);
ipcMain.handle("agent:clear-config", agentIpcHandlers.clear);
ipcMain.handle("agent:list-models", agentIpcHandlers.models);
ipcMain.handle("agent:send", agentIpcHandlers.send);
ipcMain.handle("agent:cancel", agentIpcHandlers.cancel);
ipcMain.handle("agent:reset", agentIpcHandlers.reset);
ipcMain.handle("agent:restore-conversation", agentIpcHandlers.restore);
ipcMain.handle("agent:sessions", agentIpcHandlers.sessions);
ipcMain.handle("agent:select-session", agentIpcHandlers.selectSession);
ipcMain.handle("agent:session-history", agentIpcHandlers.sessionHistory);

app.whenReady().then(async()=>{
  const retrievalSettings = createRetrievalSettings({ userDataPath: app.getPath("userData"), safeStorage, isTrustedSender: isTrustedPlannerSender, fetchImpl: (url, options) => net.fetch(url, options) });
  ipcMain.handle("settings:retrieval-test", retrievalSettings.test);
  const ragManager = createRagManager({userDataPath:app.getPath("userData"),profiles:retrievalSettings.profiles,isTrustedSender:isTrustedPlannerSender,sourceVersion:passiveCorpusIdentity(upstreamLock,require("../data/localization-candidates.json")),
    loadCorpus:async()=>{
      const read = async(kind,name)=>{const response=await localResourceResponse(kind,name);if(!response.ok)throw new Error("source unavailable");return response.text();};
      const [official,runtime,translation,wegame]=await Promise.all([read("data","official-data.json"),read("data","tree-pre.json"),read("data","ChineseTranslation.lua"),read("localization","wegame-passive-tree-zh-cn.js")]);
      return buildPassiveCorpus({official:JSON.parse(official),runtime:JSON.parse(runtime),translation,wegame,sourceVersion:upstreamLock.snapshotId});
    }});
  agentService.ragConfiguration=ragManager.configuration;
  ipcMain.handle("rag:status",ragManager.status);
  ipcMain.handle("rag:build",ragManager.build);
  ipcMain.handle("rag:cancel",ragManager.cancel);
  app.on("before-quit",()=>ragManager.close());
  ipcMain.handle("settings:retrieval-status", retrievalSettings.status);
  ipcMain.handle("settings:retrieval-save", retrievalSettings.save);
  ipcMain.handle("settings:retrieval-clear", retrievalSettings.clear);
  agentCredentialStore = new AgentCredentialStore({ userDataPath: app.getPath("userData"), safeStorage });
  try {
    const cached = await agentCredentialStore.load();
    if (cached) { await agentService.configure(cached); agentService.setCredentialStored(true); }
  } catch (error) { console.warn(`[agent] ${error.code || "CREDENTIAL_RESTORE_FAILED"}: ${error.message}`); }
  await registerLocalDataProtocol();createWindow();app.on("activate",()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
});
app.on("window-all-closed",()=>{if(process.platform!=="darwin")app.quit();});
app.on("before-quit", () => { void agentService.clearConfig(); });
