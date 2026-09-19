"use strict";

(() => {
  const byId = (id) => document.getElementById(id);
  const plannerView = byId("plannerView"), agentView = byId("agentView");
  const api = window.desktopAPI?.agent;
  const MODEL_PREFERENCE_KEY = "p2at.agent.preferred-model";
  const CONVERSATION_KEY = "p2at.agent.conversation.v1";
  let configured = false, running = false, conversationId = 0, configRevision = 0;
  let timeline = [], connectedBaseUrl = null;

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
  function addMessage(role, text, persistent = true) {
    const list = byId("agentMessages");
    list.querySelector(".agent-empty")?.remove();
    const item = document.createElement("div"); item.className = `agent-message ${role}`; item.textContent = text; list.append(item); list.scrollTop = list.scrollHeight;
    const entry = { kind: "message", role, text, persistent }; timeline.push(entry); return entry;
  }
  function formatDuration(ms) { const seconds = Math.max(0, Math.floor(ms / 1000)); return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`; }
  function addActivity({ durationMs = 0, steps = [], state = "done", persistent = true } = {}) {
    const element = document.createElement("div");
    const head = document.createElement("div"); head.className = "agent-activity-head"; element.append(head);
    const body = document.createElement("div"); body.className = "agent-activity-steps"; element.append(body);
    const entry = { kind: "activity", durationMs, steps: [...steps], state, persistent }; timeline.push(entry);
    const render = () => {
      head.textContent = `${entry.state === "error" ? "处理失败，用时" : "已处理"} ${formatDuration(entry.durationMs)}`;
      body.replaceChildren(...entry.steps.map((text) => Object.assign(document.createElement("div"), { className: "agent-activity-step", textContent: text })));
      element.className = `agent-activity ${entry.state}`;
    };
    render(); byId("agentMessages").append(element); return { entry, render };
  }
  function saveConversation() {
    try { localStorage.setItem(CONVERSATION_KEY, JSON.stringify({ version: 1, baseUrl: connectedBaseUrl, timeline: timeline.filter((item) => item.persistent).slice(-120) })); } catch {}
  }
  async function restoreConversation() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(CONVERSATION_KEY) || "null"); } catch { saved = null; }
    if (saved?.version !== 1 || typeof saved.baseUrl !== "string" || !Array.isArray(saved.timeline) || !api) return;
    const status = await api.getStatus(); connectedBaseUrl = status.baseUrl || connectedBaseUrl;
    if (!status.configured || saved.baseUrl !== status.baseUrl) return;
    const rows = saved.timeline.slice(-120), restored = [], history = [];
    let valid = rows.length > 0 && rows.length % 3 === 0;
    for (let index = 0; valid && index < rows.length; index += 3) {
      const user = rows[index], activity = rows[index + 1], assistant = rows[index + 2];
      const duration = Number(activity?.durationMs);
      const steps = activity?.steps;
      valid = user?.kind === "message" && user.role === "user" && typeof user.text === "string" && user.text.length > 0 && user.text.length <= 12000
        && activity?.kind === "activity" && activity.state === "done" && Number.isFinite(duration) && duration >= 0 && duration <= 86400000
        && Array.isArray(steps) && steps.length > 0 && steps.length <= 20 && steps.every((step) => typeof step === "string" && step.length > 0 && step.length <= 500)
        && assistant?.kind === "message" && assistant.role === "assistant" && typeof assistant.text === "string" && assistant.text.length > 0 && assistant.text.length <= 32000;
      if (valid) { restored.push(user, { ...activity, durationMs: duration, steps: [...steps] }, assistant); history.push({ role: "user", content: user.text }, { role: "assistant", content: assistant.text }); }
    }
    const result = valid ? await api.restoreConversation(history) : { ok: false };
    if (!result.ok) { try { localStorage.removeItem(CONVERSATION_KEY); } catch {} return; }
    byId("agentMessages").replaceChildren(); timeline = [];
    for (const item of restored) {
      if (item.kind === "message") addMessage(item.role, item.text);
      else addActivity({ durationMs: item.durationMs, steps: item.steps, state: "done" });
    }
    byId("agentMessages").scrollTop = byId("agentMessages").scrollHeight;
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
    connectedBaseUrl = status.baseUrl || null;
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
    timeline = []; byId("agentMessages").replaceChildren(Object.assign(document.createElement("div"), { className: "agent-empty", textContent: "切换服务后将开始独立会话。" }));
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
    configured = true; connectedBaseUrl = result.baseUrl; conversationId += 1; byId("agentChatTarget").textContent = `目标服务：${result.targetHost}`; setStatus(`已连接：${result.targetHost}（Key 已安全缓存到本机）`, "connected"); updateControls();
    await restoreConversation();
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
      if (!result.ok) {
        resetModelOptions("获取失败，请重试");
        setModelStatus(`模型列表获取失败：${result.error.message}；可重试，手动填写仅作为临时兜底`, "error");
        byId("agentView").querySelector(".agent-settings").open = true;
        return;
      }
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
    if (clearUi) {
      timeline = []; try { localStorage.removeItem(CONVERSATION_KEY); } catch {}
      byId("agentMessages").replaceChildren(Object.assign(document.createElement("div"), { className: "agent-empty", textContent: "新会话已建立。" }));
    }
  }
  byId("agentNewChat").addEventListener("click", () => newConversation(true));
  byId("agentStop").addEventListener("click", () => api?.cancel());
  byId("agentComposer").addEventListener("submit", async (event) => {
    event.preventDefault(); if (!configured || running) return;
    const input = byId("agentInput"), text = input.value.trim(), model = byId("agentModel").value.trim();
    if (!text) return;
    if (!model) {
      addMessage("error", "尚未选择模型。请展开左侧“模型与连接设置”后选择模型，或等待模型列表自动加载。", false);
      byId("agentView").querySelector(".agent-settings").open = true;
      return;
    }
    rememberModel(model);
    const requestConversation = conversationId; const userEntry = addMessage("user", text, false); input.value = ""; running = true; updateControls(); showTrace([]);
    const startedAt = Date.now();
    const activity = addActivity({ steps: [`已发送到 ${model}`, "正在等待模型回复…"], state: "running", persistent: false });
    const timer = setInterval(() => { activity.entry.durationMs = Date.now() - startedAt; activity.render(); }, 1000);
    let result;
    try {
      result = await api.send({ model, text, toolsEnabled: byId("agentToolsEnabled").checked });
    } catch {
      result = { ok: false, error: { message: "桌面与智能体通信失败，请重试；若持续失败请重新启动应用" } };
    }
    clearInterval(timer); activity.entry.durationMs = Date.now() - startedAt; running = false; updateControls();
    if (requestConversation !== conversationId || result.stale) return;
    if (!result.ok) {
      activity.entry.state = "error"; activity.entry.steps[activity.entry.steps.length - 1] = `失败：${result.error.message}`; activity.render();
      addMessage("error", result.error.message, false); return;
    }
    activity.entry.state = "done";
    activity.entry.steps = [`已发送到 ${model}`, ...(result.trace || []).map((item) => `${item.ok ? "已完成" : "工具失败"}：${item.name}`), "已收到模型回复"];
    activity.entry.persistent = true; userEntry.persistent = true; activity.render();
    showTrace(result.trace); addMessage("assistant", result.text || "（模型未返回文本）"); saveConversation();
  });
  byId("agentInput").addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); byId("agentComposer").requestSubmit(); } });
  restoreConversation().catch(() => {}).finally(() => refreshStatus().catch(() => setStatus("无法读取连接状态", "error")));
})();
