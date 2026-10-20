"use strict";

const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { createRuntimeResourceCatalog } = require("../planner-desktop/electron/runtime-resource-store.cjs");
const { createWeGameImportService } = require("../planner-desktop/electron/wegame-import-service.cjs");
const lock = require("../../data/upstream-sources.lock.json");
const cacheManifest = require("../planner-desktop/data/cache/manifest.json");
const desktop = path.resolve(__dirname, "../planner-desktop");
const catalog = createRuntimeResourceCatalog(lock, cacheManifest);
const resourceManifest = {
  snapshotId: lock.snapshotId,
  resources: [
    ...catalog.coreNames.map(name => catalog.resolve("data", name)),
    ...catalog.portraitNames.map(name => catalog.resolve("portrait", name)),
  ].map(({ id, kind, name, bytes, sha256 }) => ({ id, kind, name, bytes, sha256 })),
};
const rendererFiles = new Set([
  "index.html", "browser-platform.js", "stat-utils.js", "localization-engine.js",
  "build-codec.js", "build-state-adapter.js", "wegame-import-ui.js", "passive-graph.js",
  "refund-plan.js", "tree-snapshot.js", "semantic-topology.js", "semantic-preview.js",
  "layout-shell.js", "mastery-visual-state.js", "startup-video.css", "startup-video.js",
  "planner.js", "agent-trace.js", "agent-panel.js", "agent-panel.css",
  "retrieval-settings.js", "prompt-inspector.js", "prompt-editor.js",
]);
const interopFiles = new Set(["passive-id-map.js", "wegame-sensitive-fields.js", "wegame-import-adapter.js", "ggg-build-v1-contract.json"]);
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8" };
const failure = (code, message) => ({ ok: false, error: { code, message } });

async function loadOfficialTree(file, descriptor = catalog.resolve("data", "official-data.json")) {
  if (!file) return null;
  const handle = await fs.open(path.resolve(file), "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== descriptor.bytes) throw new Error("Official mapping does not match canonical byte count.");
    const bytes = await handle.readFile();
    if (crypto.createHash("sha256").update(bytes).digest("hex") !== descriptor.sha256) throw new Error("Official mapping does not match canonical SHA-256.");
    return JSON.parse(bytes.toString("utf8"));
  } finally { await handle.close(); }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || "")) {
      req.resume(); reject(Object.assign(new Error(), { status: 415 })); return;
    }
    let size = 0;
    const chunks = [];
    const timer = setTimeout(() => { reject(Object.assign(new Error(), { status: 408 })); req.resume(); }, 5000);
    timer.unref();
    req.on("data", chunk => {
      size += chunk.length;
      if (size > 4096) { clearTimeout(timer); reject(Object.assign(new Error(), { status: 413 })); }
      else chunks.push(chunk);
    });
    req.on("error", () => { clearTimeout(timer); reject(Object.assign(new Error(), { status: 400 })); });
    req.on("end", () => {
      clearTimeout(timer);
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
        resolve(value);
      } catch { reject(Object.assign(new Error(), { status: 400 })); }
    });
  });
}

