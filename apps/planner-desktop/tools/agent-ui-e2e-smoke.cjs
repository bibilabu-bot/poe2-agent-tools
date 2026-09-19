"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

async function main() {
const endpoint = process.env.P2AT_CDP_ENDPOINT || "http://127.0.0.1:9222";
const testMessage = process.env.P2AT_UI_SMOKE_MESSAGE || "请只回答：56088";
const pages = await fetch(`${endpoint}/json/list`).then((response) => response.json());
const page = pages.find((candidate) => candidate.type === "page" && candidate.url?.endsWith("/renderer/index.html"));
if (!page) throw new Error("planner page was not found");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
let sequence = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id); pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
});
function command(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function evaluate(expression) {
  const response = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || "renderer evaluation failed");
  return response.result.value;
}
async function waitFor(expression, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(expression);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for: ${expression}`);
}

await evaluate("document.getElementById('switchToAgent').click(); true");
const ready = await waitFor(`(() => {
  const model = document.getElementById('agentModel').value.trim();
  const status = document.getElementById('agentConnectionStatus').textContent;
  return model && status.includes('已连接') ? { model, status } : null;
})()`);
const beforeCount = await evaluate("document.querySelectorAll('#agentMessages .agent-message').length");
await evaluate(`(() => {
  const input = document.getElementById('agentInput');
  input.value = ${JSON.stringify(testMessage)};
  input.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('agentComposer').requestSubmit();
  return true;
})()`);
const completed = await waitFor(`(() => {
  const messages = [...document.querySelectorAll('#agentMessages .agent-message')];
  const runState = document.getElementById('agentRunState').textContent;
  if (messages.length <= ${beforeCount} || runState !== '空闲') return null;
  return {
    messages: messages.map((item) => ({ role: item.className, text: item.textContent })),
    model: document.getElementById('agentModel').value,
    connection: document.getElementById('agentConnectionStatus').textContent,
    modelStatus: document.getElementById('agentModelStatus').textContent,
    toolTrace: document.getElementById('agentToolLog').textContent,
    sendDisabled: document.getElementById('agentSend').disabled,
  };
})()`, 130_000);
const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
const screenshotPath = path.join(os.tmpdir(), "p2at-agent-ui-e2e.png");
await fs.writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
socket.close();
process.stdout.write(JSON.stringify({ ready, completed, screenshotPath }, null, 2));
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
