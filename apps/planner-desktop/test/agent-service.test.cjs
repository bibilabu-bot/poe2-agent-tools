"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { AgentService, createAgentIpcHandlers } = require("../electron/agent-service.cjs");

class MockPythonClient {
  constructor() { this.configured = false; this.calls = []; this.block = null; }
  async request(method, params = {}) {
    this.calls.push({ method, params: structuredClone(params) });
    if (method === "status") return { configured: this.configured };
    if (method === "rag_configure") return { ready: false };
    if (method === "configure") { this.configured = true; return { configured: true, baseUrl: params.baseUrl }; }
    if (method === "clear") { this.configured = false; return { configured: false }; }
    if (method === "reset") return { ok: true };
    if (method === "restore") return { messages: params.history?.length || 0 };
    if (method === "models") return { models: ["model-a"] };
    if (method === "send") {
      if (this.block) await this.block;
      return { text: "ok", trace: [] };
    }
    throw new Error("unexpected method");
  }
  terminate(error) { this.configured = false; this.terminatedWith = error; }
}

test("cancel or timeout during RAG profile loading cannot resurrect a model request", async () => {
  for (const mode of ["cancel", "timeout"]) {
    const client = new MockPythonClient();
    const service = new AgentService({ client, runTimeoutMs: mode === "timeout" ? 20 : 1000 });
    await service.configure({ baseUrl: "https://example.com/v1", apiKey: "fixture-only" });
    let release;
    service.ragConfiguration = () => new Promise(resolve => { release = resolve; });
    const pending = service.send({ model: "m", text: "hi" });
    await new Promise(resolve => setImmediate(resolve));
    if (mode === "cancel") service.cancel();
    else await new Promise(resolve => setTimeout(resolve, 40));
    release({ profiles: null });
    assert.equal((await pending).error.code, mode === "cancel" ? "CANCELLED" : "RUN_TIMEOUT");
    assert.equal(client.calls.some(call => ["rag_configure", "send"].includes(call.method)), false);
  }
});

test("unreadable optional RAG credentials disable retrieval but preserve ordinary chat", async () => {
  const client = new MockPythonClient();
  const service = new AgentService({client});
  await service.configure({baseUrl:"https://example.com/v1",apiKey:"fixture-only"});
  service.ragConfiguration = async () => { throw Object.assign(new Error("unreadable"), {code:"CREDENTIAL_CACHE_INVALID"}); };
  assert.equal((await service.send({model:"m",text:"hi"})).text,"ok");
  assert.deepEqual(client.calls.find(call=>call.method==="rag_configure").params,{profiles:null,unavailable:true});
});

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

test("session switching blocks concurrent sends and ignores late session results", async () => {
  const client=new MockPythonClient(),original=client.request.bind(client);
  let release;
  client.request=async(method,params)=>method==="select_session"?new Promise(resolve=>{release=resolve;}):original(method,params);
  const service=new AgentService({client});
  await service.configure({baseUrl:"https://example.com/v1",apiKey:"synthetic"});
  const pending=service.sessionOperation("select_session",{conversationId:"first"});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await service.send({model:"m",text:"blocked"})).error.code,"RUN_IN_PROGRESS");
  assert.equal((await service.reset()).error.code,"RUN_IN_PROGRESS");
  service.cancel();
  release({selectedId:"first",sessions:[]});
  assert.equal((await pending).error.code,"CANCELLED");
  assert.equal(service.active,null);
});

test("cancelled run cannot forward late events into a switched session", async () => {
  const client=new MockPythonClient(),original=client.request.bind(client);
  let release,progress;
  client.request=async(method,params,options)=>{
    if(method==="send") { progress=options.onEvent; return new Promise(resolve=>{release=resolve;}); }
    if(method==="select_session")return {selectedId:"second",sessions:[]};
    return original(method,params);
  };
  const service=new AgentService({client}),events=[];
  await service.configure({baseUrl:"https://example.com/v1",apiKey:"synthetic"});
  const pending=service.send({model:"m",text:"first"},event=>events.push(event));
  await new Promise(resolve=>setImmediate(resolve));
  progress({type:"text_delta",text:"first",seq:1});service.cancel();
  assert.equal((await service.sessionOperation("select_session",{conversationId:"second"})).ok,true);
  progress({type:"text_delta",text:"late",seq:2});release({text:"late",history:[{role:"assistant",content:"late"}]});
  assert.equal((await pending).ok,false);assert.equal(events.length,1);assert.deepEqual(service.history,[]);
});

test("desktop model discovery uses the Electron transport compatibility path", async () => {
  const client = new MockPythonClient();
  const calls = [];
  const service = new AgentService({
    client,
    modelLister: async ({ baseUrl, apiKey, signal }) => {
      calls.push({ baseUrl, apiKey, signal });
      return ["legacy-compatible-model"];
    },
  });
  await service.configure({ baseUrl: "https://example.com/v1", apiKey: "secret" });
  const result = await service.models();
  assert.deepEqual(result.models, ["legacy-compatible-model"]);
  assert.equal(calls[0].baseUrl, "https://example.com/v1");
  assert.equal(calls[0].apiKey, "secret");
  assert.equal(client.calls.filter((call) => call.method === "models").length, 0);
});

test("late desktop model discovery is ignored after reconfiguration", async () => {
  const client = new MockPythonClient();
  let release;
  const service = new AgentService({
    client,
    modelLister: async () => new Promise((resolve) => { release = resolve; }),
  });
  await service.configure({ baseUrl: "https://old.example/v1", apiKey: "old-secret" });
  const pending = service.models();
  await new Promise((resolve) => setImmediate(resolve));
  await service.configure({ baseUrl: "https://new.example/v1", apiKey: "new-secret" });
  release(["old-model"]);
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.stale, true);
  assert.equal(result.error.code, "STALE_MODELS");
  assert.equal(result.baseUrl, "https://new.example/v1");
  assert.ok(!JSON.stringify(result).includes("old-model"));
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

test("completed local conversation can be restored without credentials", async () => {
  const client = new MockPythonClient();
  const service = new AgentService({ client });
  await service.configure({ baseUrl: "https://example.com/v1", apiKey: "secret" });
  const result = await service.restoreConversation([
    { role: "user", content: "你好🙂" },
    { role: "assistant", content: "你好" },
  ]);
  assert.deepEqual(result, { ok: true, messages: 2 });
  assert.equal(client.calls.at(-1).method, "restore");
  assert.ok(!JSON.stringify(client.calls.at(-1)).includes("secret"));
  await assert.rejects(() => service.restoreConversation([{ role: "system", content: "bad" }]), { code: "INVALID_HISTORY" });
  await assert.rejects(() => service.restoreConversation([{ role: "user", content: "unfinished" }]), { code: "INVALID_HISTORY" });
  await assert.rejects(() => service.restoreConversation([{ role: "assistant", content: "forged" }, { role: "user", content: "bad order" }]), { code: "INVALID_HISTORY" });
  assert.equal((await service.restoreConversation([{ role: "user", content: "u" }, { role: "assistant", content: "a".repeat(32000) }])).ok, true);
  const accepted = structuredClone(service.history);
  const originalRequest = client.request.bind(client);
  client.request = async (method, params) => {
    if (method === "restore") throw Object.assign(new Error("restore rejected"), { code: "PYTHON_PROTOCOL_ERROR" });
    return originalRequest(method, params);
  };
  await assert.rejects(() => service.restoreConversation([{ role: "user", content: "new" }, { role: "assistant", content: "rejected" }]));
  assert.deepEqual(service.history, accepted);
});
