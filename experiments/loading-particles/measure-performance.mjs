import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const profile = await mkdtemp(join(tmpdir(), "p2at020a-perf-"));
const browser = spawn(edge, [
  "--headless=new", "--no-first-run", "--hide-scrollbars", "--remote-debugging-port=9232",
  `--user-data-dir=${profile}`, "--window-size=1920,1080", "about:blank"
], { stdio: "ignore" });
const browserExited = new Promise((resolveExit) => browser.once("exit", resolveExit));

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function getPageSocket() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const pages = await fetch("http://127.0.0.1:9232/json/list").then((response) => response.json());
      const page = pages.find((entry) => entry.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* Edge is still starting. */ }
    await delay(100);
  }
  throw new Error("Edge DevTools endpoint did not become ready");
}

const socket = new WebSocket(await getPageSocket());
await new Promise((resolveOpen, rejectOpen) => {
  socket.addEventListener("open", resolveOpen, { once: true });
  socket.addEventListener("error", rejectOpen, { once: true });
});

let commandId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const request = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});

function command(method, params = {}) {
  const id = ++commandId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function measure(quality) {
  await command("Page.navigate", {
    url: `http://127.0.0.1:8765/index.html?seed=20260220&quality=${quality}`
  });
  await delay(12000);
  const result = await command("Runtime.evaluate", {
    expression: "JSON.stringify({ viewport: [innerWidth, innerHeight, devicePixelRatio], metrics: JSON.parse(document.body.dataset.metrics) })",
    returnByValue: true
  });
  return JSON.parse(result.result.value);
}

try {
  await command("Page.enable");
  await command("Runtime.enable");
  await command("Emulation.setDeviceMetricsOverride", {
    width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false
  });
  const balanced = await measure("balanced");
  const cinematic = await measure("cinematic");
  console.log(JSON.stringify({ measuredAt: new Date().toISOString(), balanced, cinematic }, null, 2));
} finally {
  socket.close();
  browser.kill();
  await Promise.race([browserExited, delay(2000)]);
  await rm(profile, { recursive: true, force: true });
}
