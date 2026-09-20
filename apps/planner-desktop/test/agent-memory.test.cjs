"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PythonAgentClient } = require("../electron/python-agent-client.cjs");
const { AgentService } = require("../electron/agent-service.cjs");

test("durable memory: four strategies, UTF-8, restart, cancellation and SSE rollback in a real child", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "p2at-memory-"));
  const memoryPath = path.join(directory, "archive.sqlite3");
  const observed = [];
  let notifyBlocked;
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const memory = JSON.parse(body.messages.find(m => m.content?.startsWith("[MEMORY_CONTEXT_DATA]\n")).content.split("\n").slice(1).join("\n"));
    const lastUser = body.messages.findLast(m => m.role === "user").content;
    observed.push({ memory, body, lastUser });
    const afterTools = body.messages.at(-1).role === "tool";
    const call = (name, args) => ({ id: name, type: "function", function: { name, arguments: JSON.stringify(args) } });
    if ((lastUser === "取消笔记" || lastUser === "错误笔记") && afterTools) {
      if (lastUser === "取消笔记") { notifyBlocked(); return; }
      response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
      response.end('data: {"choices":[{"delta":{"content":"不可提交的部分输出"}}]}\n\nevent: error\ndata: {"message":"synthetic failure"}\n\n');
      return;
    }
    let message = { content: "完成🙂" };
    if (!afterTools && lastUser === "四项验收") {
      message = { content: "", tool_calls: [
        call("update_notebook", { goal: "验证长期记忆", notes: { 验收口令: "蓝鹭-908🙂" } }),
        call("search_memory", { query: "琥珀" }),
        call("read_memory", { start_turn_id: 1, count: 2 }),
      ] };
    } else if (!afterTools && ["取消笔记", "错误笔记"].includes(lastUser)) {
      message = { content: "", tool_calls: [call("update_notebook", { goal: "不应落盘" })] };
    }
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ choices: [{ message }] }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let client = new PythonAgentClient({ memoryPath });
  t.after(async () => {
    client.terminate();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    // Only this test's freshly-created temporary directory.
    await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const config = { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: "synthetic-memory-test-key" };
  let service = new AgentService({ client });
  await service.configure(config);
  const history = [
    { role: "user", content: "项目代号：琥珀-731🙂" }, { role: "assistant", content: "已登记" },
    { role: "user", content: "交付日期：周五" }, { role: "assistant", content: "已登记" },
  ];
  for (let i = 0; i < 4; i++) history.push({ role: "user", content: `长记录${i}` }, { role: "assistant", content: "中".repeat(30000) });
  await client.request("restore", { history });
  const result = await service.send({ model: "mock", text: "四项验收", toolsEnabled: false });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.deepEqual(observed[0].memory.directory.map(r => r.turn_id), [1, 2, 3, 4, 5, 6]);
  assert.ok(observed[0].memory.directory.every(r => typeof r.summary === "string" && r.summary.length > 0));
  assert.equal(observed[0].memory.current_turn, 7);
  assert.ok(!observed[0].body.messages.some(m => m.content === history[0].content));
  assert.ok(result.context.totalHistoryChars <= 100000);
  assert.equal(observed[1].memory.notebook.notes.验收口令, "蓝鹭-908🙂");
  assert.equal(result.trace.length, 3);
  assert.ok(result.trace.every(r => r.ok));
  assert.equal(JSON.parse(result.trace[1].arguments).query, "琥珀");
  assert.ok(result.trace.every(r => Number.isFinite(r.durationMs) && r.durationMs >= 0));
  const search = JSON.parse(result.trace[1].result);
  const read = JSON.parse(result.trace[2].result);
  assert.equal(search.metadata_only, true);
  assert.equal(search.matches[0].turn_id, 1);
  assert.equal(Object.hasOwn(search.matches[0], "messages"), false);
  assert.deepEqual(read.turn_ids, [1, 2]);
  assert.deepEqual(JSON.parse(read.text).flatMap(r => r.messages), history.slice(0, 4));
  console.log("MEMORY_CHILD_EVIDENCE " + JSON.stringify({
    directory: { current_turn: observed[0].memory.current_turn, turn_ids: observed[0].memory.directory.map(r => r.turn_id), first_entry: observed[0].memory.directory[0], old_raw_turn_excluded: true },
    notebook_next_model_input: observed[1].memory.notebook,
    search_tool_result: search, read_tool_result: read,
  }));

  // New JS service AND new child: no in-process history survives.
  client.terminate();
  client = new PythonAgentClient({ memoryPath });
  service = new AgentService({ client });
  await service.configure(config);
  assert.equal((await service.send({ model: "mock", text: "重启后验证" })).ok, true);
  assert.equal(observed.at(-1).memory.current_turn, 8);
  assert.equal(observed.at(-1).memory.notebook.notes.验收口令, "蓝鹭-908🙂");
  const blocked = new Promise(resolve => { notifyBlocked = resolve; });
  const pending = service.send({ model: "mock", text: "取消笔记" });
  await blocked;
  service.cancel();
  assert.equal((await pending).ok, false);
  assert.equal((await service.send({ model: "mock", text: "取消后继续" })).ok, true);
  assert.equal(observed.at(-1).memory.current_turn, 9);
  assert.equal(observed.at(-1).memory.notebook.goal, "验证长期记忆");
  const failed = await service.send({ model: "mock", text: "错误笔记" });
  assert.equal(failed.error.code, "PROVIDER_STREAM_ERROR");
  assert.equal((await service.send({ model: "mock", text: "错误后继续" })).ok, true);
  assert.equal(observed.at(-1).memory.current_turn, 10);
  assert.equal(observed.at(-1).memory.notebook.revision, 1);
  assert.ok(!observed.at(-1).body.messages.some(m => m.content?.includes("不可提交的部分输出")));
  assert.ok(!fs.readFileSync(memoryPath).includes(Buffer.from(config.apiKey)));
  console.log("MEMORY_RECOVERY_EVIDENCE " + JSON.stringify({ restartCurrentTurn: 8, afterCancelCurrentTurn: 9, afterSseErrorCurrentTurn: 10, notebookRevision: observed.at(-1).memory.notebook.revision, credentialsAbsent: true }));
});
