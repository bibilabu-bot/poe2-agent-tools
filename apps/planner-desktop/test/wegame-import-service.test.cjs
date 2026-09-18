"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { createWeGameImportService, parseShareUrl } = require("../electron/wegame-import-service.cjs");
const validUrl = "https://www.wegame.com.cn/helper/poe2/#/share/Abc_def-123";
const ok = value => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
const tree = { nodes: { "1": { id: "one" } }, jewelSlots: [] };
test("accepts only the exact approved public-share URL shape", () => {
  assert.equal(parseShareUrl(validUrl).token, "Abc_def-123");
  for (const value of ["http://www.wegame.com.cn/helper/poe2/#/share/Abcdef12", "https://evil.test/helper/poe2/#/share/Abcdef12", "https://u@www.wegame.com.cn/helper/poe2/#/share/Abcdef12", "https://www.wegame.com.cn:444/helper/poe2/#/share/Abcdef12", "https://www.wegame.com.cn/helper/poe2/#/share/x", "https://www.wegame.com.cn/helper/poe2/extra#/share/Abcdef12"]) assert.throws(() => parseShareUrl(value), error => error.code === "WEGAME_INVALID_URL");
});
test("fetches only role identity then talent tree and sends no credentials", async () => {
  const calls = [];
  const service = createWeGameImportService({ fetch: async (url, options) => { calls.push({ url, options, body: JSON.parse(options.body) }); return calls.length === 1 ? ok({ result: { error_code: 0 }, role: { area: 0, openid: "role-open", role_id: "role-id", class_name: "Unknown" } }) : ok({ result: { error_code: 0 }, talent_tree: { hashes: [1], specialisations: {}, skill_overrides: {} } }); }, loadOfficialTree: async () => tree });
  const result = await service.importFromUrl(validUrl);
  assert.equal(result.ok, true); assert.equal(calls.length, 2); assert.match(calls[0].url, /GetRoleInfo$/); assert.match(calls[1].url, /GetTalentTree$/);
  assert.equal(calls[0].options.credentials, "omit"); assert.equal(calls[0].options.headers.cookie, undefined); assert.equal(calls[0].options.headers.authorization, undefined); assert.equal(calls[0].body.openid, null); assert.equal(calls[1].body.openid, "role-open");
});
test("returns stable failures for redirect, HTTP, content type, size, JSON and business errors", async () => {
  const cases = [[() => new Response(null, { status: 302, headers: { location: "https://evil.test/no" } }), "WEGAME_REDIRECT_REJECTED"], [() => new Response("x", { status: 503, headers: { "content-type": "text/plain" } }), "WEGAME_HTTP_ERROR"], [() => new Response("x", { status: 200, headers: { "content-type": "text/plain" } }), "WEGAME_CONTENT_TYPE_ERROR"], [() => new Response("{}", { status: 200, headers: { "content-type": "application/json", "content-length": "999999" } }), "WEGAME_RESPONSE_TOO_LARGE"], [() => new Response("{", { status: 200, headers: { "content-type": "application/json" } }), "WEGAME_INVALID_JSON"], [() => ok({ result: { error_code: 9 } }), "WEGAME_BUSINESS_ERROR"]];
  for (const [fetch, code] of cases) { const result = await createWeGameImportService({ fetch, loadOfficialTree: async () => tree }).importFromUrl(validUrl); assert.equal(result.error.code, code); }
});
test("timeout aborts and concurrent calls are rejected", async () => {
  const fetch = (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  const service = createWeGameImportService({ fetch, loadOfficialTree: async () => tree, timeoutMs: 10 });
  const first = service.importFromUrl(validUrl), busy = await service.importFromUrl(validUrl); assert.equal(busy.error.code, "WEGAME_BUSY"); assert.equal((await first).error.code, "WEGAME_TIMEOUT");
});
test("timeout remains active while the response body is stalled", async () => {
  const fetch = async (_url, { signal }) => new Response(new ReadableStream({ start(controller) { signal.addEventListener("abort", () => controller.error(Object.assign(new Error("aborted"), { name: "AbortError" }))); } }), { status: 200, headers: { "content-type": "application/json" } });
  const result = await createWeGameImportService({ fetch, loadOfficialTree: async () => tree, timeoutMs: 10 }).importFromUrl(validUrl);
  assert.equal(result.error.code, "WEGAME_TIMEOUT");
});
