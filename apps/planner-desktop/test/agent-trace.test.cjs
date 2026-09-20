"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeTrace, memoryPath, resultSections, formatToolDuration } = require("../renderer/agent-trace.js");

test("RAG details expose candidate rerank and original evidence paths", () => {
  const row = { name: "search_passive_nodes", ok: true, result: JSON.stringify({candidate_count:30,matches:[{id:"901"}]}) };
  assert.match(memoryPath(row, []), /30 个候选 → 重排序 → 节点：901/);
  assert.match(memoryPath({...row,name:"read_passive_nodes",result:JSON.stringify({nodes:[{id:"901"}],version:"v1"})}, []), /保留条件及限制/);
});

test("tool duration distinguishes sub-millisecond, seconds and absent legacy timing", () => {
  assert.equal(formatToolDuration(0), "<1 ms");
  assert.equal(formatToolDuration(0.453), "<1 ms");
  assert.equal(formatToolDuration(4), "4 ms");
  assert.equal(formatToolDuration(1540), "1.54 秒");
  assert.equal(formatToolDuration(null), "耗时未记录");
});

test("complete memory renders indented JSON without outer escaping or modifying wire data", () => {
  const records = [{ turn_id: 14, messages: [{ role: "user", content: '中文🙂 C:\\notes\\a.txt\n他说"你好"' }] }];
  const result = JSON.stringify({ format: "json_text_fragment", offset: 0, complete: true, text: JSON.stringify(records) });
  const row = normalizeTrace([{ name: "read_memory", result, ok: true }])[0];
  const original = row.result;
  const sections = resultSections(row);
  assert.equal(sections.length, 2);
  assert.match(sections[1][0], /已解析/);
  assert.match(sections[1][1], /\n  \{\n    "turn_id": 14,/);
  assert.deepEqual(JSON.parse(sections[1][1]), records);
  assert.ok(!sections[1][1].includes('\\"turn_id\\"'));
  assert.equal(row.result, original);
});

test("partial or malformed memory remains a clearly labeled literal fragment", () => {
  for (const [complete, offset] of [[false, 0], [true, 1500]]) {
    const text = '[{"turn_id":14,"messages":';
    const sections = resultSections({ name: "read_memory", result: JSON.stringify({ format: "json_text_fragment", text, complete, offset }) });
    assert.match(sections[1][0], /片段/);
    assert.equal(sections[1][1], text);
  }
  assert.equal(resultSections({ name: "read_memory", result: "truncated" })[0][1], "truncated");
});

test("trace preserves arguments, timing and paged-memory result shape", () => {
  const trace = normalizeTrace([{ name: "read_memory", ok: true, callId: "r", durationMs: 3,
    arguments: '{"start_turn_id":2,"count":2}', result: JSON.stringify({ text: '[{"turn_id":2}]', turn_ids: [2, 3], complete: false, next_offset: 1500 }) }]);
  assert.equal(JSON.parse(trace[0].arguments).count, 2);
  assert.equal(typeof JSON.parse(trace[0].result).text, "string");
  assert.equal(trace[0].durationMs, 3);
  assert.match(memoryPath(trace[0], []), /下一页 offset=1500/);
  assert.match(memoryPath(trace[0], []), /直接按轮次读取/);
});
test("display trace redacts sensitive fields and configured key without mutating originals", () => {
  const original = [{ name: "demo", arguments: '{"apiKey":"different","safe":"private-key"}', result: '{"text":"{\"password\":\"hidden\"}"}', ok: false }];
  original[0].result = JSON.stringify({ text: JSON.stringify({ password: "hidden" }), authorization: "Bearer x" });
  const snapshot = JSON.stringify(original);
  const text = JSON.stringify(normalizeTrace(original, "private-key"));
  for (const secret of ["different", "private-key", "hidden", "Bearer x"]) assert.ok(!text.includes(secret));
  assert.equal(JSON.stringify(original), snapshot);
  const variants = Object.fromEntries(["token", "session_token", "clientSecret", "cookie", "credential", "OPENAI_API_KEY", "proxy-authorization"].map(key => [key, "must-hide"]));
  assert.ok(!JSON.stringify(normalizeTrace([{ name: "demo", arguments: JSON.stringify(variants) }])).includes("must-hide"));
});
test("memory links only identify overlap with actual earlier search results", () => {
  const rows = normalizeTrace([
    { name: "search_memory", ok: true, result: '{"matches":[{"turn_id":7}],"metadata_only":true}' },
    { name: "read_memory", ok: true, result: '{"turn_ids":[7,8],"offset":0,"complete":true}' },
  ]);
  assert.match(memoryPath(rows[1], [rows[0]]), /前序搜索的命中轮次/);
  assert.match(memoryPath(rows[1], [rows[0]]), /不代表模型决策因果/);
  assert.doesNotMatch(memoryPath(rows[1], [{ ...rows[0], ok: false }]), /前序搜索/);
});
test("legacy and oversized traces degrade explicitly within display bounds", () => {
  const legacy = normalizeTrace([{ name: "calculator", result: "12", ok: true }])[0];
  assert.equal(legacy.durationMs, null);
  assert.match(legacy.arguments, /旧记录/);
  const large = normalizeTrace(Array.from({ length: 20 }, () => ({ name: "demo", arguments: "x".repeat(16000), result: "y".repeat(8000) })));
  assert.equal(large.length, 12);
  assert.ok(JSON.stringify(large).length < 28000);
  assert.ok(large.reduce((sum, row) => sum + row.arguments.length + row.result.length, 0) <= 24000);
  assert.ok(large.some(r => (r.arguments + r.result).includes("展示已截断")));
});
