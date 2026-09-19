"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { OpenAICompatibleProvider, normalizeBaseUrl, parseJsonOrEventStream } = require("../electron/openai-compatible-provider.cjs");

test("base URL accepts HTTPS and loopback HTTP only", () => {
  assert.equal(normalizeBaseUrl("https://example.com/v1/").href, "https://example.com/v1");
  assert.equal(normalizeBaseUrl("http://127.0.0.1:11434/v1").protocol, "http:");
  for (const url of ["http://example.com/v1", "https://u:p@example.com/v1", "https://example.com/v1?q=key", "https://example.com/v1#x", "https://10.0.0.2/v1", "https://169.254.169.254/v1", "https://[fd00::1]/v1", "https://[::ffff:10.0.0.1]/v1"]) assert.throws(() => normalizeBaseUrl(url));
  assert.throws(() => normalizeBaseUrl("https://dashscope.aliyuncs.com/apps/anthropic"), { code: "PROTOCOL_MISMATCH" });
});

test("models and chat use bounded OpenAI-compatible endpoints and tool call IDs", async () => {
  const seen = [];
  const fetch = async (url, options) => {
    seen.push({ url, options });
    return url.endsWith("/models")
      ? new Response(JSON.stringify({ data: [{ id: "z" }, { id: "a" }] }), { headers: { "content-type": "application/json" } })
      : new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: "call_1", function: { name: "calculator", arguments: "{}" } }] } }] }), { headers: { "content-type": "application/json" } });
  };
  const provider = new OpenAICompatibleProvider({ baseUrl: "https://example.com/v1", apiKey: "secret", fetch });
  assert.deepEqual(await provider.listModels(), ["a", "z"]);
  const result = await provider.complete({ model: "a", messages: [], tools: [{ type: "function" }], signal: undefined });
  assert.equal(result.toolCalls[0].id, "call_1"); assert.equal(seen[0].options.redirect, "manual"); assert.equal(seen[0].options.headers.authorization, "Bearer secret");
});

test("HTTP errors, tool incompatibility, network failures, and redirects are controlled without leaking keys", async () => {
  const cases = [
    [() => new Response(JSON.stringify({ error: { message: "bad key secret-value" } }), { status: 401 }), "HTTP_401", /认证失败/],
    [() => new Response(JSON.stringify({ error: { message: "tools are unsupported" } }), { status: 400 }), "TOOLS_UNSUPPORTED", /不支持工具/],
    [() => new Response("", { status: 302, headers: { location: "https://evil.test" } }), "REDIRECT_BLOCKED", /重定向/],
    [() => { throw new Error("network secret-value"); }, "NETWORK_ERROR", /无法连接/],
  ];
  for (const [fetch, code, message] of cases) {
    const provider = new OpenAICompatibleProvider({ baseUrl: "https://example.com/v1", apiKey: "secret-value", fetch });
    await assert.rejects(() => provider.listModels(), (error) => error.code === code && message.test(error.message) && !error.message.includes("secret-value"));
  }
});

test("abort and timeout cover response body reading", async () => {
  const stream = new ReadableStream({ start() {} });
  const provider = new OpenAICompatibleProvider({ baseUrl: "https://example.com/v1", apiKey: "x", requestTimeoutMs: 10, fetch: async () => new Response(stream) });
  await assert.rejects(() => provider.listModels(), (error) => error.code === "TIMEOUT");
});

test("an empty successful completion is rejected instead of shown as a reply", async () => {
  const provider = new OpenAICompatibleProvider({
    baseUrl: "https://example.com/v1",
    apiKey: "x",
    fetch: async () => new Response(JSON.stringify({ choices: [{ message: { role: "assistant" }, finish_reason: "stop" }] }), { headers: { "content-type": "application/json" } }),
  });
  await assert.rejects(() => provider.complete({ model: "broken", messages: [], tools: [] }), { code: "EMPTY_RESPONSE" });
});

test("SSE responses are assembled even when a compatible relay ignores stream false", () => {
  const parsed = parseJsonOrEventStream([
    'data: {"choices":[{"delta":{"role":"assistant","content":"56"}}]}',
    'data: {"choices":[{"delta":{"content":"088"}}]}',
    "data: [DONE]",
  ].join("\n"));
  assert.equal(parsed.choices[0].message.content, "56088");
});

test("SSE tool-call argument fragments preserve call identity and order", () => {
  const parsed = parseJsonOrEventStream([
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"calculator","arguments":"{\\"expression\\":"}}]}}]}',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"123*456\\"}"}}]}}]}',
    "data: [DONE]",
  ].join("\n"));
  assert.deepEqual(parsed.choices[0].message.tool_calls[0], { id: "call_1", type: "function", function: { name: "calculator", arguments: '{"expression":"123*456"}' } });
});

test("Responses API fallback handles responses-only relays", async () => {
  const requests = [];
  const provider = new OpenAICompatibleProvider({
    baseUrl: "https://example.com/v1",
    apiKey: "secret",
    fetch: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      if (url.endsWith("/chat/completions")) return new Response("<!doctype html><title>relay</title>", { status: 200, headers: { "content-type": "text/html" } });
      return new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: "56088" }] }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const result = await provider.complete({ model: "m", messages: [{ role: "user", content: "calculate" }], tools: [], signal: new AbortController().signal });
  assert.equal(result.content, "56088");
  assert.equal(requests[1].url, "https://example.com/v1/responses");
  assert.deepEqual(requests[1].body.input, [{ role: "user", content: "calculate" }]);
});
