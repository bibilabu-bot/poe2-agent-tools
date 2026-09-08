const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("desktopAPI", {
  getAppInfo: () => ipcRenderer.invoke("app:get-info"),
  getDataPaths: () => ipcRenderer.invoke("data:get-path"),
  getCacheStatus: () => ipcRenderer.invoke("data:cache-status"),
  syncCoreData: () => ipcRenderer.invoke("data:sync-core"),
  saveBuildJson: (payload) => ipcRenderer.invoke("build:save-json", payload),
  openBuildJson: () => ipcRenderer.invoke("build:open-json")
});
