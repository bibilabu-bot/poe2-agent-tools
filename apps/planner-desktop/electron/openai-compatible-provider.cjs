"use strict";

const { ModelProvider } = require("../src/agent-core/model-provider.js");
const { isIP } = require("node:net");

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 45_000;
const MAX_REQUEST_BYTES = 512 * 1024;

class ProviderError extends Error {
  constructor(code, message, status = null) { super(message); this.name = "ProviderError"; this.code = code; this.status = status; }
}

function normalizeBaseUrl(input) {
  let url;
  try { url = new URL(String(input)); } catch { throw new ProviderError("INVALID_BASE_URL", "API 地址无效"); }
  if (url.username || url.password || url.hash || url.search) throw new ProviderError("INVALID_BASE_URL", "API 地址不能包含账号、密码、查询参数或片段");
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new ProviderError("INVALID_BASE_URL", "仅允许 HTTPS；本机 loopback 服务可使用 HTTP");
  if (!loopback && isPrivateIpLiteral(url.hostname)) throw new ProviderError("INVALID_BASE_URL", "不允许连接私有或链路本地 IP；本机服务请使用 loopback 地址");
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

function isPrivateIpLiteral(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const family = isIP(host);
  if (family === 4) {
    const [a, b] = host.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (family === 6) {
    const mappedV4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
    if (mappedV4) return isPrivateIpLiteral(mappedV4[1]);
    const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
    if (mappedHex) {
      const high = Number.parseInt(mappedHex[1], 16), low = Number.parseInt(mappedHex[2], 16);
      return isPrivateIpLiteral(`${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`);
    }
    return host === "::" || host.startsWith("fc") || host.startsWith("fd") || /^fe[89ab]/.test(host) || host.startsWith("ff");
  }
  return false;
}

function endpoint(baseUrl, suffix) {
  const url = new URL(baseUrl.href);
  url.pathname = `${url.pathname}${suffix}`.replace(/\/{2,}/g, "/");
  return url.href;
}

function combinedSignal(parent, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new ProviderError("TIMEOUT", "服务响应超时")), timeoutMs);
  const abort = () => controller.abort(parent.reason);
  if (parent) {
    if (parent.aborted) abort();
    else parent.addEventListener("abort", abort, { once: true });
  }
  return { signal: controller.signal, dispose: () => { clearTimeout(timer); parent?.removeEventListener("abort", abort); } };
}

async function readJsonBounded(response, maxBytes = MAX_RESPONSE_BYTES, signal) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new ProviderError("RESPONSE_TOO_LARGE", "服务响应过大");
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) throw new ProviderError("RESPONSE_TOO_LARGE", "服务响应过大");
    try { return JSON.parse(text); } catch { throw new ProviderError("INVALID_RESPONSE", "服务返回了无效 JSON"); }
  }
  const reader = response.body.getReader();
  const abort = () => reader.cancel(signal.reason).catch(() => {});
  signal?.addEventListener("abort", abort, { once: true });
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (signal?.aborted) throw signal.reason;
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new ProviderError("RESPONSE_TOO_LARGE", "服务响应过大"); }
      chunks.push(Buffer.from(value));
    }
  } finally { signal?.removeEventListener("abort", abort); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new ProviderError("INVALID_RESPONSE", "服务返回了无效 JSON"); }
}

function publicStatusMessage(status) {
  if (status === 401 || status === 403) return "认证失败，请检查 API Key";
  if (status === 404) return "接口不存在，请检查 API 地址是否包含正确的版本路径（如 /v1）";
  if (status === 429) return "服务限流或额度不足";
  return `服务请求失败（HTTP ${status}）`;
}

class OpenAICompatibleProvider extends ModelProvider {
  constructor({ baseUrl, apiKey, fetch, requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS }) {
    super();
    this.baseUrl = normalizeBaseUrl(baseUrl);
    if (typeof apiKey !== "string" || !apiKey.trim() || apiKey.length > 4096) throw new ProviderError("INVALID_API_KEY", "API Key 无效");
    this.apiKey = apiKey;
    this.fetch = fetch;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  async request(pathname, { method = "GET", body, signal } = {}) {
    const scoped = combinedSignal(signal, this.requestTimeoutMs);
    try {
      const requestBody = body ? JSON.stringify(body) : undefined;
      if (requestBody && Buffer.byteLength(requestBody, "utf8") > MAX_REQUEST_BYTES) throw new ProviderError("REQUEST_TOO_LARGE", "请求上下文超过安全上限，请开始新会话");
      let response;
      try {
        response = await this.fetch(endpoint(this.baseUrl, pathname), {
          method,
          redirect: "manual",
          headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
          body: requestBody,
          signal: scoped.signal,
        });
      } catch (error) {
        if (scoped.signal.aborted) throw scoped.signal.reason || error;
        throw new ProviderError("NETWORK_ERROR", "无法连接目标服务");
      }
      if (response.status >= 300 && response.status < 400) throw new ProviderError("REDIRECT_BLOCKED", "服务返回重定向；为避免密钥泄漏已停止请求", response.status);
      const data = await readJsonBounded(response, MAX_RESPONSE_BYTES, scoped.signal);
      if (!response.ok) {
        const vendorMessage = typeof data?.error?.message === "string" ? data.error.message.slice(0, 500) : "";
        const toolsUnsupported = response.status === 400 && /tool|function/i.test(vendorMessage) && /unsupported|not support|invalid|unknown/i.test(vendorMessage);
        throw new ProviderError(toolsUnsupported ? "TOOLS_UNSUPPORTED" : `HTTP_${response.status}`, toolsUnsupported ? "所选模型或服务不支持工具调用；请关闭演示工具后重试普通聊天" : publicStatusMessage(response.status), response.status);
      }
      return data;
    } finally { scoped.dispose(); }
  }

  async listModels({ signal } = {}) {
    const data = await this.request("/models", { signal });
    if (!Array.isArray(data?.data)) throw new ProviderError("INVALID_RESPONSE", "模型列表格式不兼容，可手动填写模型 ID");
    return data.data.map((item) => item?.id).filter((id) => typeof id === "string" && id.length <= 256).slice(0, 500).sort();
  }

  async complete({ model, messages, tools, signal }) {
    const body = { model, messages, stream: false };
    if (tools.length) { body.tools = tools; body.tool_choice = "auto"; }
    const data = await this.request("/chat/completions", { method: "POST", body, signal });
    const message = data?.choices?.[0]?.message;
    if (!message || typeof message !== "object") throw new ProviderError("INVALID_RESPONSE", "聊天响应格式不兼容");
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls.map((call) => ({
      id: call?.id,
      name: call?.function?.name,
      arguments: call?.function?.arguments,
    })) : [];
    return { content: typeof message.content === "string" ? message.content : "", toolCalls };
  }

  clearSecret() { this.apiKey = ""; }
}

module.exports = { OpenAICompatibleProvider, ProviderError, normalizeBaseUrl, isPrivateIpLiteral, readJsonBounded, MAX_RESPONSE_BYTES, MAX_REQUEST_BYTES };
