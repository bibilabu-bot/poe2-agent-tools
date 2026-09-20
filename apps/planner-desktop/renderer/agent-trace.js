"use strict";

// Shared, display-only projection. Never changes tool execution or model history.
((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AgentTrace = api;
})(typeof globalThis === "object" ? globalThis : this, () => {
  const sensitiveNames = new Set(["authorization", "proxyauthorization", "password", "passwd", "pwd", "secret", "token", "apitoken", "authtoken", "accesstoken", "refreshtoken", "idtoken", "sessiontoken", "sessionid", "cookie", "setcookie", "credential", "credentials", "privatekey", "secretkey", "密码", "密钥", "口令"]);
  const isSensitive = name => {
    const normalized = name.replace(/[-_\s]/g, "").toLowerCase();
    return sensitiveNames.has(normalized) || /(?:apikey|clientsecret|password|credential)$/.test(normalized);
  };
  function safeText(value, secret = "") {
    const scrub = text => secret ? text.split(secret).join("[已隐藏]") : text;
    const redact = (item, depth = 0) => {
      if (depth > 20) return "[层级过深，未展示]";
      if (typeof item === "string") {
        try {
          const parsed = JSON.parse(item);
          if (parsed && typeof parsed === "object") return JSON.stringify(redact(parsed, depth + 1));
        } catch { /* Non-JSON strings remain inert text. */ }
        return scrub(item);
      }
      if (Array.isArray(item)) return item.map(v => redact(v, depth + 1));
      if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([k, v]) => [scrub(k), isSensitive(k) ? "[已隐藏]" : redact(v, depth + 1)]));
      return item;
    };
    let parsed = value;
    if (typeof value === "string") { try { parsed = JSON.parse(value); } catch { /* Plain diagnostic text. */ } }
    const result = redact(parsed);
    return scrub(typeof result === "string" ? result : JSON.stringify(result, null, 2) ?? "");
  }
  function normalizeTrace(trace, secret = "") {
    let remaining = 24000;
    const bounded = (value, limit) => {
      const text = safeText(value, secret), size = Math.min(limit, remaining);
      const marker = "\n[展示已截断，不影响原始记忆]";
      const output = text.length > size ? (size >= marker.length ? text.slice(0, size - marker.length) + marker : marker.slice(0, size)) : text;
      remaining -= output.length;
      return output;
    };
    return (Array.isArray(trace) ? trace : []).slice(0, 12).filter(r => r && typeof r.name === "string").map((row, index) => ({
      sequence: index + 1, name: safeText(row.name, secret).slice(0, 64),
      callId: safeText(row.callId || "", secret).slice(0, 256), ok: row.ok === true,
      arguments: bounded(row.arguments ?? "（旧记录未保存传参）", 4000),
      result: bounded(row.result ?? "（无结果）", 8000),
      durationMs: Number.isFinite(row.durationMs) && row.durationMs >= 0 ? Math.min(row.durationMs, 86400000) : null,
    }));
  }
  function memoryPath(row, previous) {
    let result;
    try { result = JSON.parse(row.result); } catch { return "结果未完整展示，请查看下方截断提示。"; }
    if (!result || typeof result !== "object" || Array.isArray(result)) return "没有可展示的结构化记忆元数据。";
    if (!row.ok) return "工具执行失败，未将结果作为成功记忆。";
    if (row.name === "search_memory") {
      const ids = (Array.isArray(result.matches) ? result.matches : []).map(r => r?.turn_id).filter(Number.isInteger);
      return `关键词搜索 → 命中轮次：${ids.join("、") || "无"}（仅元数据）${result.next_offset != null ? `；下一页 offset=${result.next_offset}` : ""}`;
    }
    if (row.name === "read_memory") {
      const ids = Array.isArray(result.turn_ids) ? result.turn_ids.filter(Number.isInteger) : [];
      const sources = previous.filter(r => r.ok && r.name === "search_memory").filter(r => {
        try { return JSON.parse(r.result).matches.some(m => ids.includes(m.turn_id)); } catch { return false; }
      }).map(r => `#${r.sequence}`);
      return `读取原文 → 轮次：${ids.join("、") || "无"}；offset=${result.offset ?? 0}；${result.complete ? "范围已读完" : `还有下一页 offset=${result.next_offset}`}${sources.length ? `；与前序搜索 ${sources.join("、")} 的命中轮次重合（不代表模型决策因果）` : "；直接按轮次读取"}`;
    }
    if (row.name === "update_notebook") return `笔记本 → 修订 ${result.revision ?? "未知"}；第 ${result.updated_in_turn ?? "未知"} 轮暂存，整轮成功后提交`;
    return "";
  }
  function resultSections(row) {
    const fallback = [["返回结果", row.result]];
    let result;
    try { result = JSON.parse(row.result); } catch { return fallback; }
    if (row.name !== "read_memory" || result?.format !== "json_text_fragment" || typeof result.text !== "string") return fallback;
    const { text, ...metadata } = result;
    let label = "记忆原文片段（尚未拼接完整，不强行解析）", content = text;
    if (result.offset === 0 && result.complete === true) {
      try {
        content = JSON.stringify(JSON.parse(text), null, 2);
        label = "记忆原文（已解析，缩进展示）";
      } catch { label = "记忆原文（无法解析，保留原始文本）"; }
    }
    // Reformat only for display; preserve literal backslashes and the stored wire record.
    const header = JSON.stringify(metadata, null, 2);
    const marker = "\n[展示已截断，不影响原始记忆]";
    const limit = Math.max(0, 8000 - header.length);
    if (content.length > limit) content = limit >= marker.length ? content.slice(0, limit - marker.length) + marker : marker.slice(0, limit);
    return [["返回元数据", header], [label, content]];
  }
  function renderTrace(document, trace) {
    return normalizeTrace(trace).map((row, index, rows) => {
      const details = document.createElement("details"); details.className = "agent-operation";
      const summary = document.createElement("summary");
      summary.textContent = `#${row.sequence} ${row.ok ? "已完成" : "失败"} · ${row.name} · ${row.durationMs === null ? "耗时未记录" : `${row.durationMs} ms`}`;
      details.append(summary);
      const chain = memoryPath(row, rows.slice(0, index));
      for (const [label, text] of [["调用 ID", row.callId], ["记忆链路", chain], ["传参", row.arguments], ...resultSections(row)]) {
        if (!text && label !== "传参" && label !== "返回结果") continue;
        const title = document.createElement("div"); title.className = "agent-operation-label"; title.textContent = label;
        const pre = document.createElement("pre"); pre.textContent = text || "（展示预算已用尽）";
        details.append(title, pre);
      }
      return details;
    });
  }
  return { normalizeTrace, memoryPath, resultSections, renderTrace };
});
