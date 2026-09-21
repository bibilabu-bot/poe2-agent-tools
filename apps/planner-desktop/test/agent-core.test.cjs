"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { AgentRunner } = require("../src/agent-core/agent-runner.js");
const { ChatAgent } = require("../src/agent-core/base-agent.js");
const { ToolRegistry } = require("../src/agent-core/tool-registry.js");
const { ArithmeticFixtureTool } = require("./helpers/arithmetic-fixture.cjs");
const { BaseTool } = require("../src/agent-core/base-tool.js");

class QueueProvider {
  constructor(responses) { this.responses = responses; this.requests = []; }
  async complete(request) { this.requests.push(structuredClone({ ...request, signal: undefined })); return this.responses.shift(); }
}

function call(id, name, args) { return { id, name, arguments: typeof args === "string" ? args : JSON.stringify(args) }; }
function runner(provider, tools = [new ArithmeticFixtureTool()], limits) { return new AgentRunner({ provider, registry: new ToolRegistry(tools), limits }); }
const agent = new ChatAgent({ systemPrompt: "Test-only instruction for protocol accounting." });

test("plain multi-turn chat completes without tools", async () => {
  const provider = new QueueProvider([{ content: "hello", toolCalls: [] }]);
  const result = await runner(provider).run({ agent, history: [{ role: "user", content: "hi" }], model: "m" });
  assert.equal(result.text, "hello"); assert.equal(result.rounds, 1); assert.equal(result.toolCalls, 0);
});

test("single fixture_arithmetic call is paired by call ID before the model continues", async () => {
  const provider = new QueueProvider([{ content: "", toolCalls: [call("c1", "fixture_arithmetic", { operator: "multiply", a: 12, b: 3 })] }, { content: "36", toolCalls: [] }]);
  const result = await runner(provider).run({ agent, history: [{ role: "user", content: "12*3" }], model: "m" });
  const second = provider.requests[1].messages;
  assert.equal(second.at(-1).tool_call_id, "c1"); assert.match(second.at(-1).content, /36/); assert.equal(result.text, "36");
});

test("multiple tool calls execute in declared order", async () => {
  const order = [];
  class OrderedTool extends BaseTool { constructor() { super({ name: "ordered", description: "record order", parameters: { type: "object", required: ["value"], additionalProperties: false, properties: { value: { type: "number" } } } }); } async execute({ value }) { order.push(value); return value; } }
  const provider = new QueueProvider([{ content: "", toolCalls: [call("a", "ordered", { value: 1 }), call("b", "ordered", { value: 2 })] }, { content: "done", toolCalls: [] }]);
  await runner(provider, [new OrderedTool()]).run({ agent, history: [], model: "m" });
  assert.deepEqual(order, [1, 2]); assert.deepEqual(provider.requests[1].messages.slice(-2).map((m) => m.tool_call_id), ["a", "b"]);
});

for (const [name, toolCall, expected] of [
  ["unknown tool", call("x", "shell", {}), "failed safely"],
  ["bad JSON", call("x", "fixture_arithmetic", "{"), "valid JSON"],
  ["schema violation", call("x", "fixture_arithmetic", { operator: "add", a: 1 }), "required"],
]) test(`${name} becomes a controlled tool result`, async () => {
  const provider = new QueueProvider([{ content: "", toolCalls: [toolCall] }, { content: "handled", toolCalls: [] }]);
  const result = await runner(provider).run({ agent, history: [], model: "m" });
  assert.equal(result.trace[0].ok, false); assert.match(result.trace[0].result, new RegExp(expected)); assert.equal(result.text, "handled");
});

test("tool exceptions become controlled results", async () => {
  class BrokenTool extends BaseTool { constructor() { super({ name: "broken", description: "fails safely", parameters: { type: "object", additionalProperties: false, properties: {} } }); } async execute() { throw new Error("boom"); } }
  const provider = new QueueProvider([{ content: "", toolCalls: [call("x", "broken", {})] }, { content: "recovered", toolCalls: [] }]);
  const result = await runner(provider, [new BrokenTool()]).run({ agent, history: [], model: "m" });
  assert.match(result.trace[0].result, /failed safely/); assert.doesNotMatch(result.trace[0].result, /boom/);
});

test("oversized or duplicate tool-call batches are bounded before entering history", async () => {
  const huge = "x".repeat(20_000);
  const provider = new QueueProvider([{ content: "", toolCalls: [call("same", "fixture_arithmetic", huge), call("same", "fixture_arithmetic", {})] }, { content: "handled", toolCalls: [] }]);
  const result = await runner(provider).run({ agent, history: [], model: "m" });
  assert.ok(provider.requests[1].messages[1].tool_calls[0].function.arguments.length <= 16_385);
  assert.notEqual(provider.requests[1].messages[1].tool_calls[0].id, provider.requests[1].messages[1].tool_calls[1].id);
  assert.equal(result.trace.every((item) => item.ok === false), true);
  const tooMany = new QueueProvider([{ content: "", toolCalls: Array.from({ length: 13 }, (_, i) => call(`c${i}`, "fixture_arithmetic", {})) }]);
  await assert.rejects(() => runner(tooMany).run({ agent, history: [], model: "m" }), { code: "TOOL_CALL_LIMIT" });
});

test("model round and tool-call limits stop explicitly", async () => {
  const repeated = Array.from({ length: 4 }, (_, index) => ({ content: "", toolCalls: [call(`c${index}`, "fixture_arithmetic", { operator: "add", a: 1, b: 1 })] }));
  await assert.rejects(() => runner(new QueueProvider(repeated), undefined, { maxModelRounds: 2 }).run({ agent, history: [], model: "m" }), { code: "MODEL_ROUND_LIMIT" });
  await assert.rejects(() => runner(new QueueProvider(repeated), undefined, { maxToolCalls: 1 }).run({ agent, history: [], model: "m" }), { code: "TOOL_CALL_LIMIT" });
});

test("cancellation propagates and concurrent runs are rejected", async () => {
  let release;
  const provider = { complete: ({ signal }) => new Promise((resolve, reject) => { release = resolve; signal.addEventListener("abort", () => reject(signal.reason), { once: true }); }) };
  const instance = runner(provider); const controller = new AbortController();
  const first = instance.run({ agent, history: [], model: "m", signal: controller.signal });
  await assert.rejects(() => instance.run({ agent, history: [], model: "m" }), { code: "RUN_IN_PROGRESS" });
  controller.abort(new DOMException("cancelled", "AbortError")); await assert.rejects(first, { name: "AbortError" });
  release?.({ content: "late", toolCalls: [] });
});

test("a failed run does not prevent a later run", async () => {
  let count = 0; const provider = { complete: async () => { if (!count++) throw new Error("first"); return { content: "second", toolCalls: [] }; } };
  const instance = runner(provider); await assert.rejects(() => instance.run({ agent, history: [], model: "m" }));
  assert.equal((await instance.run({ agent, history: [], model: "m" })).text, "second");
});
