"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { AgentService, createAgentIpcHandlers, trimHistory, MAX_HISTORY_CHARS } = require("../electron/agent-service.cjs");

function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } }); }

test("service keeps configuration and conversation in memory and clears both", async () => {
  const requests = [];
  const service = new AgentService({ fetch: async (url, options) => { requests.push({ url, options }); return json({ choices: [{ message: { content: "ok" } }] }); } });
  assert.equal((await service.send({ model: "m", text: "hi" })).error.code, "NOT_CONFIGURED");
  const status = service.configure({ baseUrl: "https://example.com/v1", apiKey: "session-secret" });
  assert.deepEqual(status, { configured: true, baseUrl: "https://example.com/v1", targetHost: "example.com", running: false, credentialStored: false });
  assert.equal((await service.send({ model: "m", text: "first", toolsEnabled: false })).text, "ok");
  assert.equal((await service.send({ model: "m", text: "second", toolsEnabled: false })).text, "ok");
  const secondBody = JSON.parse(requests[1].options.body);
  assert.ok(secondBody.messages.some((message) => message.content === "first"));
  const cleared = service.clearConfig(); assert.equal(cleared.configured, false); assert.equal(service.history.length, 0); assert.equal(service.provider, null);
  assert.ok(!JSON.stringify(cleared).includes("session-secret"));
});

test("reset cancels a run, rejects concurrency, ignores late results, and permits retry", async () => {
  let first = true;
  const service = new AgentService({ fetch: async (_url, options) => {
    if (first) {
      first = false;
      await new Promise((resolve) => setTimeout(resolve, 25));
      return json({ choices: [{ message: { content: "late" } }] });
    }
    if (options.signal.aborted) throw options.signal.reason;
    return json({ choices: [{ message: { content: "fresh" } }] });
  } });
  service.configure({ baseUrl: "https://example.com/v1", apiKey: "x" });
  const pending = service.send({ model: "m", text: "old", toolsEnabled: false });
  assert.equal((await service.send({ model: "m", text: "overlap", toolsEnabled: false })).error.code, "RUN_IN_PROGRESS");
  service.reset();
  const old = await pending; assert.equal(old.ok, false); assert.ok(["CANCELLED", "STALE_RUN"].includes(old.error.code)); assert.equal(service.history.length, 0);
  const retry = await service.send({ model: "m", text: "new", toolsEnabled: false }); assert.equal(retry.text, "fresh");
});

test("IPC surface rejects untrusted callers and never returns the key", async () => {
  const service = new AgentService({ fetch: async () => json({ data: [] }) });
  const handlers = createAgentIpcHandlers(service, (event) => event?.trusted === true);
  await assert.rejects(() => handlers.status({ trusted: false }), { code: "UNTRUSTED_SENDER" });
  const result = await handlers.configure({ trusted: true }, { baseUrl: "https://example.com/v1", apiKey: "never-return" });
  assert.equal(result.configured, true); assert.ok(!JSON.stringify(result).includes("never-return"));
});

test("history trimming keeps complete user/tool protocol turns and enforces aggregate size", () => {
  const oldTurn = [{ role: "user", content: "old" }, { role: "assistant", content: "x".repeat(260_000) }];
  const recentTurn = [
    { role: "user", content: "calculate" },
    { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "calculator", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "c1", content: "2" },
    { role: "assistant", content: "two" },
  ];
  const trimmed = trimHistory([...oldTurn, ...recentTurn]);
  assert.deepEqual(trimmed, recentTurn); assert.ok(JSON.stringify(trimmed).length <= MAX_HISTORY_CHARS);
  assert.throws(() => trimHistory([{ role: "user", content: "x".repeat(MAX_HISTORY_CHARS + 1) }]), { code: "HISTORY_LIMIT" });
});

test("failed reconfiguration clears the previous provider and key state", () => {
  const service = new AgentService({ fetch: async () => json({}) });
  service.configure({ baseUrl: "https://example.com/v1", apiKey: "old-secret" });
  assert.throws(() => service.configure({ baseUrl: "http://example.com/v1", apiKey: "new-secret" }));
  assert.deepEqual(service.status(), { configured: false, baseUrl: null, targetHost: null, running: false, credentialStored: false });
});

test("IPC stores credentials locally and clear removes the cache", async () => {
  const calls = [];
  const credentialStore = {
    save: async (value) => calls.push(["save", { ...value }]),
    clear: async () => calls.push(["clear"]),
  };
  const service = new AgentService({ fetch: async () => json({ data: [] }) });
  const handlers = createAgentIpcHandlers(service, () => true, credentialStore);
  const connected = await handlers.configure({}, { baseUrl: "https://example.com/v1", apiKey: "local-secret" });
  assert.equal(connected.credentialStored, true);
  assert.deepEqual(calls, [["save", { baseUrl: "https://example.com/v1", apiKey: "local-secret" }]]);
  assert.ok(!JSON.stringify(connected).includes("local-secret"));
  const cleared = await handlers.clear({});
  assert.equal(cleared.credentialStored, false);
  assert.deepEqual(calls.at(-1), ["clear"]);
});

test("credential mutations serialize configure, clear, and overlapping configure requests", async () => {
  let releaseFirstSave;
  const firstSaveBlocked = new Promise((resolve) => { releaseFirstSave = resolve; });
  const calls = [];
  let saveCount = 0;
  const credentialStore = {
    save: async ({ baseUrl }) => { calls.push(`save:${baseUrl}`); saveCount += 1; if (saveCount === 1) await firstSaveBlocked; },
    clear: async () => { calls.push("clear"); },
  };
  const service = new AgentService({ fetch: async () => json({ data: [] }) });
  const handlers = createAgentIpcHandlers(service, () => true, credentialStore);
  const first = handlers.configure({}, { baseUrl: "https://first.example/v1", apiKey: "first" });
  await new Promise((resolve) => setImmediate(resolve));
  const clear = handlers.clear({});
  const second = handlers.configure({}, { baseUrl: "https://second.example/v1", apiKey: "second" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["save:https://first.example/v1"]);
  releaseFirstSave();
  assert.equal((await first).ok, true);
  assert.equal((await clear).ok, true);
  assert.equal((await second).ok, true);
  assert.deepEqual(calls, ["save:https://first.example/v1", "clear", "save:https://second.example/v1"]);
  assert.equal(service.status().baseUrl, "https://second.example/v1");
  assert.equal(service.status().credentialStored, true);
});
