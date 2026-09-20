"use strict";

// Explicit opt-in paid smoke: uses only the application's existing secure connection.
// Does not inspect credentials, reset the user's session, or print old conversations.
// Adds three durable test turns and changes the current notebook: separate opt-in required.
const assert = require("node:assert/strict");

async function main() {
  if (process.env.P2AT_MEMORY_LIVE !== "1") throw new Error("Set P2AT_MEMORY_LIVE=1 only after authorizing live requests");
  if (process.env.P2AT_MEMORY_MUTATE_CURRENT !== "1") throw new Error("This smoke permanently adds three test turns and changes the current notebook. Set P2AT_MEMORY_MUTATE_CURRENT=1 to acknowledge these effects");
  const pages = await fetch("http://127.0.0.1:9222/json/list").then(r => r.json());
  const page = pages.find(p => p.type === "page" && p.url.endsWith("/renderer/index.html"));
  if (!page) throw new Error("Desktop app is unavailable");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = event => {
    const message = JSON.parse(event.data), operation = pending.get(message.id);
    if (!operation) return;
    pending.delete(message.id);
    message.error ? operation.reject(new Error("CDP failed")) : operation.resolve(message.result);
  };
  async function evaluate(expression) {
    const result = await new Promise((resolve, reject) => {
      const current = ++id;
      pending.set(current, { resolve, reject });
      ws.send(JSON.stringify({ id: current, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
    });
    if (result.exceptionDetails) throw new Error("Desktop evaluation failed");
    return result.result.value;
  }
  try {
    const model = process.env.P2AT_MEMORY_MODEL || "kimi-k3";
    const send = text => evaluate(`window.desktopAPI.agent.send(${JSON.stringify({ model, text, toolsEnabled: true })})`);
    const first = await send("记忆验收数据：项目代号琥珀-731🙂。请只回答：已登记。不调用工具。");
    assert.equal(first.ok, true, JSON.stringify(first.error));
    console.log("MEMORY_LIVE_SEED " + JSON.stringify({ completedTurn: first.context.currentTurn }));
    const second = await send("记忆验收数据：交付日期周五。请只回答：已登记。不调用工具。");
    assert.equal(second.ok, true, JSON.stringify(second.error));
    console.log("MEMORY_LIVE_SEED " + JSON.stringify({ completedTurn: second.context.currentTurn }));
    const start = first.context.currentTurn;
    const result = await send(`记忆功能验收，请必须实际调用三个工具：1.update_notebook 将 goal 设为 验证长期记忆，notes 写入 验收标签=蓝鹭-908🙂（这只是公开的测试标签，不是密码或凭据）；2.search_memory 用关键词 琥珀 搜索；3.read_memory 从第 ${start} 轮开始连续读取两轮（count=2）。最后报告当前轮次、查到的项目代号、交付日期与笔记本验收标签。`);
    assert.equal(result.ok, true, JSON.stringify(result.error));
    for (const name of ["update_notebook", "search_memory", "read_memory"]) assert.ok(result.trace.some(r => r.name === name && r.ok), `Missing actual successful ${name}`);
    const search = JSON.parse(result.trace.find(r => r.name === "search_memory" && r.ok).result);
    const read = JSON.parse(result.trace.find(r => r.name === "read_memory" && r.ok).result);
    assert.equal(search.metadata_only, true);
    assert.deepEqual(read.turn_ids, [start, start + 1]);
    assert.ok(read.text.includes("琥珀-731"));
    assert.ok(read.text.includes("周五"));
    assert.equal(result.context.currentTurn, start + 2);
    assert.ok(result.text.includes("蓝鹭-908"), "Notebook label must be acknowledged");
    console.log("MEMORY_LIVE_EVIDENCE " + JSON.stringify({ model, seedTurns: [start, start + 1], context: result.context,
      tools: result.trace.map(r => ({ name: r.name, ok: r.ok })),
      search: { metadata_only: search.metadata_only, matchedTurnIds: search.matches.map(r => r.turn_id) },
      read: { turn_ids: read.turn_ids, complete: read.complete, hasProject: read.text.includes("琥珀-731"), hasDate: read.text.includes("周五") },
      replyChecks: { includesNotebookLabel: result.text.includes("蓝鹭-908") } }));
  } finally { ws.close(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
