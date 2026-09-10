"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createHarness() {
  const listeners = new Map();
  const intervals = new Map();
  const timeouts = new Map();
  const frames = new Map();
  let nextHandle = 0;
  let clock = 0;

  function element(id) {
    return {
      id, hidden: false, style: {}, dataset: {}, value: "", textContent: "",
      setAttribute() {}, addEventListener(type, callback) { listeners.set(`${id}:${type}`, callback); },
      removeEventListener(type) { listeners.delete(`${id}:${type}`); }
    };
  }
  const context2d = {
    fillStyle: "", textAlign: "", textBaseline: "", font: "", globalAlpha: 1, globalCompositeOperation: "",
    clearRect() {}, fillText() {}, fillRect() {}, save() {}, restore() {}, setTransform() {},
    getImageData(_x, _y, width, height) {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let index = 3; index < data.length; index += 16) data[index] = 255;
      return { data };
    }
  };
  const elements = new Map();
  for (const id of ["particle-canvas", "loading-progress", "progress-value", "step-text", "state-label", "error-text", "completion-text", "pause-button", "restart-button", "error-button", "quality-select", "motion-note"]) elements.set(id, element(id));
  const canvas = elements.get("particle-canvas");
  canvas.getContext = () => context2d;
  canvas.width = 0;
  canvas.height = 0;

  const document = {
    hidden: false,
    body: { dataset: {} },
    getElementById(id) { return elements.get(id); },
    createElement(tag) {
      if (tag !== "canvas") return element(tag);
      return { width: 0, height: 0, getContext: () => context2d };
    },
    addEventListener(type, callback) { listeners.set(`document:${type}`, callback); },
    removeEventListener(type) { listeners.delete(`document:${type}`); }
  };
  const motionQuery = { matches: false, addEventListener() {}, removeEventListener() {} };
  const sandbox = {
    console, document, window: null, globalThis: null, location: { search: "?seed=7" },
    navigator: { deviceMemory: 8, hardwareConcurrency: 8 }, innerWidth: 800, innerHeight: 600, devicePixelRatio: 1,
    matchMedia: () => motionQuery, URLSearchParams, Uint8ClampedArray, Float32Array, Uint8Array, Math, Number, Set, Array,
    performance: { now() { clock += 1; return clock; } },
    setInterval(callback) { const id = ++nextHandle; intervals.set(id, callback); return id; },
    clearInterval(id) { intervals.delete(id); },
    setTimeout(callback) { const id = ++nextHandle; timeouts.set(id, callback); return id; },
    clearTimeout(id) { timeouts.delete(id); },
    requestAnimationFrame(callback) { const id = ++nextHandle; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    addEventListener(type, callback) { listeners.set(`window:${type}`, callback); },
    removeEventListener(type) { listeners.delete(`window:${type}`); }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const root = path.join(__dirname, "..");
  vm.runInContext(fs.readFileSync(path.join(root, "logic.js"), "utf8"), sandbox, { filename: "logic.js" });
  vm.runInContext(fs.readFileSync(path.join(root, "app.js"), "utf8"), sandbox, { filename: "app.js" });
  return { sandbox, document, listeners, intervals, timeouts, frames };
}

test("public completion stops mock progress and terminal states do not create particles", () => {
  const harness = createHarness();
  const api = harness.sandbox.__loadingPrototype;
  const before = JSON.parse(harness.document.body.dataset.metrics).totalParticles;
  assert.equal(harness.intervals.size, 1);
  api.complete();
  assert.equal(harness.intervals.size, 0);
  assert.equal(JSON.parse(harness.document.body.dataset.metrics).totalParticles, before);
  api.fail();
  assert.equal(JSON.parse(harness.document.body.dataset.metrics).totalParticles, before);
});

test("destroy cancels work, removes listeners/API and retained controls cannot restart", () => {
  const harness = createHarness();
  const api = harness.sandbox.__loadingPrototype;
  api.destroy();
  assert.equal(harness.sandbox.__loadingPrototype, undefined);
  assert.equal(harness.intervals.size, 0);
  assert.equal(harness.timeouts.size, 0);
  assert.equal(harness.frames.size, 0);
  assert.equal(harness.listeners.size, 0);
  api.restart();
  api.setProgress(50);
  api.complete();
  api.fail();
  assert.equal(harness.intervals.size, 0);
  assert.equal(harness.frames.size, 0);
});

test("visibility changes cancel and restore animation scheduling", () => {
  const harness = createHarness();
  const onVisibility = harness.listeners.get("document:visibilitychange");
  assert.equal(typeof onVisibility, "function");
  assert.equal(harness.frames.size, 1);
  harness.document.hidden = true;
  onVisibility();
  assert.equal(harness.frames.size, 0);
  assert.equal(JSON.parse(harness.document.body.dataset.metrics).hidden, true);
  harness.document.hidden = false;
  onVisibility();
  assert.equal(harness.frames.size, 1);
});
