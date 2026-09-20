"use strict";

class ProbeError extends Error {}
async function testRetrievalConnection(kind, config, fetchImpl, timeoutMs = 15000) {
  const started = Date.now(), controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let url = config.baseUrl, body;
    if (kind === "embedding") {
      url = `${url}/embeddings`;
      body = { model: config.model, input: ["连接测试：你好"], encoding_format: "float", dimensions: config.dimensions };
      if (["text-embedding-v1", "text-embedding-v2"].includes(config.model)) delete body.dimensions;
    } else {
      const input = { query: "哪句话描述天气？", documents: ["今天晴天。", "这是一张桌子。"] };
      const native = new URL(url).pathname.endsWith("/text-rerank");
      if (config.model === "qwen3-rerank" && native) throw new ProbeError("该模型需使用 compatible-api/v1/reranks 完整地址，请调整 API 地址后重试");
      body = native ? { model: config.model, input, parameters: { top_n: 2 } } : { model: config.model, ...input, top_n: 2 };
    }
    const response = await fetchImpl(url, { method: "POST", redirect: "error", credentials: "omit", cache: "no-store", signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` }, body: JSON.stringify(body) });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      const hint = { 400:"请求参数或模型接口不匹配", 401:"Key 无效或已过期", 403:"无访问权限", 404:"地址或模型不存在", 429:"额度或请求频率受限" }[response.status] || "服务返回错误";
      throw new ProbeError(`HTTP ${response.status}：${hint}`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new ProbeError("服务未返回可读取的响应");
    const chunks = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 256000) throw new ProbeError("响应超出测试大小限制");
        chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    let data;
    try { data = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new ProbeError("服务未返回有效 JSON，请检查 API 地址"); }
    if (data.error || (data.code && data.code !== "Success")) throw new ProbeError("服务返回业务错误，请检查模型权限、额度和接口配置");
    let detail;
    if (kind === "embedding") {
      const vector = data.data?.[0]?.embedding;
      if (!Array.isArray(vector) || vector.length !== config.dimensions || !vector.every(Number.isFinite) || !vector.some(x=>x !== 0)) throw new ProbeError("向量格式或返回维度与配置不符");
      detail = `返回 ${vector.length} 维有效向量`;
    } else {
      const results = data.results ?? data.output?.results;
      if (!Array.isArray(results) || results.length !== 2 || new Set(results.map(r=>r?.index)).size !== 2 ||
          !results.every(r=>[0,1].includes(r?.index) && Number.isFinite(r?.relevance_score))) throw new ProbeError("排序响应缺少有效的索引或分数");
      detail = "返回 2 条有效排序结果";
    }
    return { ok: true, durationMs: Date.now() - started, detail };
  } catch (error) {
    // Never return provider bodies, URLs, headers or raw transport exceptions.
    return { ok: false, durationMs: Date.now() - started, error: { message: controller.signal.aborted ? "连接测试超时（15 秒），请检查网络或服务状态" : error instanceof ProbeError ? error.message : "网络连接失败，请检查地址、代理、证书或重定向" } };
  } finally { clearTimeout(timer); }
}
module.exports = { testRetrievalConnection };