async function createPlannerServer(options = {}) {
  const token = options.token;
  if (typeof token !== "string" || token.length < 32 || token.length > 256) throw new Error("Set PLANNER_ACCESS_TOKEN to a random 32–256 character secret.");
  const host = options.host || "127.0.0.1";
  if (host !== "127.0.0.1" && !(host === "0.0.0.0" && options.containerMode === true)) throw new Error("Non-loopback binding requires explicit container mode.");
  const officialTree = await loadOfficialTree(options.officialTreePath);
  const service = createWeGameImportService({ fetch: options.fetch || globalThis.fetch, loadOfficialTree: async () => officialTree });
  const tokenHash = crypto.createHash("sha256").update(token).digest();
  const sessions = new Map();
  let inFlight = 0;
  let attempts = 0;
  let attemptWindow = Date.now();
  let origin;
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' blob:; media-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const json = (status, value) => { res.writeHead(status, { "content-type": mime[".json"] }); res.end(JSON.stringify(value)); };
    if (req.headers.host !== new URL(origin).host) { json(403, failure("UNTRUSTED_HOST", "Host rejected.")); return; }
    if ((req.headers.origin && req.headers.origin !== origin) || req.headers["sec-fetch-site"] === "cross-site") { json(403, failure("UNTRUSTED_ORIGIN", "Origin rejected.")); return; }
    if (inFlight >= 8) { json(429, failure("BUSY", "Try again shortly.")); return; }
    inFlight++;
    try {
      const pathname = new URL(req.url, origin).pathname;
      if (req.method === "GET" && pathname === "/health") { json(200, { ok: true }); return; }
      if (req.method === "GET" && pathname === "/api/resource-manifest") { json(200, resourceManifest); return; }
      if (req.method === "POST" && ["/api/login", "/api/wegame"].includes(pathname)) {
        if (req.headers.origin !== origin) { json(403, failure("UNTRUSTED_ORIGIN", "Same-origin browser request required.")); return; }
        if (pathname === "/api/login") {
          if (Date.now() - attemptWindow > 60000) { attempts = 0; attemptWindow = Date.now(); }
          if (++attempts > 10) { json(429, failure("LOGIN_RATE_LIMIT", "Wait one minute before retrying login.")); return; }
          const body = await readJson(req);
          const valid = typeof body.token === "string" && body.token.length <= 256 &&
            crypto.timingSafeEqual(crypto.createHash("sha256").update(body.token).digest(), tokenHash);
          if (!valid) { json(401, failure("UNAUTHORIZED", "Access token rejected.")); return; }
          for (const [id, expiry] of sessions) if (expiry < Date.now()) sessions.delete(id);
          if (sessions.size >= 32) sessions.delete(sessions.keys().next().value);
          const session = crypto.randomBytes(32).toString("hex");
          sessions.set(session, Date.now() + 3600000);
          res.setHeader("Set-Cookie", `planner_session=${session}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=3600${origin.startsWith("https:") ? "; Secure" : ""}`);
          json(200, { ok: true }); return;
        }
        const session = /(?:^|;\s*)planner_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || "")?.[1];
        if (!session || !(sessions.get(session) > Date.now())) { json(401, failure("UNAUTHORIZED", "Log in to use WeGame import.")); return; }
        const body = await readJson(req);
        if (!officialTree) { json(503, failure("RESOURCE_NOT_FOUND", "Set PLANNER_OFFICIAL_TREE to the local canonical official-data.json and restart this local server.")); return; }
        json(200, await service.importFromUrl({ url: body.url })); return;
      }
      if (req.method !== "GET") { json(405, failure("METHOD_NOT_ALLOWED", "Method not allowed.")); return; }
      const name = pathname === "/" ? "index.html" : pathname.slice(1);
      let file;
      if (rendererFiles.has(name)) file = path.join(desktop, "renderer", name);
      const interopName = pathname.replace(/^\/src\/interop\//, "");
      if (pathname.startsWith("/src/interop/") && interopFiles.has(interopName)) file = path.join(desktop, "src/interop", interopName);
      if (!file) { json(404, failure("NOT_FOUND", "Not found.")); return; }
      const bytes = await fs.readFile(file);
      res.writeHead(200, { "content-type": mime[path.extname(file)] }); res.end(bytes);
    } catch (error) {
      json(error.status || 500, failure("REQUEST_FAILED", "Request failed safely."));
    } finally { inFlight--; }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.timeout = 15000;
  server.keepAliveTimeout = 5000;
  server.maxConnections = 64;
  server.maxRequestsPerSocket = 100;
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(options.port ?? 8787, host, resolve); });
  origin = options.origin || `http://127.0.0.1:${server.address().port}`;
  const parsedOrigin = new URL(origin);
  if (parsedOrigin.origin !== origin || !["http:", "https:"].includes(parsedOrigin.protocol) || parsedOrigin.username || parsedOrigin.password) {
    server.close(); throw new Error("PLANNER_ORIGIN must be an exact HTTP(S) origin.");
  }
  return { server, origin, close: () => new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); }) };
}

if (require.main === module) {
  createPlannerServer({
    token: process.env.PLANNER_ACCESS_TOKEN, port: Number(process.env.PORT || 8787),
    host: process.env.PLANNER_CONTAINER_MODE === "1" ? "0.0.0.0" : "127.0.0.1",
    containerMode: process.env.PLANNER_CONTAINER_MODE === "1",
    origin: process.env.PLANNER_ORIGIN,
    officialTreePath: process.env.PLANNER_OFFICIAL_TREE,
  }).then(({ origin }) => console.log(`Planner local server ready: ${origin}`)).catch(() => {
    console.error("Planner startup refused. Check access token, origin, port, and canonical official mapping path/hash. See apps/planner-browser/README.md.");
    process.exitCode = 1;
  });
}
module.exports = { createPlannerServer, loadOfficialTree, resourceManifest };
