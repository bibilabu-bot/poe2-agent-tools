"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { AgentService, createAgentIpcHandlers } = require("../electron/agent-service.cjs");

class MockPythonClient {
  constructor() { this.configured = false; this.calls = []; this.block = null; }
  setTreeWriteHandler(_handler) { /* noop in tests */ }
  async request(method, params = {}) {
    this.calls.push({ method, params: structuredClone(params) });
    if (method === "status") return { configured: this.configured };
    if (method === "rag_configure") return { ready: false };
    if (method === "tree_snapshot") return { ready: Boolean(params.snapshot), nodeCount: params.snapshot?.nodeCount || 0 };
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

test("retrieval receives only the remaining main-owned run budget", async () => {
  const client=new MockPythonClient(),service=new AgentService({client,runTimeoutMs:2000});
  await service.configure({baseUrl:"https://example.com/v1",apiKey:"synthetic"});
  service.ragConfiguration=async()=>{await new Promise(resolve=>setTimeout(resolve,25));return {profiles:null};};
  const result=await service.send({model:"fixture",text:"fixture",_remainingMs:999999999});
  assert.equal(result.ok,true);
  const forwarded=client.calls.find(call=>call.method==="send").params._remainingMs;
  assert.ok(forwarded>0 && forwarded<=1980);
});

test("write handler is gated and returns a refreshed snapshot after execution", async () => {
  for (const [enabled,refreshFails] of [[false,false],[true,false],[true,true]]) {
    const client=new MockPythonClient();let handler=null;
    client.setTreeWriteHandler=value=>{handler=value;};
    const original=client.request.bind(client);
    client.request=async(method,params)=>{
      if(method==='send') {
        assert.equal(typeof handler,enabled?'function':'object');
        if(enabled) {
          const result=await handler('deallocate',{nodeId:'42',category:'weaponSet2'});
          if(refreshFails) { assert.equal(result.success,true);assert.equal(result.refreshError,true); }
          else assert.equal(result.snapshot.snapshotId,'fresh');
        }
      }
      return original(method,params);
    };
    const service=new AgentService({client});
    service.treeSnapshotProvider=async state=>{if(state.fresh&&refreshFails)throw new Error('refresh failed');return {snapshotId:state.fresh?'fresh':'old'};};
    const scripts=[];
    const webContents={isDestroyed:()=>false,executeJavaScript:async script=>{
      scripts.push(script);return script==='window.captureBuildState()'?{fresh:true}:{success:true};
    }};
    await service.configure({baseUrl:'https://example.com/v1',apiKey:'fixture'});
    assert.equal((await service.send({toolsEnabled:enabled,buildState:{}},null,webContents)).ok,true);
    assert.equal(scripts.length,enabled?2:0);
    if(enabled) assert.match(scripts[0],/weaponSet2/);
    assert.equal(handler,null);
  }
});

test("prompt inspection is local, guarded, non-configuring and rejects stale results", async () => {
  const calls=[]; let release;
  const client={request:async method=>{calls.push(method);return new Promise(resolve=>{release=resolve;});},terminate:()=>{}};
  const service=new AgentService({client});
  const handlers=createAgentIpcHandlers(service,e=>e.trusted);
  await assert.rejects(()=>handlers.inspectPrompt({trusted:false}),{code:"UNTRUSTED_SENDER"});
  const pending=handlers.inspectPrompt({trusted:true});
  assert.equal((await service.inspectPrompt()).error.code,"RUN_IN_PROGRESS");
  assert.equal((await service.send({})).error.code,"RUN_IN_PROGRESS");
  release({text:"public",privateContextIncluded:false});
  assert.equal((await pending).prompt.text,"public");
  assert.deepEqual(calls,["inspect_prompt"]);
  const stale=service.inspectPrompt();service.cancel();release({text:"stale"});
  assert.equal((await stale).error.code,"CANCELLED");
});

test("both prompt categories pass exact text through guarded save IPC", async () => {
  const calls=[];
  const service=new AgentService({client:{request:async(method,params)=>{calls.push({method,params});return {blocks:[]};}}});
  const handlers=createAgentIpcHandlers(service,e=>e.trusted);
  const overrides={base:"  exact\n",memory_prefix:"prefix\n",tool_search_memory:"工具说明🙂"};
  await assert.rejects(()=>handlers.savePrompts({trusted:false},{overrides}),{code:"UNTRUSTED_SENDER"});
  assert.equal((await handlers.savePrompts({trusted:true},{overrides})).ok,true);
  assert.deepEqual(calls,[{method:"save_prompts",params:{overrides}}]);
  assert.equal((await service.savePrompts({tool_unknown:"x"})).error.code,"INVALID_PROMPT");
  assert.equal((await service.savePrompts({tool_search_memory:"x".repeat(8001)})).error.code,"INVALID_PROMPT");
  assert.equal(calls.length,1);
});

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

test("production service publishes the immutable tree snapshot before the model run", async () => {
  const client = new MockPythonClient();
  const service = new AgentService({ client });
  service.treeSnapshotProvider = async buildState => ({snapshotId:"snap-fixture",nodeCount:1,
    nodes:[{id:"54814",name:"烈焰之心",stats:["火焰伤害提高 12%"]}],adjacency:{"54814":[]},
    build:{allocations:{normal:["54814"]},budgets:{passive:122}}});
  await service.configure({ baseUrl: "https://example.com/v1", apiKey: "synthetic" });
  const result = await service.send({model:"mock",text:"读取节点 54814",buildState:{allocated:["54814"]}});
  assert.equal(result.ok, true);
  const methods = client.calls.map(call => call.method);
  assert.ok(methods.indexOf("tree_snapshot") < methods.lastIndexOf("send"));
  const published = client.calls.find(call => call.method === "tree_snapshot").params.snapshot;
  assert.equal(published.nodes[0].name, "烈焰之心");
  assert.deepEqual(published.nodes[0].stats, ["火焰伤害提高 12%"]);
});

test("snapshot failures clear stale data and stop before sending a tool-less model request", async () => {
  const client = new MockPythonClient();
  const service = new AgentService({client});
  await service.configure({baseUrl:"https://example.com/v1",apiKey:"synthetic"});
  service.treeSnapshotProvider = async () => { throw new TypeError("duplicate node ID: 11184"); };
  const result = await service.send({model:"mock",text:"你能看到我的bd吗",buildState:{nodes:[]}});
  assert.equal(result.ok,false);
  assert.equal(result.error.code,"TREE_SNAPSHOT_FAILED");
  assert.equal(client.calls.some(call=>call.method==="send"),false);
  assert.equal(client.calls.find(call=>call.method==="tree_snapshot").params.snapshot,null);
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

test("deletion requires confirmation, serializes operations and rejects cancelled run events",async()=>{
  const client=new MockPythonClient(), original=client.request.bind(client);
  let release,progress;
  client.request=async(method,params,options)=>{
    if(method==="send"){progress=options.onEvent;return new Promise(resolve=>{release=resolve;});}
    if(method==="delete_session")return {selectedId:null,sessions:[]};
    return original(method,params);
  };
  const service=new AgentService({client}),events=[];
  await service.configure({baseUrl:"https://example.com/v1",apiKey:"synthetic"});
  assert.equal((await service.sessionOperation("delete_session",{conversationId:"first"})).error.code,"CONFIRMATION_REQUIRED");
  const pending=service.send({model:"m",text:"first"},e=>events.push(e));
  await new Promise(r=>setImmediate(r));
  assert.equal((await service.sessionOperation("delete_session",{conversationId:"first",confirmed:true})).error.code,"RUN_IN_PROGRESS");
  service.cancel();
  assert.equal((await service.sessionOperation("delete_session",{conversationId:"first",confirmed:true})).ok,true);
  progress({type:"text_delta",text:"late",seq:1});release({text:"late",history:[{role:"assistant",content:"late"}]});
  assert.equal((await pending).ok,false);assert.equal(events.length,0);assert.deepEqual(service.history,[]);
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
