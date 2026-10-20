const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const http = require("node:http");
const { createPlannerServer, loadOfficialTree } = require("../server.cjs");
const token = "test-only-token-not-for-deployment-12345";

async function fixture(t, options = {}) {
  const app = await createPlannerServer({ token, port: 0, ...options });
  t.after(() => app.close());
  const post = (route, body, extra = {}) => fetch(`${app.origin}${route}`, {
    method: "POST", headers: { origin: app.origin, "content-type": "application/json", ...extra },
    body: JSON.stringify(body),
  });
  return { ...app, post };
}

test("health and manifest expose metadata only; static allowlist denies private files", async t => {
  const app = await fixture(t);
  assert.deepEqual(await (await fetch(`${app.origin}/health`)).json(), { ok: true });
  const manifest = await (await fetch(`${app.origin}/api/resource-manifest`)).json();
  assert.ok(manifest.resources.length >= 8);
  for (const item of manifest.resources) {
    assert.equal(item.sha256.length, 64);
    assert.equal(item.url, undefined);
  }
  assert.equal((await fetch(`${app.origin}/`)).status, 200);
  for (const url of ["/data/cache/official-data.json", "/electron/main.cjs", "/.env", "/python_agent/config.py", "/src/agent-core/base-agent.js"]) {
    assert.equal((await fetch(app.origin + url)).status, 404);
  }
});

test("anonymous, cross-origin, foreign Host and missing Origin are rejected", async t => {
  const app = await fixture(t);
  assert.equal((await app.post("/api/wegame", { url: "https://example.com" })).status, 401);
  assert.equal((await app.post("/api/login", { token }, { origin: "https://evil.invalid" })).status, 403);
  const foreignHostStatus = await new Promise((resolve, reject) => {
    http.get(`${app.origin}/health`, { headers: { host: "evil.invalid" } }, response => {
      response.resume(); resolve(response.statusCode);
    }).on("error", reject);
  });
  assert.equal(foreignHostStatus, 403);
  assert.equal((await fetch(`${app.origin}/api/login`, { method: "POST", body: JSON.stringify({ token }) })).status, 403);
  assert.equal((await app.post("/api/login", { token: "wrong" })).status, 401);
});

test("session cookie required; missing mapping is actionable without outbound requests", async t => {
  let calls = 0;
  const app = await fixture(t, { fetch: async () => { calls++; throw new Error("must not call"); } });
  const login = await app.post("/api/login", { token });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly; SameSite=Strict/);
  const response = await app.post("/api/wegame", { url: "https://www.wegame.com.cn/helper/poe2/#/share/abcdefgh" }, { cookie: setCookie.split(";")[0] });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "RESOURCE_NOT_FOUND");
  assert.equal(calls, 0);
});

test("body bound and login rate bound", async t => {
  const app = await fixture(t);
  assert.equal((await app.post("/api/login", { token: "a".repeat(5000) })).status, 413);
  for (let n = 0; n < 9; n++) await app.post("/api/login", { token: "wrong" });
  assert.equal((await app.post("/api/login", { token })).status, 429);
});

test("mapping is loaded locally with size and SHA checks; no fallback", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "planner-browser-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "official.json");
  const bytes = Buffer.from('{"nodes":{}}');
  const descriptor = { bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
  await fs.writeFile(file, bytes);
  assert.deepEqual(await loadOfficialTree(file, descriptor), { nodes: {} });
  await assert.rejects(loadOfficialTree(file, { ...descriptor, sha256: "0".repeat(64) }), /SHA-256/);
  await assert.rejects(loadOfficialTree(file, { ...descriptor, bytes: bytes.length + 1 }), /byte count/);
  await assert.rejects(createPlannerServer({ token, port: 0, officialTreePath: file }), /byte count/);
});

test("startup requires explicit strong token and local binding", async () => {
  await assert.rejects(createPlannerServer({ port: 0 }), /PLANNER_ACCESS_TOKEN/);
  await assert.rejects(createPlannerServer({ token, host: "0.0.0.0", port: 0 }), /container mode/);
});
