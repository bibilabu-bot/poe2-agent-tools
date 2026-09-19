"use strict";

(() => {
  const byId = (id) => document.getElementById(id);
  const plannerView = byId("plannerView"), agentView = byId("agentView");
  const api = window.desktopAPI?.agent;
  const MODEL_PREFERENCE_KEY = "p2at.agent.preferred-model";
  let configured = false, running = false, conversationId = 0, configRevision = 0;

  function preferredModel() { try { return localStorage.getItem(MODEL_PREFERENCE_KEY) || ""; } catch { return ""; } }
  function rememberModel(model) { try { if (model) localStorage.setItem(MODEL_PREFERENCE_KEY, model); } catch {} }

  function switchView(showAgent) {
    agentView.hidden = !showAgent;
    plannerView.hidden = showAgent;
    if (!showAgent) requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  }
  byId("switchToAgent").addEventListener("click", () => switchView(true));
  byId("switchToPlanner").addEventListener("click", () => switchView(false));

  function targetHost() {
    try { return new URL(byId("agentBaseUrl").value).host; } catch { return "地址待确认"; }
  }
  function setStatus(message, kind = "") {
    const el = byId("agentConnectionStatus"); el.textContent = message; el.className = `agent-status ${kind}`;
  }
  function setModelStatus(message, kind = "") {
    const el = byId("agentModelStatus"); el.textContent = message; el.className = `agent-status ${kind}`;
  }
  function resetModelOptions(message = "先连接并获取模型") {
    const option = document.createElement("option"); option.value = ""; option.textContent = message;
    byId("agentModelSelect").replaceChildren(option);
    byId("agentModel").value = "";
  }
  function updateControls() {
    byId("agentLoadModels").disabled = !configured || running;
    byId("agentModelSelect").disabled = !configured || running || byId("agentModelSelect").options.length <= 1;
    byId("agentInput").disabled = !configured || running;
    byId("agentSend").disabled = !configured || running;
    byId("agentStop").disabled = !running;
    byId("agentRunState").textContent = running ? "正在运行…" : "空闲";
  }
  function addMessage(role, text) {
    const list = byId("agentMessages");
    list.querySelector(".agent-empty")?.remove();
    const item = document.createElement("div"); item.className = `agent-message ${role}`; item.textContent = text; list.append(item); list.scrollTop = list.scrollHeight;
  }
  function showTrace(trace) {
    const log = byId("agentToolLog");
    if (!trace?.length) { log.hidden = true; log.textContent = ""; return; }
    log.textContent = trace.map((item) => `${item.ok ? "✓" : "!"} ${item.name} · ${item.callId}\n${item.result}`).join("\n\n"); log.hidden = false;
  }
  async function refreshStatus() {
    if (!api) { setStatus("桌面安全桥不可用", "error"); return; }
    const revision = configRevision;
    const status = await api.getStatus();
    if (revision !== configRevision) return;
    configured = status.configured;
    if (configured && status.baseUrl) byId("agentBaseUrl").value = status.baseUrl;
    byId("agentChatTarget").textContent = status.targetHost ? `目标服务：${status.targetHost}` : "未连接服务";
    setStatus(configured ? `已连接：${status.targetHost}${status.credentialStored ? "（Key 已安全缓存到本机）" : ""}` : "尚未连接", configured ? "connected" : ""); updateControls();
    if (configured && !byId("agentModel").value.trim()) await loadModels();
  }
  byId("agentBaseUrl").addEventListener("input", async () => {
    const revision = ++configRevision;
    byId("agentChatTarget").textContent = `待连接目标：${targetHost()}`;
    if (api) await api.clearConfig();
    if (revision !== configRevision) return;
    resetModelOptions(); setModelStatus("尚未获取模型；也可以手动填写模型 ID");
    if (configured) await newConversation(false);
    configured = false; setStatus("API 地址已改变；旧 Key 已清除，请重新连接", "error"); updateControls();
  });
  byId("agentConnect").addEventListener("click", async () => {
    if (!api) return;
    const revision = ++configRevision;
    const requestedBaseUrl = byId("agentBaseUrl").value;
    const apiKeyInput = byId("agentApiKey");
    resetModelOptions("连接后获取模型"); setModelStatus("连接成功后可获取模型列表");
    setStatus(`正在连接：${targetHost()}…`);
    const result = await api.configure({ baseUrl: requestedBaseUrl, apiKey: apiKeyInput.value });
    apiKeyInput.value = "";
    if (revision !== configRevision || requestedBaseUrl !== byId("agentBaseUrl").value) {
      configured = false; setStatus("API 地址已变化；旧连接结果已丢弃，请重新连接", "error"); updateControls(); return;
    }
    if (!result.ok) { configured = false; setStatus(result.error.message, "error"); updateControls(); return; }
    configured = true; conversationId += 1; byId("agentChatTarget").textContent = `目标服务：${result.targetHost}`; setStatus(`已连接：${result.targetHost}（Key 已安全缓存到本机）`, "connected"); updateControls();
    await loadModels();
  });
  byId("agentClearConfig").addEventListener("click", async () => {
    configRevision += 1;
    const result = api ? await api.clearConfig() : { ok: false, error: { message: "桌面安全桥不可用" } };
    configured = false; byId("agentApiKey").value = ""; await newConversation(false);
    if (!result.ok) { setStatus(`${result.error.message}；本地缓存可能仍存在`, "error"); updateControls(); return; }
    await refreshStatus();
  });
  async function loadModels() {
    const button = byId("agentLoadModels");
    button.disabled = true; button.textContent = "获取中…";
    setModelStatus(`正在从 ${targetHost()} 获取模型，请稍候…`);
    try {
      const result = await api.listModels();
      if (result.stale) { setModelStatus("连接已变化，已忽略旧模型列表", "error"); return; }
      if (!result.ok) { setModelStatus(`${result.error.message}；仍可手动填写模型 ID`, "error"); return; }
      const select = byId("agentModelSelect");
      const placeholder = document.createElement("option"); placeholder.value = ""; placeholder.textContent = result.models.length ? "请选择模型" : "服务未返回模型";
      select.replaceChildren(placeholder, ...result.models.map((id) => { const option = document.createElement("option"); option.value = id; option.textContent = id; return option; }));
      const remembered = preferredModel();
      const selected = result.models.includes(remembered) ? remembered : result.models[0];
      if (selected) { select.value = selected; byId("agentModel").value = selected; rememberModel(selected); }
      setModelStatus(`已获取 ${result.models.length} 个模型；列表不代表支持工具调用`, "connected");
    } catch {
      setModelStatus("模型列表请求失败；仍可手动填写模型 ID", "error");
    } finally {
      button.textContent = "重新获取"; updateControls();
    }
  }
  byId("agentLoadModels").addEventListener("click", loadModels);
  byId("agentModelSelect").addEventListener("change", (event) => {
    if (event.target.value) { byId("agentModel").value = event.target.value; rememberModel(event.target.value); }
  });
  byId("agentModel").addEventListener("change", (event) => rememberModel(event.target.value.trim()));
  async function newConversation(clearUi = true) {
    conversationId += 1; showTrace([]);
    if (api) await api.reset();
    if (clearUi) { byId("agentMessages").replaceChildren(Object.assign(document.createElement("div"), { className: "agent-empty", textContent: "新会话已建立。" })); }
  }
  byId("agentNewChat").addEventListener("click", () => newConversation(true));
  byId("agentStop").addEventListener("click", () => api?.cancel());
  byId("agentComposer").addEventListener("submit", async (event) => {
    event.preventDefault(); if (!configured || running) return;
    const input = byId("agentInput"), text = input.value.trim(), model = byId("agentModel").value.trim();
    if (!text) return;
    if (!model) {
      addMessage("error", "尚未选择模型。请展开左侧“模型与连接设置”后选择模型，或等待模型列表自动加载。");
      byId("agentView").querySelector(".agent-settings").open = true;
      setStatus("请先选择模型", "error"); return;
    }
    rememberModel(model);
    const requestConversation = conversationId; addMessage("user", text); input.value = ""; running = true; updateControls(); showTrace([]);
    const result = await api.send({ model, text, toolsEnabled: byId("agentToolsEnabled").checked });
    running = false; updateControls();
    if (requestConversation !== conversationId || result.stale) return;
    if (!result.ok) { addMessage("error", result.error.message); return; }
    showTrace(result.trace); addMessage("assistant", result.text || "（模型未返回文本）");
  });
  byId("agentInput").addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); byId("agentComposer").requestSubmit(); } });
  refreshStatus().catch(() => setStatus("无法读取连接状态", "error"));
})();
