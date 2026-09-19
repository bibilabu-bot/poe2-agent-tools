"use strict";

const { app, net } = require("electron");
const { AgentService } = require("../electron/agent-service.cjs");

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

app.whenReady().then(async () => {
  const service = new AgentService({ fetch: (url, options) => net.fetch(url, options) });
  try {
    service.configure({ baseUrl: required("P2AT_AGENT_BASE_URL"), apiKey: required("P2AT_AGENT_API_KEY") });
    const models = await service.models();
    const chat = await service.send({
      model: required("P2AT_AGENT_MODEL"),
      text: "请使用 calculator 计算 123 乘以 456，并只给出结果。",
      toolsEnabled: true,
    });
    const output = {
      modelsOk: models.ok,
      modelCount: models.models?.length || 0,
      selectedModelListed: models.models?.includes(process.env.P2AT_AGENT_MODEL) || false,
      chatOk: chat.ok,
      text: chat.text,
      trace: chat.trace?.map(({ callId, name, ok, result }) => ({ callId, name, ok, result })),
      error: chat.error,
    };
    console.log(JSON.stringify(output, null, 2));
    if (!models.ok || !chat.ok || chat.text?.match(/56088/) == null || chat.trace?.some((item) => !item.ok)) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ code: error.code || "LIVE_SMOKE_FAILED", message: error.message }));
    process.exitCode = 1;
  } finally {
    service.clearConfig();
    app.quit();
  }
});
