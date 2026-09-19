"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { AgentService, createAgentIpcHandlers } = require("../electron/agent-service.cjs");

class MockPythonClient {
  constructor() { this.configured = false; this.calls = []; this.block = null; }
  async request(method, params = {}) {
    this.calls.push({ method, params: structuredClone(params) });
    if (method === "status") return { configured: this.configured };
    if (method === "configure") { this.configured = true; return { configured: true, baseUrl: params.baseUrl }; }
    if (method === "clear") { this.configured = false; return { configured: false }; }
    if (method === "reset") return { ok: true };
    if (method === "models") return { models: ["model-a"] };
    if (method === "send") {
      if (this.block) await this.block;
      return { text: "ok", trace: [] };
    }
    throw new Error("unexpected method");
  }
  terminate(error) { this.configured = false; this.terminatedWith = error; }
}

test("service delegates configuration, models, and chat to Python", async () => {
  const client = new MockPythonClient();
  const service = new AgentService({ client });
  assert.equal((await service.send({ model: "m", text: "hi" })).error.code, "NOT_CONFIGURED");
  await service.configure({ baseUrl: "https://example.com/v1", apiKey: "secret" });
  assert.deepEqual((await service.models()).models, ["model-a"]);
  assert.equal((await service.send({ model: "m", text: "hi", toolsEnabled: true })).text, "ok");
  assert.equal(client.calls.at(-1).method, "send");
  assert.ok(!JSON.stringify(service.status()).includes("secret"));
});

test("cancel terminates the Python process and the next request restores configuration", async () => {
  const client = new MockPythonClient();
  const service = new AgentService({ client });
  await service.configure({ baseUrl: "https://example.com/v1", apiKey: "secret" });
  let release;
  client.block = new Promise((resolve) => { release = resolve; });
  const pending = service.send({ model: "m", text: "slow" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await service.send({ model: "m", text: "overlap" })).error.code, "RUN_IN_PROGRESS");
  service.cancel(); release(); await pending;
  client.block = null;
  assert.equal((await service.send({ model: "m", text: "again" })).ok, true);
  assert.equal(client.calls.filter((call) => call.method === "configure").length, 2);
});

test("a cancelled run cannot clear its immediate replacement's active token", async () => {
  const client = new MockPythonClient();
  const service = new AgentService({ client });
  await service.configure({ baseUrl: "https://example.com/v1", apiKey: "secret" });
  const releases = [];
  const originalRequest = client.request.bind(client);
  client.request = async (method, params) => {
    if (method !== "send") return originalRequest(method, params);
    return new Promise((resolve) => releases.push(() => resolve({ text: "done", trace: [] })));
  };
  const first = service.send({ model: "m", text: "first" });
  await new Promise((resolve) => setImmediate(resolve));
  service.cancel();
  const second = service.send({ model: "m", text: "second" });
  await new Promise((resolve) => setImmediate(resolve));
  releases[0](); await first;
  assert.equal((await service.send({ model: "m", text: "third" })).error.code, "RUN_IN_PROGRESS");
  releases[1](); await second;
});

test("clear cancels a blocked model-list request before removing credentials", async () => {
  const client = new MockPythonClient();
  const service = new AgentService({ client });
  await service.configure({ baseUrl: "https://example.com/v1", apiKey: "secret" });
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const originalRequest = client.request.bind(client);
  client.request = async (method, params) => method === "models" ? blocked : originalRequest(method, params);
  const pending = service.models();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(service.status().running, true);
  await service.clearConfig();
  assert.equal(client.terminatedWith.code, "CANCELLED");
  release({ models: [] });
  await pending;
  assert.equal(service.status().configured, false);
});

test("IPC rejects untrusted callers, serializes credential writes, and never returns the key", async () => {
  const client = new MockPythonClient();
  const service = new AgentService({ client });
  const stored = [];
  const handlers = createAgentIpcHandlers(service, (event) => event?.trusted, {
    save: async (value) => stored.push(value), clear: async () => stored.push("cleared"),
  });
  await assert.rejects(() => handlers.status({ trusted: false }), { code: "UNTRUSTED_SENDER" });
  const result = await handlers.configure({ trusted: true }, { baseUrl: "https://example.com/v1", apiKey: "never-return" });
  assert.equal(result.credentialStored, true);
  assert.ok(!JSON.stringify(result).includes("never-return"));
  assert.equal(stored[0].apiKey, "never-return");
  await handlers.clear({ trusted: true });
  assert.equal(stored.at(-1), "cleared");
});
