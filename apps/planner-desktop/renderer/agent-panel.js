"use strict";

(() => {
  const byId = (id) => document.getElementById(id);
  const plannerView = byId("plannerView"), agentView = byId("agentView");
  const settingsView = byId("settingsView");
  const chatSettings = agentView.querySelector(".agent-settings");
  byId("chatSettingsHost").append(chatSettings);
  chatSettings.open = true;
  chatSettings.querySelector("summary").textContent = "聊天模型与连接";
  const api = window.desktopAPI?.agent;
  const MODEL_PREFERENCE_KEY = "p2at.agent.preferred-model";
  const CONVERSATION_KEY = "p2at.agent.conversation.v1";
  let configured = false, running = false, conversationId = 0, configRevision = 0;
  let timeline = [], connectedBaseUrl = null;
  let selectedSession = null, historyBefore = null, sessionBusy = false;
  let sessionReady = !api?.listSessions;
  let sessionRows = [];
  function sessionHint(text) { byId("sessionHint").textContent = text; }
  function clearSessionDisplay() {
    sessionReady=false; historyBefore=null; timeline=[];
    byId("agentOlderHistory").hidden=true;
    byId("agentMessages").replaceChildren(Object.assign(document.createElement("div"),{className:"agent-empty",textContent:"正在读取所选会话…"}));
  }
  function sessionLoadFailed(error) {
    sessionReady=false; sessionHint(error.message); byId("sessionRetry").hidden=false;
    byId("agentMessages").replaceChildren(Object.assign(document.createElement("div"),{className:"agent-empty",textContent:"会话读取失败。为避免串线，已暂停发送；请重新读取会话。"}));
  }
  function renderSessions() {
    byId("sessionList").replaceChildren(...sessionRows.map(row => {
      const button = document.createElement("button"); button.textContent = row.title || "新会话";
      button.title = row.title || "新会话"; button.classList.toggle("active", row.id === selectedSession);
      if (row.id === selectedSession) button.setAttribute("aria-current", "true");
      button.disabled = running || sessionBusy;
      button.addEventListener("click", () => changeSession(row.id)); return button;
    }));
  }
  async function loadSessionHistory(older = false) {
    const id = selectedSession;
    const result = await api.sessionHistory(id, older ? historyBefore : null);
    if (id !== selectedSession) return;
    if (!result.ok) throw new Error(result.error?.message || "会话读取失败");
    const list = byId("agentMessages"), oldNodes = older ? [...list.childNodes] : [];
    const oldHeight = list.scrollHeight, oldTop = list.scrollTop;
    list.replaceChildren(); if (!older) timeline = [];
    for (const turn of result.turns) {
      addMessage("user", turn.user);
      if (turn.details) addActivity({ durationMs: turn.details.durationMs || 0, trace: turn.details.trace,
        steps: ["已完成回复"], state: "done" });
      addMessage("assistant", turn.assistant);
    }
    if (older) list.append(...oldNodes);
    if (!list.childNodes.length) list.append(Object.assign(document.createElement("div"), {className:"agent-empty",textContent:"这是一个独立的新会话。输入消息开始。"}));
    historyBefore = result.before; byId("agentOlderHistory").hidden = !historyBefore;
    sessionReady=true; byId("sessionRetry").hidden=true;
    if (older) { if (scrollFrame !== null) cancelAnimationFrame(scrollFrame); scrollFrame=null; list.scrollTop=oldTop+list.scrollHeight-oldHeight; }
  }
  async function refreshSessions() {
    const result = await api.listSessions();
    if (!result.ok) throw new Error(result.error?.message || "会话列表读取失败");
    selectedSession = result.selectedId; sessionRows = result.sessions; renderSessions();
    sessionHint(running ? "请先停止回复，再切换会话。" : "仅显示当前服务的本地会话。");
  }
  async function changeSession(id) {
    if (running || sessionBusy) { sessionHint("请先停止回复，再切换会话。"); return; }
    sessionBusy = true; clearSessionDisplay(); updateControls();
    try {
      const result = await api.selectSession(id); if (!result.ok) throw new Error(result.error?.message || "切换失败");
      conversationId += 1; selectedSession = id; clearSessionDisplay(); byId("agentInput").value = ""; showTrace([]);
      await refreshSessions(); await loadSessionHistory();
    } catch(error) { sessionLoadFailed(error); }
    finally { sessionBusy = false; updateControls(); }
  }
  byId("sessionToggle").addEventListener("click", () => {
    const open = byId("sessionOverview").hidden;
    byId("sessionOverview").hidden = !open; byId("sessionToggle").setAttribute("aria-expanded", String(open));
    agentView.querySelector(".agent-layout").classList.toggle("sessions-collapsed", !open);
  });
  if (window.innerWidth <= 700) byId("sessionToggle").click();
  byId("agentOlderHistory").addEventListener("click", async () => {
    if (running || sessionBusy) return;
    sessionBusy = true; updateControls();
    try { await loadSessionHistory(true); } catch(error) { sessionHint(error.message); }
    finally { sessionBusy=false; updateControls(); }
  });
  byId("sessionRetry").addEventListener("click", () => { if (!running && !sessionBusy) restoreConversation(); });
  let scrollFrame = null;
  function scrollToLatest() {
    if (scrollFrame !== null) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = null;
      const list = byId("agentMessages");
      list.scrollTop = list.scrollHeight;
    });
  }

  function preferredModel() { try { return localStorage.getItem(MODEL_PREFERENCE_KEY) || ""; } catch { return ""; } }
  function rememberModel(model) { try { if (model) localStorage.setItem(MODEL_PREFERENCE_KEY, model); } catch {} }

  function switchView(page) {
    agentView.hidden = page !== "agent";
    plannerView.hidden = page !== "planner";
    settingsView.hidden = page !== "settings";
    if (page === "agent") scrollToLatest();
    if (page === "planner") requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  }
  byId("switchToAgent").addEventListener("click", () => switchView("agent"));
  byId("switchToPlanner").addEventListener("click", () => switchView("planner"));
  document.querySelectorAll("[data-page]").forEach(button => button.addEventListener("click", () => switchView(button.dataset.page)));

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
    byId("agentInput").disabled = !configured || running || sessionBusy || !sessionReady;
    byId("agentSend").disabled = !configured || running || sessionBusy || !sessionReady;
    byId("agentNewChat").disabled = !configured || running || sessionBusy;
    byId("agentOlderHistory").disabled = running || sessionBusy;
    renderSessions();
    if (running) sessionHint("请先停止回复，再切换会话。");
    byId("agentStop").disabled = !running;
    for (const id of ["agentBaseUrl", "agentApiKey", "agentConnect", "agentClearConfig", "agentModel"]) byId(id).disabled = running || sessionBusy;
    byId("agentRunState").textContent = running ? "正在运行…" : "空闲";
  }
  function addMessage(role, text, persistent = true) {
    const list = byId("agentMessages");
    list.querySelector(".agent-empty")?.remove();
    const item = document.createElement("div"); item.className = `agent-message ${role}`; item.textContent = text; list.append(item); scrollToLatest();
    const entry = { kind: "message", role, text, persistent }; timeline.push(entry); return entry;
  }
  function addStreamingMessage() {
    const list = byId("agentMessages");
    list.querySelector(".agent-empty")?.remove();
    const item = document.createElement("div"); item.className = "agent-message assistant streaming";
    item.textContent = ""; item.hidden = true; list.append(item);
    return item;
  }
  function formatDuration(ms) { const seconds = Math.max(0, Math.floor(ms / 1000)); return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`; }
  function addActivity({ durationMs = 0, steps = [], trace = [], state = "done", persistent = true } = {}) {
    const element = document.createElement("div");
    const head = document.createElement("div"); head.className = "agent-activity-head"; element.append(head);
    const body = document.createElement("div"); body.className = "agent-activity-steps"; element.append(body);
    const operations = document.createElement("div"); element.append(operations);
    const entry = { kind: "activity", durationMs, steps: [...steps], trace: window.AgentTrace.normalizeTrace(trace), state, persistent }; timeline.push(entry);
    let renderedTrace = null;
    let renderedProgress = null;
    const render = () => {
      const progress = JSON.stringify([entry.state, entry.steps]);
      // Follow new content after layout, not elapsed-time ticks or detail toggles.
      if (renderedTrace !== entry.trace || renderedProgress !== progress) scrollToLatest();
      renderedProgress = progress;
      head.textContent = `${entry.state === "error" ? "处理失败，用时" : "已处理"} ${formatDuration(entry.durationMs)}`;
      // Completed operations already have their own expandable rows. Keep transient
      // waiting/failure messages, without repeating the completed step checklist.
      body.hidden = entry.state === "done";
      body.replaceChildren(...(body.hidden ? [] : entry.steps).map((text) => Object.assign(document.createElement("div"), { className: "agent-activity-step", textContent: text })));
      element.className = `agent-activity ${entry.state}`;
      if (renderedTrace !== entry.trace) {
        operations.replaceChildren(...window.AgentTrace.renderTrace(document, entry.trace));
        renderedTrace = entry.trace;
      }
    };
    render(); byId("agentMessages").append(element); return { entry, render };
  }
  function saveConversation() {
    if (api?.listSessions) {
      sessionBusy=true; updateControls();
      refreshSessions().catch(error => sessionHint(error.message)).finally(() => { sessionBusy=false; updateControls(); });
      return;
    }
    const rows = timeline.filter((item) => item.persistent).slice(-90);
    while (rows.length) {
      const serialized = JSON.stringify({ version: 1, baseUrl: connectedBaseUrl, timeline: rows });
      if (serialized.length > 1500000 && rows.length > 3) { rows.splice(0, 3); continue; }
      try { localStorage.setItem(CONVERSATION_KEY, serialized); return; }
      catch (error) {
        if (error.name === "QuotaExceededError" && rows.length > 3) { rows.splice(0, 3); continue; }
        setStatus("本地界面记录保存失败；完整成功对话仍保存在智能体数据库中", "error"); return;
      }
    }
  }
  async function restoreConversation() {
    if (api?.listSessions) {
      const status=await api.getStatus(); if (!status.configured) return;
      sessionBusy=true; clearSessionDisplay(); updateControls();
      try {
        await refreshSessions();
        const page=await api.sessionHistory(selectedSession);
        if (!page.ok) throw new Error(page.error?.message || "会话读取失败");
        // Only an untouched initial archive can receive the old display-cache import.
        if (sessionRows.length===1 && !page.turns.length) await restoreLegacyConversation();
        await refreshSessions(); await loadSessionHistory();
      } catch(error) { sessionLoadFailed(error); }
      finally { sessionBusy=false; updateControls(); }
      return;
    }
    return restoreLegacyConversation();
  }
  async function restoreLegacyConversation() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(CONVERSATION_KEY) || "null"); } catch { saved = null; }
    if (saved?.version !== 1 || typeof saved.baseUrl !== "string" || !Array.isArray(saved.timeline) || !api) return;
    const status = await api.getStatus(); connectedBaseUrl = status.baseUrl || connectedBaseUrl;
    if (!status.configured || saved.baseUrl !== status.baseUrl) return;
    const rows = saved.timeline.slice(-90), restored = [], history = [];
    let valid = rows.length > 0 && rows.length % 3 === 0;
    for (let index = 0; valid && index < rows.length; index += 3) {
      const user = rows[index], activity = rows[index + 1], assistant = rows[index + 2];
      const duration = Number(activity?.durationMs);
      const steps = activity?.steps;
      valid = user?.kind === "message" && user.role === "user" && typeof user.text === "string" && user.text.length > 0 && user.text.length <= 12000
        && activity?.kind === "activity" && activity.state === "done" && Number.isFinite(duration) && duration >= 0 && duration <= 86400000
        && Array.isArray(steps) && steps.length > 0 && steps.length <= 20 && steps.every((step) => typeof step === "string" && step.length > 0 && step.length <= 500)
        && assistant?.kind === "message" && assistant.role === "assistant" && typeof assistant.text === "string" && assistant.text.length > 0 && assistant.text.length <= 32000;
      if (valid) { restored.push(user, { ...activity, durationMs: duration, steps: [...steps], trace: window.AgentTrace.normalizeTrace(activity.trace) }, assistant); history.push({ role: "user", content: user.text }, { role: "assistant", content: assistant.text }); }
    }
    const result = valid ? await api.restoreConversation(history) : { ok: false };
    if (!result.ok) { sessionHint("旧界面记录未导入，原记录已保留。"); return; }
    byId("agentMessages").replaceChildren(); timeline = [];
    for (const item of restored) {
      if (item.kind === "message") addMessage(item.role, item.text);
      else addActivity({ durationMs: item.durationMs, steps: item.steps, trace: item.trace, state: "done" });
    }
    scrollToLatest();
  }
  function showTrace(trace) {
    const log = byId("agentToolLog");
    if (!trace?.length) { log.hidden = true; log.textContent = ""; return; }
    // Details now belong to their historical turn, not an unbounded global dump.
    log.hidden = true; log.textContent = "";
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
    selectedSession=null; sessionRows=[]; renderSessions(); byId("agentOlderHistory").hidden=true;
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
    selectedSession=null; sessionRows=[]; renderSessions(); timeline=[]; byId("agentMessages").replaceChildren(); byId("agentOlderHistory").hidden=true;
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
        chatSettings.open = true; switchView("settings");
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
    if (running || sessionBusy) { sessionHint("请先停止回复，再新建会话。"); return; }
    if (api?.listSessions && clearUi) {
      sessionBusy=true; updateControls();
      try {
        const result=await api.reset(); if (!result.ok) throw new Error(result.error?.message || "新建失败");
        conversationId+=1; clearSessionDisplay(); byId("agentInput").value=""; showTrace([]);
        await refreshSessions(); await loadSessionHistory();
      } catch(error) { if (!sessionReady) sessionLoadFailed(error); else sessionHint(error.message); }
      finally { sessionBusy=false; updateControls(); }
      return;
    }
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
    event.preventDefault(); if (!configured || running || sessionBusy || !sessionReady) return;
    const input = byId("agentInput"), text = input.value.trim(), model = byId("agentModel").value.trim();
    if (!text) return;
    if (!model) {
      addMessage("error", "尚未选择模型。请到“设置”页选择聊天模型，或等待模型列表自动加载。", false);
      chatSettings.open = true; switchView("settings");
      return;
    }
    rememberModel(model);
    const requestConversation = conversationId; const userEntry = addMessage("user", text, false); input.value = ""; running = true; updateControls(); showTrace([]);
    const startedAt = Date.now();
    const activity = addActivity({ steps: [`已发送到 ${model}`, "正在等待模型回复…"], state: "running", persistent: false });
    const streamingMessage = addStreamingMessage();
    let streamedText = "", lastSequence = 0;
    const phaseText = {
      preparing_context: "正在准备会话上下文…",
      waiting_for_model: "正在接收模型流式回复…",
    };
    const unsubscribe = api.onRunEvent?.((progress) => {
      if (requestConversation !== conversationId || !running || !Number.isInteger(progress?.seq) || progress.seq <= lastSequence) return;
      lastSequence = progress.seq;
      if (progress.type === "text_delta" && typeof progress.text === "string") {
        streamedText = (streamedText + progress.text).slice(0, 32000);
        streamingMessage.textContent = streamedText; streamingMessage.hidden = !streamedText; scrollToLatest();
      } else if (progress.type === "phase" && phaseText[progress.phase]) {
        activity.entry.steps[activity.entry.steps.length - 1] = phaseText[progress.phase]; activity.render();
      } else if (progress.type === "tool_started" && typeof progress.name === "string") {
        activity.entry.steps[activity.entry.steps.length - 1] = `正在执行工具：${progress.name}`; activity.render();
      } else if (progress.type === "tool_finished" && typeof progress.name === "string") {
        activity.entry.steps[activity.entry.steps.length - 1] = `${progress.ok ? "已完成" : "工具失败"}：${progress.name}；正在等待模型继续回复…`; activity.render();
      }
    });
    const timer = setInterval(() => { activity.entry.durationMs = Date.now() - startedAt; activity.render(); }, 1000);
    let result;
    try {
      result = await api.send({ model, text, buildState: typeof window !== "undefined" && window.captureBuildState ? window.captureBuildState() : null });
    } catch {
      result = { ok: false, error: { message: "桌面与智能体通信失败，请重试；若持续失败请重新启动应用" } };
    }
    unsubscribe?.(); clearInterval(timer); activity.entry.durationMs = Date.now() - startedAt; running = false; updateControls();
    if (requestConversation !== conversationId || result.stale) return;
    if (!result.ok) {
      streamingMessage.remove();
      activity.entry.state = "error"; activity.entry.steps[activity.entry.steps.length - 1] = `失败：${result.error.message}`; activity.render();
      addMessage("error", result.error.message, false); return;
    }
    activity.entry.state = "done";
    streamingMessage.remove();
    activity.entry.trace = window.AgentTrace.normalizeTrace(result.trace);
    activity.entry.steps = [`已发送到 ${model}`, ...(result.trace || []).map((item) => `${item.ok ? "已完成" : "工具失败"}：${item.name}`), "已收到模型回复"];
    activity.entry.persistent = true; userEntry.persistent = true; activity.render();
    showTrace(result.trace); addMessage("assistant", result.text || "（模型未返回文本）"); saveConversation();
  });
  byId("agentInput").addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); byId("agentComposer").requestSubmit(); } });
  restoreConversation().catch(() => {}).finally(() => refreshStatus().catch(() => setStatus("无法读取连接状态", "error")));
})();
