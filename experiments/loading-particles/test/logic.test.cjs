"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");

test("seeded random is repeatable and seed-sensitive", () => {
  const a = L.createSeededRandom(42);
  const b = L.createSeededRandom(42);
  const c = L.createSeededRandom(43);
  const first = Array.from({ length: 8 }, a);
  assert.deepEqual(first, Array.from({ length: 8 }, b));
  assert.notDeepEqual(first, Array.from({ length: 8 }, c));
  assert.ok(first.every((value) => value >= 0 && value < 1));
});

test("text targets select opaque pixels deterministically and respect the cap", () => {
  const alpha = new Uint8ClampedArray([
    0, 255, 0, 255,
    255, 0, 255, 0,
    0, 255, 0, 255,
    255, 0, 255, 0
  ]);
  const first = L.selectTargetPoints(alpha, 4, 4, 1, 5, L.createSeededRandom(9));
  const second = L.selectTargetPoints(alpha, 4, 4, 1, 5, L.createSeededRandom(9));
  assert.equal(first.length, 5);
  assert.deepEqual(first, second);
  assert.ok(first.every(({ x, y }) => alpha[y * 4 + x] === 255));
});

test("target assignment stays bounded and deterministic", () => {
  const targets = [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }];
  const first = L.assignTargets(20, targets, L.createSeededRandom(2));
  const second = L.assignTargets(20, targets, L.createSeededRandom(2));
  assert.equal(first.length, targets.length);
  assert.deepEqual(first, second);
  assert.ok(first.every((point) => targets.includes(point)));
});

test("loading state transitions reject invalid movement", () => {
  assert.equal(L.transitionState("enter", "loading"), "loading");
  assert.equal(L.transitionState("loading", "complete"), "complete");
  assert.equal(L.transitionState("loading", "error"), "error");
  assert.equal(L.transitionState("complete", "enter"), "enter");
  assert.throws(() => L.transitionState("complete", "loading"), /Invalid transition/);
  assert.throws(() => L.transitionState("unknown", "loading"), /Unknown loading state/);
});

test("progress clamps boundaries and malformed values", () => {
  assert.equal(L.clampProgress(-3), 0);
  assert.equal(L.clampProgress(44.5), 44.5);
  assert.equal(L.clampProgress(300), 100);
  assert.equal(L.clampProgress(Number.NaN), 0);
});

test("quality preset honors constraints and exposes hard caps", () => {
  assert.equal(L.selectQuality("cinematic", { cores: 8, deviceMemory: 8 }), "cinematic");
  assert.equal(L.selectQuality("cinematic", { cores: 2, deviceMemory: 8 }), "balanced");
  assert.equal(L.selectQuality("cinematic", { reducedMotion: true }), "balanced");
  assert.deepEqual(L.capCounts(9000, 3000, "cinematic"), { title: 6200, wave: 1400 });
  assert.deepEqual(L.capCounts(9000, 3000, "balanced"), { title: 3200, wave: 700 });
});

test("automatic degradation requires a sustained slow-frame majority", () => {
  assert.equal(L.shouldDegrade(Array(89).fill(30), 24, 90), false);
  assert.equal(L.shouldDegrade([...Array(70).fill(30), ...Array(20).fill(16)], 24, 90), true);
  assert.equal(L.shouldDegrade([...Array(60).fill(30), ...Array(30).fill(16)], 24, 90), false);
});

test("reduced-motion choice requires an explicit opt-in to override the system", () => {
  assert.equal(L.chooseMotionMode(true, null), "reduced");
  assert.equal(L.chooseMotionMode(true, "animate"), "animated");
  assert.equal(L.chooseMotionMode(false, "reduce"), "reduced");
  assert.equal(L.chooseMotionMode(false, null), "animated");
});

test("visual narrative advances through void, ignition, convergence and revelation", () => {
  assert.equal(L.getVisualPhase(0), "void");
  assert.equal(L.getVisualPhase(999), "void");
  assert.equal(L.getVisualPhase(1000), "ignition");
  assert.equal(L.getVisualPhase(3199), "ignition");
  assert.equal(L.getVisualPhase(3200), "convergence");
  assert.equal(L.getVisualPhase(7999), "convergence");
  assert.equal(L.getVisualPhase(8000), "revelation");
});

test("resize count calculations never exceed quality caps", () => {
  for (const quality of ["balanced", "cinematic"]) {
    const cap = L.QUALITY_PRESETS[quality];
    const result = L.capCounts(cap.titleMax * 4, cap.waveMax * 4, quality);
    assert.equal(result.title, cap.titleMax);
    assert.equal(result.wave, cap.waveMax);
  }
});

test("pause, resume and destroy control scheduling without post-destroy frames", () => {
  let nextId = 0;
  const callbacks = new Map();
  const cancelled = [];
  const lifecycle = L.createLifecycle((callback) => { const id = ++nextId; callbacks.set(id, callback); return id; }, (id) => cancelled.push(id));
  let frames = 0;
  assert.equal(lifecycle.schedule(() => { frames += 1; }), true);
  assert.equal(lifecycle.schedule(() => { frames += 1; }), false);
  lifecycle.pause();
  assert.deepEqual(cancelled, [1]);
  assert.equal(lifecycle.schedule(() => { frames += 1; }), false);
  lifecycle.resume();
  assert.equal(lifecycle.schedule(() => { frames += 1; }), true);
  callbacks.get(2)(16);
  assert.equal(frames, 1);
  lifecycle.destroy();
  assert.equal(lifecycle.schedule(() => { frames += 1; }), false);
  assert.equal(lifecycle.getState().destroyed, true);
});

test("complete and error are terminal until a restart transition", () => {
  assert.throws(() => L.transitionState("complete", "error"), /Invalid transition/);
  assert.throws(() => L.transitionState("error", "complete"), /Invalid transition/);
  assert.equal(L.transitionState("error", "enter"), "enter");
});
