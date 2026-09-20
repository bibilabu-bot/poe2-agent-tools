"use strict";
(() => {
  const api = window.desktopAPI?.retrievalSettings;
  const field = (kind, name) => document.getElementById(kind + name);
  const status = (kind, text, error = false) => {
    field(kind, "Status").textContent = text;
    field(kind, "Status").className = `agent-status${error ? " error" : ""}`;
  };
  const busy = (kind, value) => document.querySelectorAll(`[data-profile="${kind}"] input,[data-profile="${kind}"] select,[data-profile="${kind}"] button`).forEach(el => { el.disabled = value; });
  const apply = (kind, profile) => {
    if (profile) {
      field(kind, "Url").value = profile.baseUrl;
      field(kind, "Model").value = profile.model;
      if (kind === "embedding") field(kind, "Dimensions").value = profile.dimensions;
    }
    field(kind, "Key").value = "";
    field(kind, "Key").placeholder = profile?.hasKey ? "已安全保存；不会回显" : "请输入 Key";
    status(kind, profile ? "已安全保存 · 未验证接口 · RAG 尚未接入" : "未配置");
  };
  document.querySelectorAll("[data-save-profile]").forEach(button => button.addEventListener("click", async () => {
    const kind = button.dataset.saveProfile;
    busy(kind, true);
    try {
      const result = await api.save({ kind, baseUrl: field(kind, "Url").value.trim(), model: field(kind, "Model").value.trim(),
        apiKey: field(kind, "Key").value, ...(kind === "embedding" ? { dimensions: Number(field(kind, "Dimensions").value) } : {}) });
      if (!result.ok) { status(kind, result.error.message, true); return; }
      apply(kind, result.profile);
    } catch { status(kind, "保存失败，请检查桌面安全桥或重启应用", true); }
    finally { field(kind, "Key").value = ""; busy(kind, false); }
  }));
  document.querySelectorAll("[data-clear-profile]").forEach(button => button.addEventListener("click", async () => {
    const kind = button.dataset.clearProfile; busy(kind, true);
    try {
      const result = await api.clear(kind);
      if (!result.ok) { status(kind, result.error.message, true); return; }
      apply(kind, null);
    } catch { status(kind, "清除失败，请重试", true); }
    finally { field(kind, "Key").value = ""; busy(kind, false); }
  }));
  for (const kind of ["embedding", "reranker"]) busy(kind, true);
  if (!api) {
    for (const kind of ["embedding", "reranker"]) status(kind, "设置安全桥不可用，请重启桌面应用", true);
    return;
  }
  api.status().then(result => {
    if (!result.ok) throw new Error("load failed");
    for (const kind of ["embedding", "reranker"]) apply(kind, result[kind]);
  }).catch(() => {
    for (const kind of ["embedding", "reranker"]) status(kind, "无法读取已存配置，请检查系统安全存储", true);
  }).finally(() => { for (const kind of ["embedding", "reranker"]) busy(kind, false); });
})();
