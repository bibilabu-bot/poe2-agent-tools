import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
  const phases = [];
  for (const waitMs of [3500, 3500, 5000]) {
    await delay(waitMs);
    const sample = await command("Runtime.evaluate", {
      expression: "document.body.dataset.metrics", returnByValue: true
    });
    phases.push(JSON.parse(sample.result.value));
  }
  const result = await command("Runtime.evaluate", {
    expression: "JSON.stringify({ viewport: [innerWidth, innerHeight, devicePixelRatio], metrics: JSON.parse(document.body.dataset.metrics), entrance: { hidden: document.getElementById('enter-button').hidden, text: document.getElementById('enter-button').textContent, background: getComputedStyle(document.getElementById('enter-button')).backgroundColor, borderWidth: getComputedStyle(document.getElementById('enter-button')).borderWidth, progressHidden: document.getElementById('loading-details').hidden } })",
    returnByValue: true
  });
  const entry = JSON.parse(result.result.value).entrance;
  if (entry.hidden || !entry.progressHidden || entry.background !== "rgba(0, 0, 0, 0)" || entry.borderWidth !== "0px") throw new Error("Plain-text entrance did not replace the progress area");
  const screenshot = await command("Page.captureScreenshot", { format: "png" });
  await writeFile(join("screenshots", `${quality}-1920x1080.png`), Buffer.from(screenshot.data, "base64"));
  for (let index = 0; index < 19; index += 1) {
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 730 + index * 12, y: 333 });
    await delay(90);
  }
  const slowResult = await command("Runtime.evaluate", {
    expression: "JSON.stringify(window.__loadingPrototype.getMetrics())", returnByValue: true
  });
  const slowMetrics = JSON.parse(slowResult.result.value);
  await delay(5000);
  for (let index = 0; index < 10; index += 1) {
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 730 + index * 50, y: 333 });
    await delay(60);
  }
  await delay(150);
  const hover = await command("Runtime.evaluate", {
    expression: "JSON.stringify(window.__loadingPrototype.getMetrics())", returnByValue: true
  });
  const hoverMetrics = JSON.parse(hover.result.value);
  if (hoverMetrics.hoverInfluenced <= 0) throw new Error("Hover did not affect the completed title");
  if (hoverMetrics.maxWakeOffset <= slowMetrics.maxWakeOffset) throw new Error("Fast sweep was not stronger than slow sweep");
  const hoverImage = await command("Page.captureScreenshot", { format: "png" });
  await writeFile(join("screenshots", `${quality}-hover-1920x1080.png`), Buffer.from(hoverImage.data, "base64"));
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 10, y: 10 });
  await delay(47000);
  const stable = await command("Runtime.evaluate", {
    expression: "JSON.stringify(window.__loadingPrototype.getMetrics())", returnByValue: true
  });
  const stableMetrics = JSON.parse(stable.result.value);
  if (stableMetrics.totalParticles !== phases[0].totalParticles) throw new Error("Particle population changed during stability run");
  return { ...JSON.parse(result.result.value), phases, slowMetrics, hoverMetrics, stableMetrics };
}

try {
  await command("Page.enable");
  await command("Runtime.enable");
  await command("Emulation.setDeviceMetricsOverride", {
    width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false
  });
  const balanced = await measure("balanced");
  const cinematic = await measure("cinematic");
  await command("Page.navigate", { url: "http://127.0.0.1:8765/index.html?seed=20260220&motion=reduced" });
  await delay(1000);
  const reduced = await command("Page.captureScreenshot", { format: "png" });
  await writeFile(join("screenshots", "reduced-motion-1920x1080.png"), Buffer.from(reduced.data, "base64"));
  const report = JSON.stringify({ measuredAt: new Date().toISOString(), balanced, cinematic }, null, 2);
  await writeFile(join("screenshots", "performance-results.json"), report + "\n");
  console.log(report);
} finally {
  socket.close();
  browser.kill();
  await Promise.race([browserExited, delay(2000)]);
  await rm(profile, { recursive: true, force: true });
}
