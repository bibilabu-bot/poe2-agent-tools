"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

async function main() {
const endpoint = process.env.P2AT_CDP_ENDPOINT || "http://127.0.0.1:9222";
const testMessage = process.env.P2AT_UI_SMOKE_MESSAGE || "请只回答：56088";
const expectedText = process.env.P2AT_UI_SMOKE_EXPECTED || "56088";
const expectedError = process.env.P2AT_UI_EXPECT_ERROR || "";
const restoredText = process.env.P2AT_UI_EXPECT_RESTORED_TEXT || "";
const testMissingModel = process.env.P2AT_UI_SMOKE_PRE_MISSING_MODEL === "1";
const pages = await fetch(`${endpoint}/json/list`).then((response) => response.json());
const page = pages.find((candidate) => candidate.type === "page" && candidate.url?.endsWith("/renderer/index.html"));
if (!page) throw new Error("planner page was not found");

const socket = new WebSocket(page.webSocketDebuggerUrl);
try {
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
if (process.env.P2AT_UI_SMOKE_MODEL) {
  await evaluate(`document.getElementById('agentModel').value = ${JSON.stringify(process.env.P2AT_UI_SMOKE_MODEL)}`);
}
if (process.env.P2AT_UI_REQUIRE_TOOL === "1") {
  await evaluate("document.getElementById('agentToolsEnabled').checked = true; true");
}
if (restoredText) {
  await waitFor(`(() => [...document.querySelectorAll('#agentMessages .agent-message')].some((item) => item.textContent.includes(${JSON.stringify(restoredText)})))()`);
}
if (testMissingModel) {
  await evaluate(`(() => {
    const model = document.getElementById('agentModel'); model.dataset.smokeValue = model.value; model.value = '';
    const input = document.getElementById('agentInput'); input.value = 'this must not persist';
    document.getElementById('agentComposer').requestSubmit(); model.value = model.dataset.smokeValue; return true;
  })()`);
  await waitFor(`document.querySelector('#agentMessages .agent-message.error')?.textContent.includes('尚未选择模型')`);
}
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
    toolTrace: [...document.querySelectorAll('#agentMessages .agent-activity')].at(-1)?.textContent || '',
    sendDisabled: document.getElementById('agentSend').disabled,
  };
})()`, 130_000);
const lastMessage = completed.messages.at(-1);
const visibleResult = await evaluate(`(() => {
  const el = [...document.querySelectorAll('#agentMessages .agent-message')].at(-1);
  if (!el) return false;
  const s = getComputedStyle(el), r = el.getBoundingClientRect();
  return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
})()`);
if (!visibleResult) throw new Error("Last response exists but is not visible");
if (!lastMessage?.role.includes(expectedError ? "error" : "assistant") || !lastMessage.text.includes(expectedError || expectedText)) {
  throw new Error(`live UI chat failed: ${JSON.stringify(lastMessage)}`);
}
const expectedTool = process.env.P2AT_UI_EXPECT_TOOL || (process.env.P2AT_UI_REQUIRE_TOOL === "1" ? "calculator" : "");
if (expectedTool && !completed.toolTrace.includes(expectedTool)) {
  throw new Error("Expected tool trace was not displayed");
}
if (expectedTool) {
  const expanded = await evaluate(`(() => {
    const activity = [...document.querySelectorAll('#agentMessages .agent-activity')].at(-1);
    const details = [...activity.querySelectorAll('details.agent-operation')].find(d => d.querySelector('summary').textContent.includes(${JSON.stringify(expectedTool)}));
    if (!details || details.open) return false;
    details.querySelector('summary').click();
    return details.open && details.querySelector('pre').getBoundingClientRect().height > 0 && details.textContent.includes('传参');
  })()`);
  if (!expanded) throw new Error("Tool details did not expand visibly");
}
const activity = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('#agentMessages .agent-activity')];
  const last = rows.at(-1);
  return last ? { className: last.className, text: last.textContent, visible: getComputedStyle(last).display !== 'none' && last.getBoundingClientRect().height > 0 } : null;
})()`);
if (!activity?.visible || !activity.className.includes(expectedError ? "error" : "done") || !activity.text.includes(expectedError ? "处理失败" : "已收到模型回复")) throw new Error(`activity timeline missing: ${JSON.stringify(activity)}`);
const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
const screenshotPath = path.join(os.tmpdir(), "p2at-agent-ui-e2e.png");
await fs.writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
socket.close();
process.stdout.write(JSON.stringify({ ready, model: completed.model, toolTrace: completed.toolTrace, lastMessage, screenshotPath }, null, 2));
} finally { socket.close(); }
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
