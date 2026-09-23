const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("desktopAPI", {
  rag: Object.freeze({status:()=>ipcRenderer.invoke("rag:status"),build:()=>ipcRenderer.invoke("rag:build"),cancel:()=>ipcRenderer.invoke("rag:cancel")}),
  retrievalSettings: Object.freeze({
    test: request => ipcRenderer.invoke("settings:retrieval-test", request),
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
    inspectPrompt: () => ipcRenderer.invoke("agent:inspect-prompt"),
    savePrompts: (overrides) => ipcRenderer.invoke("agent:save-prompts", { overrides }),
    configure: (request) => ipcRenderer.invoke("agent:configure", request),
    clearConfig: () => ipcRenderer.invoke("agent:clear-config"),
    listModels: () => ipcRenderer.invoke("agent:list-models"),
    send: (request) => ipcRenderer.invoke("agent:send", request),
    onRunEvent: (listener) => {
      if (typeof listener !== "function") return () => {};
      const handler = (_event, value) => listener(value);
      ipcRenderer.on("agent:run-event", handler);
      return () => ipcRenderer.removeListener("agent:run-event", handler);
    },
    cancel: () => ipcRenderer.invoke("agent:cancel"),
    reset: () => ipcRenderer.invoke("agent:reset"),
    restoreConversation: (messages) => ipcRenderer.invoke("agent:restore-conversation", { messages }),
    listSessions: () => ipcRenderer.invoke("agent:sessions"),
    selectSession: (conversationId) => ipcRenderer.invoke("agent:select-session", { conversationId }),
    deleteSession: (conversationId) => ipcRenderer.invoke("agent:delete-session", { conversationId, confirmed: true }),
    sessionHistory: (conversationId, before = null) => ipcRenderer.invoke("agent:session-history", { conversationId, before })
  })
});
