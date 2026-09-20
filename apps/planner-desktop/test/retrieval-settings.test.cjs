"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createRetrievalSettings } = require("../electron/retrieval-settings.cjs");
const safeStorage = { isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(value), decryptString: value => value.toString() };
const value = { kind: "embedding", baseUrl: "https://example.com/v1", model: "text-embedding-v4", apiKey: "synthetic-secret", dimensions: 1024 };
async function fixture(t, secure = safeStorage, fetchImpl) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "p2at-retrieval-test-"));
  t.after(() => fs.rm(userDataPath, { recursive: true, force: true }));
  const create = () => createRetrievalSettings({ userDataPath, safeStorage: secure, fetchImpl, isTrustedSender: event => event === "trusted" });
  return { create, userDataPath, api: create() };
}

test("explicit replacement key repairs an unreadable profile without requiring destructive clear", async t=>{
  let unreadable=false;
  const secure={...safeStorage,decryptString: bytes=>{if(unreadable)throw new Error("wrong context");return bytes.toString();}};
  const {api}=await fixture(t,secure);
  assert.equal((await api.save("trusted",value)).ok,true);
  unreadable=true;
  assert.equal((await api.save("trusted",{...value,apiKey:""})).ok,false);
  assert.equal((await api.save("trusted",{...value,apiKey:"new-fixture-secret"})).ok,true);
  unreadable=false;
  assert.equal((await api.status("trusted")).embedding.hasKey,true);
});
test("retrieval profiles restore separately, never expose keys, retain same-endpoint key and clear independently", async t => {
  const { api, create, userDataPath } = await fixture(t);
  const result = await api.save("trusted", value);
  assert.equal(result.ok, true); assert.equal(result.profile.verified, false);
  assert.ok(!JSON.stringify(result).includes(value.apiKey));
  assert.equal((await api.save("trusted", { ...value, kind: "reranker", model: "qwen3.7-text-rerank" })).ok, true);
  assert.equal((await create().status("trusted")).embedding.model, value.model);
  const disk = await fs.readFile(path.join(userDataPath,"retrieval-settings/embedding/agent-credentials.v1.json"),"utf8");
  assert.ok(!disk.includes(value.apiKey));
  assert.equal((await api.save("trusted", { ...value, apiKey: "", model: "changed" })).ok, true);
  assert.equal((await api.save("trusted", { ...value, apiKey: "", baseUrl: "https://other.example" })).ok, false);
  assert.equal((await api.status("trusted")).embedding.model, "changed");
  await api.clear("trusted", { kind: "embedding" });
  const status = await create().status("trusted");
  assert.equal(status.embedding, null); assert.equal(status.reranker.hasKey, true);
  assert.ok(!JSON.stringify(status).includes(value.apiKey));
});
test("retrieval settings reject untrusted senders and malformed configuration without writing", async t => {
  const { api } = await fixture(t);
  assert.equal((await api.save("untrusted", value)).ok, false);
  assert.equal((await api.status("untrusted")).ok, false);
  assert.equal((await api.clear("untrusted", {kind:"embedding"})).ok, false);
  for (const patch of [{kind:"__proto__"},{baseUrl:"http://example.com"},{baseUrl:"https://user:pass@example.com"}, {baseUrl:"https://example.com?key=secret"}, {dimensions:3},{model:""},{apiKey:""}]) {
    assert.equal((await api.save("trusted", { ...value, ...patch })).ok, false);
  }
  assert.equal((await api.status("trusted")).embedding, null);
});
test("retrieval settings fail closed without OS encryption", async t => {
  const { api } = await fixture(t, { isEncryptionAvailable: () => false });
  assert.equal((await api.save("trusted", value)).ok, false);
});
test("connection test uses same-endpoint cached key without writing and rejects untrusted or cross-endpoint reuse",async t=>{
  let calls=0;
  const {api}=await fixture(t,safeStorage,async(_url,options)=>{
    calls++;assert.equal(options.headers.Authorization,`Bearer ${value.apiKey}`);
    return Response.json({data:[{embedding:Array(1024).fill(0.1)}]});
  });
  assert.equal((await api.test("untrusted",value)).ok,false);assert.equal(calls,0);
  assert.equal((await api.test("trusted",value)).ok,true);
  assert.equal((await api.status("trusted")).embedding,null);
  await api.save("trusted",value);
  assert.equal((await api.test("trusted",{...value,apiKey:""})).ok,true);
  assert.equal((await api.test("trusted",{...value,apiKey:"",baseUrl:"https://other.example"})).ok,false);
  assert.equal(calls,2);
});
