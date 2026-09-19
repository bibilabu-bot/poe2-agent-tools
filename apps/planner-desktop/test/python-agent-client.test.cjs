"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { PythonAgentClient } = require("../electron/python-agent-client.cjs");
const { AgentService } = require("../electron/agent-service.cjs");

test("Electron bridge starts the isolated Python runtime and correlates requests", async (context) => {
  const client = new PythonAgentClient();
  context.after(() => client.terminate());
  const [first, second] = await Promise.all([
    client.request("status"),
    client.request("status"),
  ]);
  assert.deepEqual(first, { configured: false, baseUrl: null });
  assert.deepEqual(second, first);
  assert.deepEqual(await client.request("reset"), { ok: true });
  client.terminate();
  assert.deepEqual(await client.request("status"), first);
});

test("real Python process preserves completed UTF-8 history across cancel and rejects partial SSE errors", async (context) => {
  const observed = [];
  let releaseCancelledStart;
  const cancelledStarted = new Promise((resolve) => { releaseCancelledStart = resolve; });
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const messages = body.messages || [];
    const lastUser = [...messages].reverse().find((message) => message.role === "user")?.content;
    observed.push({ lastUser, messages });
    if (lastUser === "请取消这一轮🛑" || lastUser === "请让这一轮超时⌛") {
      if (lastUser === "请取消这一轮🛑") releaseCancelledStart();
      setTimeout(() => {
        if (!response.destroyed) response.end(JSON.stringify({ choices: [{ message: { content: "不应提交" } }] }));
      }, 1_500);
      return;
    }
    if (lastUser === "触发部分输出错误") {
      response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
      response.write('data: {"choices":[{"delta":{"content":"不应保留的部分输出"}}]}\n\n');
      response.write('event: error\ndata: {"message":"mock stream failure"}\n\n');
      response.end("data: [DONE]\n\n");
      return;
    }
    const content = lastUser === "第一轮：你好🙂" ? "第一轮完成：中文🚀" : "继续成功";
    const raw = Buffer.from(JSON.stringify({ choices: [{ message: { content } }] }), "utf8");
    response.writeHead(200, { "content-type": "application/json; charset=utf-8", "content-length": raw.length });
    response.end(raw);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const client = new PythonAgentClient();
  const service = new AgentService({ client, runTimeoutMs: 10_000 });
  context.after(() => client.terminate());
  await service.configure({ baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: "synthetic-secret" });

  const first = await service.send({ model: "mock", text: "第一轮：你好🙂", toolsEnabled: false });
  assert.equal(first.text, "第一轮完成：中文🚀");

  const cancelledPromise = service.send({ model: "mock", text: "请取消这一轮🛑", toolsEnabled: false });
  await cancelledStarted;
  service.cancel();
  const cancelled = await cancelledPromise;
  assert.equal(cancelled.ok, false);

  const continued = await service.send({ model: "mock", text: "取消后继续✨", toolsEnabled: false });
  assert.equal(continued.text, "继续成功");
  const continuedRequest = observed.find((entry) => entry.lastUser === "取消后继续✨");
  assert.ok(continuedRequest.messages.some((message) => message.content === "第一轮：你好🙂"));
  assert.ok(continuedRequest.messages.some((message) => message.content === "第一轮完成：中文🚀"));
  assert.ok(!continuedRequest.messages.some((message) => message.content === "请取消这一轮🛑"));

  service.runTimeoutMs = 700;
  const timedOut = await service.send({ model: "mock", text: "请让这一轮超时⌛", toolsEnabled: false });
  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.error.code, "RUN_TIMEOUT");
  service.runTimeoutMs = 10_000;
  const afterTimeout = await service.send({ model: "mock", text: "超时后继续", toolsEnabled: false });
  assert.equal(afterTimeout.ok, true);
  const afterTimeoutRequest = observed.find((entry) => entry.lastUser === "超时后继续");
  assert.ok(afterTimeoutRequest.messages.some((message) => message.content === "取消后继续✨"));
  assert.ok(!afterTimeoutRequest.messages.some((message) => message.content === "请让这一轮超时⌛"));

  client.terminate();
  const afterRestart = await service.send({ model: "mock", text: "重启后继续", toolsEnabled: false });
  assert.equal(afterRestart.ok, true);
  const afterRestartRequest = observed.find((entry) => entry.lastUser === "重启后继续");
  assert.ok(afterRestartRequest.messages.some((message) => message.content === "超时后继续"));

  const failed = await service.send({ model: "mock", text: "触发部分输出错误", toolsEnabled: false });
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, "PROVIDER_STREAM_ERROR");
  const afterError = await service.send({ model: "mock", text: "错误后继续", toolsEnabled: false });
  assert.equal(afterError.ok, true);
  const afterErrorRequest = observed.find((entry) => entry.lastUser === "错误后继续");
  assert.ok(!afterErrorRequest.messages.some((message) => message.content === "触发部分输出错误"));
  assert.ok(!afterErrorRequest.messages.some((message) => message.content === "不应保留的部分输出"));
});
