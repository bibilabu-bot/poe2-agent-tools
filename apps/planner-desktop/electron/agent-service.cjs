"use strict";

const { PythonAgentClient, PythonAgentError } = require("./python-agent-client.cjs");
const RUN_TIMEOUT_MS = 120_000;

function safeError(error) {
  const known = error instanceof PythonAgentError || ["SECURE_STORAGE_UNAVAILABLE", "CREDENTIAL_CACHE_INVALID"].includes(error?.code);
  return { code: known ? error.code : "AGENT_FAILED", message: known ? error.message : "智能体运行失败" };
}

class AgentService {
  constructor({ client = new PythonAgentClient(), modelLister = null, runTimeoutMs = RUN_TIMEOUT_MS } = {}) {
    this.client = client; this.modelLister = modelLister; this.runTimeoutMs = runTimeoutMs; this.config = null; this.history = []; this.active = null; this.generation = 0; this.credentialStored = false;
  }
  status() {
    return { configured: Boolean(this.config), baseUrl: this.config?.baseUrl || null, targetHost: this.config ? new URL(this.config.baseUrl).host : null, running: Boolean(this.active), credentialStored: this.credentialStored };
  }
  setCredentialStored(value) { this.credentialStored = Boolean(value); return this.status(); }
  async configure({ baseUrl, apiKey }) {
    await this.clearConfig();
    const result = await this.client.request("configure", { baseUrl, apiKey });
    this.config = { baseUrl: result.baseUrl, apiKey }; this.history = []; this.generation += 1;
    return this.status();
  }
  async clearConfig() {
    this.cancel();
    if (this.config) await this.client.request("clear").catch(() => {});
    if (this.config) this.config.apiKey = "";
    this.config = null; this.history = []; this.credentialStored = false; this.generation += 1;
    return this.status();
  }
  async reset() {
    this.cancel();
    this.history = [];
    if (this.config) { await this.#ensureConfigured(); await this.client.request("reset"); }
    this.generation += 1; return { ok: true };
  }
  async restoreConversation(messages) {
    if (this.active) return { ok: false, error: { code: "RUN_IN_PROGRESS", message: "当前会话已有请求正在运行" } };
    if (!Array.isArray(messages) || messages.length > 60) throw new PythonAgentError("INVALID_HISTORY", "本地会话记录无效");
    let size = 0;
    if (messages.length % 2 !== 0) throw new PythonAgentError("INVALID_HISTORY", "本地会话包含未完成轮次");
    const history = messages.map((message, index) => {
      if (!message || !["user", "assistant"].includes(message.role) || typeof message.content !== "string") throw new PythonAgentError("INVALID_HISTORY", "本地会话记录无效");
      const expectedRole = index % 2 === 0 ? "user" : "assistant";
      if (message.role !== expectedRole) throw new PythonAgentError("INVALID_HISTORY", "本地会话轮次顺序无效");
      size += message.content.length;
      const roleLimit = message.role === "user" ? 12000 : 32000;
      if (!message.content || message.content.length > roleLimit || size > 256000) throw new PythonAgentError("INVALID_HISTORY", "本地会话记录过大");
      return { role: message.role, content: message.content };
    });
    if (this.config && history.length) { await this.#ensureConfigured(); await this.client.request("restore", { history }); }
    this.history = structuredClone(history);
    return { ok: true, messages: history.length };
  }
  cancel() {
    if (!this.active) return;
    this.active.controller?.abort(new PythonAgentError("CANCELLED", "已停止本次请求"));
    this.client.terminate(new PythonAgentError("CANCELLED", "已停止本次回复")); this.active = null;
  }
  async models() {
    if (this.active) return { ok: false, error: { code: "MODELS_IN_PROGRESS", message: "智能体当前已有请求正在运行" }, ...this.status() };
    const generation = this.generation;
    const controller = new AbortController();
    const operationToken = { kind: "models", controller }; this.active = operationToken;
    try {
      if (!this.config) throw new PythonAgentError("NOT_CONFIGURED", "请先连接 API 服务");
      const models = this.modelLister
        ? await this.modelLister({ ...this.config, signal: controller.signal })
        : (await (async () => { await this.#ensureConfigured(); return this.client.request("models"); })()).models;
      if (generation !== this.generation) return { ok: false, stale: true, error: { code: "STALE_MODELS", message: "连接配置已变化，已忽略旧模型列表" }, ...this.status() };
      return { ok: true, models, ...this.status() };
    }
    catch (error) { return { ok: false, error: safeError(error), ...this.status() }; }
    finally { if (this.active === operationToken) this.active = null; }
  }
  async send(value) {
    if (this.active) return { ok: false, error: { code: "RUN_IN_PROGRESS", message: "当前会话已有回复正在运行" } };
    const generation = this.generation; const runToken = {}; this.active = runToken;
    const timeout = setTimeout(() => this.client.terminate(new PythonAgentError("RUN_TIMEOUT", "智能体运行超时，已停止")), this.runTimeoutMs);
    try {
      await this.#ensureConfigured();
      const result = await this.client.request("send", value || {});
      if (generation !== this.generation) return { ok: false, stale: true, error: { code: "STALE_RUN", message: "会话已变化，已忽略迟到响应" } };
      this.history = Array.isArray(result.history) ? structuredClone(result.history) : this.history;
      return { ok: true, text: result.text, trace: result.trace, context: result.context, stopReason: null };
    } catch (error) { return { ok: false, error: safeError(error) }; }
    finally { clearTimeout(timeout); if (this.active === runToken) this.active = null; }
  }
  async #ensureConfigured() {
    if (!this.config) throw new PythonAgentError("NOT_CONFIGURED", "请先连接 API 服务");
    try { const status = await this.client.request("status"); if (status.configured) return; } catch (error) { if (error.code !== "PYTHON_RUNTIME_EXITED") throw error; }
    await this.client.request("configure", this.config);
    if (this.history.length) await this.client.request("restore", { history: this.history });
  }
}

function validateConfigure(value) {
  if (!value || typeof value.baseUrl !== "string" || typeof value.apiKey !== "string") throw new PythonAgentError("INVALID_REQUEST", "连接参数无效");
  if (value.baseUrl.length > 2048 || value.apiKey.length > 4096) throw new PythonAgentError("INVALID_REQUEST", "连接参数过长");
  return value;
}

function createAgentIpcHandlers(service, isTrustedSender, credentialStore = null) {
  const guard = (event) => { if (!isTrustedSender(event)) throw new PythonAgentError("UNTRUSTED_SENDER", "请求来源不受信任"); };
  let credentialMutation = Promise.resolve();
  const mutate = (operation) => { const result = credentialMutation.then(operation, operation); credentialMutation = result.catch(() => {}); return result; };
  return {
    status: async (event) => { guard(event); return service.status(); },
    configure: async (event, value) => { guard(event); return mutate(async () => { try { const config = validateConfigure(value); await service.configure(config); if (credentialStore) { await credentialStore.save(config); service.setCredentialStored(true); } return { ok: true, ...service.status() }; } catch (error) { await service.clearConfig(); return { ok: false, error: safeError(error), ...service.status() }; } }); },
    clear: async (event) => { guard(event); return mutate(async () => { await service.clearConfig(); try { if (credentialStore) await credentialStore.clear(); return { ok: true, ...service.status() }; } catch (error) { service.setCredentialStored(true); return { ok: false, error: safeError(error), ...service.status() }; } }); },
    models: async (event) => { guard(event); return service.models(); }, send: async (event, value) => { guard(event); return service.send(value || {}); },
    cancel: async (event) => { guard(event); service.cancel(); return { ok: true }; }, reset: async (event) => { guard(event); return service.reset(); },
    restore: async (event, value) => { guard(event); try { return await service.restoreConversation(value?.messages); } catch (error) { return { ok: false, error: safeError(error) }; } },
  };
}

module.exports = { AgentService, createAgentIpcHandlers, safeError, RUN_TIMEOUT_MS };
