import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const output = resolve("screenshots", "spark-to-stars-full.mp4");
const captureDurationSeconds = 20;
const frames = await mkdtemp(join(tmpdir(), "p2at020a-frames-"));
const profile = await mkdtemp(join(tmpdir(), "p2at020a-edge-"));
const browser = spawn(edge, [
  "--headless=new", "--no-first-run", "--disable-gpu", "--hide-scrollbars",
  "--remote-debugging-port=9231", `--user-data-dir=${profile}`, "--window-size=1280,720", "about:blank"
], { stdio: "ignore" });
const browserExited = new Promise((resolveExit) => browser.once("exit", resolveExit));

function delay(ms) { return new Promise((resolveDelay) => setTimeout(resolveDelay, ms)); }

async function getPageSocket() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const pages = await fetch("http://127.0.0.1:9231/json/list").then((response) => response.json());
      const page = pages.find((entry) => entry.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* Browser is still starting. */ }
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
let frameNumber = 0;
let lastFrameTimestamp = 0;
const pending = new Map();
const capturedFrames = [];
const writes = [];

function command(method, params = {}) {
  const id = ++commandId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveCommand, rejectCommand) => pending.set(id, { resolveCommand, rejectCommand }));
}

socket.addEventListener("message", async (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.rejectCommand(new Error(message.error.message));
    else request.resolveCommand(message.result);
    return;
  }
  if (message.method !== "Page.screencastFrame") return;
  const timestamp = message.params.metadata.timestamp;
  if (!lastFrameTimestamp || timestamp - lastFrameTimestamp >= 1 / 15) {
    lastFrameTimestamp = timestamp;
    frameNumber += 1;
    const filename = `frame-${String(frameNumber).padStart(5, "0")}.jpg`;
    capturedFrames.push({ filename, timestamp });
    writes.push(writeFile(join(frames, filename), Buffer.from(message.params.data, "base64")));
  }
  command("Page.screencastFrameAck", { sessionId: message.params.sessionId }).catch(() => {});
});

try {
  await command("Page.enable");
  await command("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await command("Page.navigate", { url: "http://127.0.0.1:8765/index.html?seed=20260220&quality=balanced&stage=black" });
  await delay(350);
  await command("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });
  await command("Page.navigate", { url: "http://127.0.0.1:8765/index.html?seed=20260220&quality=balanced" });
  await delay(10500);
  // Slow movement, a pause, a fast sweep, then undisturbed recovery.
  for (let index = 0; index < 30; index += 1) {
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 430 + index * 7, y: 232 });
    await delay(100);
  }
  await delay(1000);
  for (let index = 0; index < 7; index += 1) {
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 430 + index * 65, y: 232 });
    await delay(60);
  }
  await delay(300);
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 10, y: 10 });
  await delay(4800);
  await command("Page.stopScreencast");
  await delay(250);
  await Promise.all(writes);
  const captured = capturedFrames.length;
  if (captured < 100) throw new Error(`Only ${captured} frames were captured`);
  const timeline = [];
  for (let index = 0; index < capturedFrames.length; index += 1) {
    const frame = capturedFrames[index];
    const next = capturedFrames[index + 1];
    const duration = next ? Math.min(.25, Math.max(.001, next.timestamp - frame.timestamp)) : 1 / 15;
    timeline.push(`file '${join(frames, frame.filename).replaceAll("'", "'\\''")}'`, `duration ${duration.toFixed(6)}`);
  }
  timeline.push(`file '${join(frames, capturedFrames.at(-1).filename).replaceAll("'", "'\\''")}'`);
  const timelinePath = join(frames, "timeline.txt");
  await writeFile(timelinePath, `${timeline.join("\n")}\n`);
  const encoded = spawnSync("ffmpeg", [
    "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", timelinePath,
    "-vsync", "vfr", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", output
  ], { stdio: "inherit" });
  if (encoded.status !== 0) throw new Error("ffmpeg failed to encode the evidence video");
  console.log(JSON.stringify({ output, capturedFrames: captured, timestampsPreserved: true, captureDurationSeconds }));
} finally {
  socket.close();
  browser.kill();
  await Promise.race([browserExited, delay(2000)]);
  await rm(frames, { recursive: true, force: true });
  await rm(profile, { recursive: true, force: true });
}
