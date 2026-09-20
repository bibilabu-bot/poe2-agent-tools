const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("desktopAPI", {
  retrievalSettings: Object.freeze({
    status: () => ipcRenderer.invoke("settings:retrieval-status"),
    save: request => ipcRenderer.invoke("settings:retrieval-save", request),
    clear: kind => ipcRenderer.invoke("settings:retrieval-clear", { kind })
  }),
  getAppInfo: () => ipcRenderer.invoke("app:get-info"),
  getDataPaths: () => ipcRenderer.invoke("data:get-path"),
  getCacheStatus: () => ipcRenderer.invoke("data:cache-status"),
  syncCoreData: () => ipcRenderer.invoke("data:sync-core"),
  saveBuildJson: (request) => ipcRenderer.invoke("build:save-json", request),
  openBuildJson: () => ipcRenderer.invoke("build:open-json"),
  importWeGamePassives: (url) => ipcRenderer.invoke("wegame:import-passives", { url }),
  agent: Object.freeze({
    getStatus: () => ipcRenderer.invoke("agent:status"),
    configure: (request) => ipcRenderer.invoke("agent:configure", request),
    clearConfig: () => ipcRenderer.invoke("agent:clear-config"),
    listModels: () => ipcRenderer.invoke("agent:list-models"),
    send: (request) => ipcRenderer.invoke("agent:send", request),
    cancel: () => ipcRenderer.invoke("agent:cancel"),
    reset: () => ipcRenderer.invoke("agent:reset"),
    restoreConversation: (messages) => ipcRenderer.invoke("agent:restore-conversation", { messages })
  })
});
