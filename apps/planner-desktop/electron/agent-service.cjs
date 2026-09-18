"use strict";

const { AgentRunner, AgentRunError } = require("../src/agent-core/agent-runner.js");
const { ChatAgent } = require("../src/agent-core/base-agent.js");
const { ToolRegistry } = require("../src/agent-core/tool-registry.js");
const { CalculatorTool } = require("../src/agent-core/calculator-tool.js");
const { OpenAICompatibleProvider, ProviderError, normalizeBaseUrl } = require("./openai-compatible-provider.cjs");

const MAX_INPUT_CHARS = 12_000;
const MAX_HISTORY_MESSAGES = 60;
const MAX_HISTORY_CHARS = 256_000;
const RUN_TIMEOUT_MS = 120_000;

function safeError(error) {
  if (error?.name === "AbortError" || error?.code === "ABORT_ERR") return { code: "CANCELLED", message: "已停止本次回复" };
  const known = error instanceof ProviderError || error instanceof AgentRunError;
  return { code: known ? error.code : "AGENT_FAILED", message: known ? error.message : "智能体运行失败" };
}

class AgentService {
  constructor({ fetch }) {
    this.fetch = fetch;
    this.provider = null;
    this.baseUrl = null;
    this.history = [];
    this.generation = 0;
    this.active = null;
    this.modelRequest = null;
  }

  status() { return { configured: Boolean(this.provider), targetHost: this.baseUrl?.host || null, running: Boolean(this.active) }; }

  configure({ baseUrl, apiKey }) {
    this.cancel();
    this.provider?.clearSecret();
    this.provider = null;
    this.baseUrl = null;
    this.history = [];
    this.generation += 1;
    const normalized = normalizeBaseUrl(baseUrl);
    const provider = new OpenAICompatibleProvider({ baseUrl: normalized.href, apiKey, fetch: this.fetch });
    this.provider = provider;
    this.baseUrl = normalized;
    return this.status();
  }

  clearConfig() {
    this.cancel();
    this.provider?.clearSecret();
    this.provider = null;
    this.baseUrl = null;
    this.history = [];
    this.generation += 1;
    return this.status();
  }

  reset() { this.cancel(); this.history = []; this.generation += 1; return { ok: true }; }
  cancel() {
    if (this.active) this.active.abort(new DOMException("Cancelled", "AbortError"));
    if (this.modelRequest) this.modelRequest.abort(new DOMException("Cancelled", "AbortError"));
  }

  requireProvider() { if (!this.provider) throw new ProviderError("NOT_CONFIGURED", "请先连接 API 服务"); return this.provider; }

  async models() {
    if (this.modelRequest) return { ok: false, error: { code: "MODELS_IN_PROGRESS", message: "模型列表正在获取" }, ...this.status() };
    const controller = new AbortController();
    const generation = this.generation;
    this.modelRequest = controller;
    try {
      const models = await this.requireProvider().listModels({ signal: controller.signal });
      if (generation !== this.generation) return { ok: false, stale: true, error: { code: "STALE_MODELS", message: "连接已变化，已忽略旧模型列表" }, ...this.status() };
      return { ok: true, models, ...this.status() };
    }
    catch (error) { return { ok: false, error: safeError(error), ...this.status() }; }
    finally { if (this.modelRequest === controller) this.modelRequest = null; }
  }

  async send({ model, text, toolsEnabled }) {
    if (this.active) return { ok: false, error: safeError(new AgentRunError("RUN_IN_PROGRESS", "当前会话已有回复正在运行")) };
    if (typeof model !== "string" || !model.trim() || model.length > 256) return { ok: false, error: { code: "INVALID_MODEL", message: "模型 ID 无效" } };
    if (typeof text !== "string" || !text.trim() || text.length > MAX_INPUT_CHARS) return { ok: false, error: { code: "INVALID_INPUT", message: `消息需为 1–${MAX_INPUT_CHARS} 个字符` } };
    let provider;
    try { provider = this.requireProvider(); } catch (error) { return { ok: false, error: safeError(error) }; }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new ProviderError("RUN_TIMEOUT", "智能体运行超过 120 秒，已停止")), RUN_TIMEOUT_MS);
    this.active = controller;
    const runGeneration = this.generation;
    const userMessage = { role: "user", content: text.trim() };
    try {
      const candidateHistory = trimHistory([...this.history, userMessage]);
      const runner = new AgentRunner({ provider, registry: new ToolRegistry([new CalculatorTool()]) });
      const result = await runner.run({ agent: new ChatAgent(), history: candidateHistory, model: model.trim(), toolsEnabled: Boolean(toolsEnabled), signal: controller.signal });
      if (runGeneration !== this.generation) return { ok: false, stale: true, error: { code: "STALE_RUN", message: "会话已变化，已忽略迟到响应" } };
      this.history = trimHistory(result.messages.filter((message) => message.role !== "system"));
      return { ok: true, text: result.text, trace: result.trace, stopReason: null };
    } catch (error) {
      return { ok: false, error: safeError(controller.signal.aborted ? controller.signal.reason || error : error) };
    } finally {
      clearTimeout(timeout);
      if (this.active === controller) this.active = null;
    }
  }
}

function trimHistory(messages) {
  const turns = [];
  for (const message of messages) {
    if (message?.role === "user" || turns.length === 0) turns.push([]);
    turns.at(-1).push(structuredClone(message));
  }
  const kept = [];
  let count = 0;
  let chars = 0;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    const turnChars = JSON.stringify(turn).length;
    if (kept.length && (count + turn.length > MAX_HISTORY_MESSAGES || chars + turnChars > MAX_HISTORY_CHARS)) break;
    if (!kept.length && (turn.length > MAX_HISTORY_MESSAGES || turnChars > MAX_HISTORY_CHARS)) throw new AgentRunError("HISTORY_LIMIT", "The latest conversation turn exceeded the safe history limit");
    kept.unshift(turn); count += turn.length; chars += turnChars;
  }
  return kept.flat();
}

function validateConfigure(value) {
  if (!value || typeof value !== "object" || typeof value.baseUrl !== "string" || typeof value.apiKey !== "string") throw new ProviderError("INVALID_REQUEST", "连接参数无效");
  if (value.baseUrl.length > 2048 || value.apiKey.length > 4096) throw new ProviderError("INVALID_REQUEST", "连接参数过长");
  return value;
}

function createAgentIpcHandlers(service, isTrustedSender) {
  const guard = (event) => { if (!isTrustedSender(event)) throw new ProviderError("UNTRUSTED_SENDER", "请求来源不受信任"); };
  return {
    status: async (event) => { guard(event); return service.status(); },
    configure: async (event, value) => { guard(event); try { return { ok: true, ...service.configure(validateConfigure(value)) }; } catch (error) { return { ok: false, error: safeError(error), ...service.status() }; } },
    clear: async (event) => { guard(event); return { ok: true, ...service.clearConfig() }; },
    models: async (event) => { guard(event); return service.models(); },
    send: async (event, value) => { guard(event); return service.send(value || {}); },
    cancel: async (event) => { guard(event); service.cancel(); return { ok: true }; },
    reset: async (event) => { guard(event); return service.reset(); },
  };
}

module.exports = { AgentService, createAgentIpcHandlers, safeError, trimHistory, MAX_INPUT_CHARS, MAX_HISTORY_CHARS, RUN_TIMEOUT_MS };
