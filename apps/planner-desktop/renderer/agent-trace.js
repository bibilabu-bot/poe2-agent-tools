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
    if (row.name === "search_passive_nodes" || row.name === "search_memory_semantic") {
      const passive = row.name === "search_passive_nodes";
      const ids = (Array.isArray(result.matches) ? result.matches : []).map(r => passive ? r.id : r.turn_id);
      return `向量检索 → ${result.candidate_count ?? 0} 个候选 → 重排序 → ${passive ? "节点" : "轮次"}：${ids.join("、") || "无"}（仅元数据，非穷尽列表）`;
    }
    if (row.name === "read_passive_nodes") {
      const ids = (Array.isArray(result.nodes) ? result.nodes : []).map(r => r.id);
      return `按 ID 读取天赋原文 → 节点：${ids.join("、") || "无"}；保留条件及限制；资料版本：${result.version ?? "未知"}`;
    }
    if (row.name === "search_memory") {
      const ids = (Array.isArray(result.matches) ? result.matches : []).map(r => r?.turn_id).filter(Number.isInteger);
      return `关键词搜索 → 命中轮次：${ids.join("、") || "无"}（仅元数据）${result.next_offset != null ? `；下一页 offset=${result.next_offset}` : ""}`;
    }
    if (row.name === "read_memory") {
      const ids = Array.isArray(result.turn_ids) ? result.turn_ids.filter(Number.isInteger) : [];
      const sources = previous.filter(r => r.ok && ["search_memory", "search_memory_semantic"].includes(r.name)).filter(r => {
        try { return JSON.parse(r.result).matches.some(m => ids.includes(m.turn_id)); } catch { return false; }
      });
      return `读取原文 → 轮次：${ids.join("、") || "无"}；offset=${result.offset ?? 0}；${result.complete ? "范围已读完" : `还有下一页 offset=${result.next_offset}`}${sources.length ? "；与前序搜索的命中轮次重合（不代表模型决策因果）" : "；直接按轮次读取"}`;
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
  function formatToolDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return "耗时未记录";
    if (ms < 1) return "<1 ms";
    if (ms < 1000) return `${Number(ms.toFixed(1))} ms`;
    return `${Number((ms / 1000).toFixed(2))} 秒`;
  }
  const toolStyles = {
    search_memory: { label: "搜索记忆", icon: "search", path: "M21 21l-4.5-4.5M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0" },
    read_memory: { label: "读取记忆", icon: "book", path: "M12 6v15M12 6C9 3 5 3 2 4v16c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 2Z" },
    update_notebook: { label: "更新笔记", icon: "pencil", path: "M14 5l5 5M4 20l5-1L21 7a3.5 3.5 0 0 0-5-5L4 14v6ZM4 20h16" },
    calculator: { label: "运行计算器", icon: "calculator", path: "M5 2h14v20H5ZM8 5h8v4H8ZM8 13h2m4 0h2m-8 4h2m4 0h2" },
  };
  const defaultStyle = { label: "运行工具", icon: "tool", path: "m8 5-6 7 6 7m8-14 6 7-6 7" };
  toolStyles.search_passive_nodes = {...toolStyles.search_memory,label:"检索天赋",icon:"passive-search"};
  toolStyles.read_passive_nodes = {...toolStyles.read_memory,label:"读取天赋",icon:"passive-read"};
  toolStyles.search_memory_semantic = {...toolStyles.search_memory,label:"语义检索记忆",icon:"semantic-memory"};
  function renderTrace(document, trace) {
    return normalizeTrace(trace).map((row, index, rows) => {
      const details = document.createElement("details"); details.className = "agent-operation";
      details.dataset.tool = row.name;
      const summary = document.createElement("summary");
      const style = Object.hasOwn(toolStyles, row.name) ? toolStyles[row.name] : defaultStyle;
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      for (const [key, value] of Object.entries({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.6", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false", class: "agent-operation-icon" })) icon.setAttribute(key, value);
      icon.dataset.icon = style.icon;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path"); path.setAttribute("d", style.path); icon.append(path);
      const label = document.createElement("span"); label.textContent = row.ok ? `已${style.label}` : `${style.label}失败`;
      const duration = document.createElement("span"); duration.className = "agent-operation-duration";
      duration.textContent = ` · ${formatToolDuration(row.durationMs)}`;
      duration.title = "仅工具执行耗时，不含模型等待；整轮耗时见“已处理”";
      summary.append(icon, label, duration);
      details.append(summary);
      const chain = memoryPath(row, rows.slice(0, index));
      for (const [label, text] of [["工具名称", row.name], ["调用 ID", row.callId], ["记忆链路", chain], ["传参", row.arguments], ...resultSections(row)]) {
        if (!text && label !== "传参" && label !== "返回结果") continue;
        const title = document.createElement("div"); title.className = "agent-operation-label"; title.textContent = label;
        const pre = document.createElement("pre"); pre.textContent = text || "（展示预算已用尽）";
        details.append(title, pre);
      }
      return details;
    });
  }
  return { normalizeTrace, memoryPath, resultSections, formatToolDuration, renderTrace };
});
