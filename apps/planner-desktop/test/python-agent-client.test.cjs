"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { PythonAgentClient } = require("../electron/python-agent-client.cjs");

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
