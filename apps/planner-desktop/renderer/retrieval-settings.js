"use strict";
(() => {
  const api = window.desktopAPI?.retrievalSettings;
  const field = (kind, name) => document.getElementById(kind + name);
  // Official text-model presets, not an account-specific /models response.
  const dimensions = {
    "text-embedding-v4": [64,128,256,512,768,1024,1536,2048],
    "text-embedding-v3": [64,128,256,512,768,1024],
    "text-embedding-v2": [1536], "text-embedding-v1": [1536],
    "qwen3.7-text-embedding": [256,512,768,1024,1536,2048,2560],
    "qwen3.7-text-embedding-flash": [256,512,768,1024]
  };
  function syncDimensions(preferred = Number(field("embedding", "Dimensions").value)) {
    const model = field("embedding", "Model").value;
    const values = Object.hasOwn(dimensions, model) ? dimensions[model] : [64,128,256,512,768,1024,1536,2048,2560];
    const select = field("embedding", "Dimensions");
    select.replaceChildren(...values.map(value => new Option(String(value), String(value))));
    select.value = String(values.includes(preferred) ? preferred : values.includes(1024) ? 1024 : values[0]);
  }
  function syncModel(kind) {
    const input = field(kind, "Model"), select = field(kind, "ModelSelect");
    select.value = [...select.options].some(option => option.value === input.value) ? input.value : "custom";
    input.hidden = select.value !== "custom";
    field(kind, "CustomLabel").hidden = input.hidden;
    if (kind === "embedding") syncDimensions();
  }
  for (const kind of ["embedding", "reranker"]) {
    const input = field(kind, "Model"), select = document.createElement("select");
    select.id = kind + "ModelSelect";
    const models = kind === "embedding" ? Object.keys(dimensions) : ["qwen3.7-text-rerank", "qwen3-rerank", "gte-rerank-v2", "qwen3-vl-rerank"];
    select.append(...models.map(model => new Option(model, model)), new Option("自定义模型 ID…", "custom"));
    document.querySelector(`label[for="${kind}Model"]`).htmlFor = select.id;
    const label = document.createElement("label"); label.id = kind + "CustomLabel"; label.htmlFor = input.id; label.textContent = "自定义模型 ID";
    input.before(select, label);
    const hint = document.createElement("p"); hint.className = "agent-help";
    hint.textContent = "预置模型列表，非账号实时可用列表；更换模型不会自动修改 API 地址，请确认服务支持。";
    input.after(hint);
    select.addEventListener("change", () => {
      if (select.value === "custom") { input.hidden = false; label.hidden = false; input.focus(); }
      else { input.value = select.value; syncModel(kind); }
    });
    if (kind === "embedding") input.addEventListener("change", () => syncDimensions());
    syncModel(kind);
  }
  const status = (kind, text, error = false) => {
    field(kind, "Status").textContent = text;
    field(kind, "Status").className = `agent-status${error ? " error" : ""}`;
  };
  const busy = (kind, value) => document.querySelectorAll(`[data-profile="${kind}"] input,[data-profile="${kind}"] select,[data-profile="${kind}"] button`).forEach(el => { el.disabled = value; });
  const apply = (kind, profile) => {
    if (profile) {
      field(kind, "Url").value = profile.baseUrl;
      field(kind, "Model").value = profile.model;
      syncModel(kind);
      if (kind === "embedding") syncDimensions(profile.dimensions);
    }
    field(kind, "Key").value = "";
    field(kind, "Key").placeholder = profile?.hasKey ? "已安全保存；不会回显" : "请输入 Key";
    status(kind, profile ? "已安全保存 · 未验证接口 · RAG 尚未接入" : "未配置");
    if (kind === "embedding" && profile && Number(field(kind, "Dimensions").value) !== profile.dimensions) {
      status(kind, "原保存维度不在该模型预置范围内，已调整显示值；请确认后重新保存", true);
    }
  };
  for (const kind of ["embedding", "reranker"]) {
    const button = document.createElement("button"); button.textContent = "连接测试"; button.dataset.testProfile = kind;
    document.querySelector(`[data-save-profile="${kind}"]`).after(button);
    const help = document.createElement("p"); help.className = "agent-help";
    help.textContent = "连接测试使用当前填写的配置发送固定样例，可能产生少量 API 费用；不上传历史或天赋资料，不自动保存。";
    field(kind, "Status").before(help);
    button.addEventListener("click", async () => {
      busy(kind, true); button.textContent = "测试中…"; status(kind, "正在测试当前配置，请稍候…");
      try {
        const result = await api.test({ kind, baseUrl: field(kind,"Url").value.trim(), model:field(kind,"Model").value.trim(),
          apiKey:field(kind,"Key").value, ...(kind === "embedding" ? {dimensions:Number(field(kind,"Dimensions").value)} : {}) });
        status(kind, result.ok ? `连接测试通过 · ${result.durationMs} ms · ${result.detail}；配置未自动保存，RAG 尚未接入` : `连接测试失败：${result.error.message}`, !result.ok);
      } catch { status(kind, "连接测试不可用，请完整重启桌面应用后重试", true); }
      finally { busy(kind, false); button.textContent = "连接测试"; }
    });
    document.querySelectorAll(`[data-profile="${kind}"] input,[data-profile="${kind}"] select`).forEach(input=>input.addEventListener("input",()=>status(kind,"配置已修改，请重新保存或连接测试")));
  }
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
