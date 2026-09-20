"use strict";

const path = require("node:path");
const { AgentCredentialStore } = require("./agent-credential-store.cjs");

// Separate encrypted profiles; never reuse the chat key implicitly.
function createRetrievalSettings({ userDataPath, safeStorage, isTrustedSender }) {
  const stores = Object.fromEntries(["embedding", "reranker"].map(kind => [kind,
    new AgentCredentialStore({ userDataPath: path.join(userDataPath, "retrieval-settings", kind), safeStorage })]));
  let queue = Promise.resolve();
  const publicValue = value => value ? { baseUrl: value.baseUrl, model: value.model,
    dimensions: value.dimensions, hasKey: true, verified: false } : null;
  const read = async kind => {
    const value = await stores[kind].load();
    return value ? { ...JSON.parse(value.apiKey), baseUrl: value.baseUrl } : null;
  };
  function validate(value) {
    if (!value || !Object.hasOwn(stores, value.kind)) throw new Error("invalid kind");
    if (typeof value.baseUrl !== "string" || value.baseUrl.length > 2048 ||
        typeof value.model !== "string" || !value.model.trim() || value.model.length > 200 ||
        typeof value.apiKey !== "string" || value.apiKey.length > 1024) throw new Error("invalid fields");
    const url = new URL(value.baseUrl.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("invalid endpoint");
    if (value.kind === "embedding" && ![64,128,256,512,768,1024,1536,2048,2560].includes(value.dimensions)) throw new Error("invalid dimensions");
    return { baseUrl: url.href.replace(/\/$/, ""), model: value.model.trim(),
      dimensions: value.kind === "embedding" ? value.dimensions : undefined, apiKey: value.apiKey.trim() };
  }
  const handle = operation => (event, value) => {
    if (!isTrustedSender(event)) return Promise.resolve({ ok: false, error: { message: "请求来源不受信任" } });
    const task = queue.then(async () => {
      try { return await operation(value); }
      catch { return { ok: false, error: { message: "设置操作失败：请检查 HTTPS 地址、模型、维度和 Key；系统安全存储必须可用。更换地址需重新输入 Key。" } }; }
    });
    queue = task.catch(() => {}); return task;
  };
  return {
    status: handle(async () => ({ ok: true, embedding: publicValue(await read("embedding")), reranker: publicValue(await read("reranker")) })),
    save: handle(async value => {
      const config = validate(value), previous = await read(value.kind);
      if (!config.apiKey && previous?.baseUrl === config.baseUrl) config.apiKey = previous.apiKey;
      if (!config.apiKey) throw new Error("key required");
      const { baseUrl, ...secret } = config;
      const payload = JSON.stringify(secret);
      if (payload.length > 4096) throw new Error("profile too large");
      await stores[value.kind].save({ baseUrl, apiKey: payload });
      return { ok: true, profile: publicValue(config) };
    }),
    clear: handle(async value => {
      if (!value || !Object.hasOwn(stores, value.kind)) throw new Error("invalid kind");
      await stores[value.kind].clear(); return { ok: true };
    })
  };
}
module.exports = { createRetrievalSettings };
