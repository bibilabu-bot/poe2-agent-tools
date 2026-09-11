const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");
const B = require("../background.js");

test("background seed and bounded paths are independent of title sampling", () => {
  const points = B.create(L.QUALITY_PRESETS.balanced.backgroundMax, L.createSeededRandom(7));
  assert.deepEqual(points, B.create(L.QUALITY_PRESETS.balanced.backgroundMax, L.createSeededRandom(7)));
  const saved = JSON.stringify(points);
  const out = {};
  for (const seconds of [0, 6.3, 60, 3600]) {
    for (const point of points) {
      assert.equal(B.position(out, point, seconds, 1920, 1080), out);
      assert.ok(out.x >= 0 && out.x <= 1920);
      assert.ok(out.y >= 0 && out.y <= 1080);
      assert.ok(out.alpha >= 0 && out.alpha <= 1);
    }
  }
  assert.equal(JSON.stringify(points), saved);
});

test("shorter narrative keeps the void and completes formation by 6.34 seconds", () => {
  assert.equal(L.narrativeTime(900), 900);
  assert.ok(L.narrativeTime(6300) < 10600);
  assert.ok(L.narrativeTime(6340) >= 10600);
  assert.ok(Math.abs(L.narrativeTime(8000) - L.narrativeTime(7000) - 1000) < .001);
});

test("wake strength responds to speed and swept paths without stationary vibration", () => {
  const out = {};
  L.wakeImpulse(out, 50, 15, 0, 0, 100, 0, 100, true);
  const slow = Math.hypot(out.x, out.y);
  L.wakeImpulse(out, 50, 15, 0, 0, 100, 0, 1800, true);
  assert.ok(Math.hypot(out.x, out.y) > slow * 3);
  L.wakeImpulse(out, 50, 200, 0, 0, 100, 0, 1800, true);
  assert.deepEqual(out, { x: 0, y: 0 });
  L.wakeImpulse(out, 50, 15, 0, 0, 100, 0, 0, true);
  assert.deepEqual(out, { x: 0, y: 0 });
  L.wakeImpulse(out, 50, 15, 0, 0, 100, 0, 1800, false);
  assert.deepEqual(out, { x: 0, y: 0 });
});

test("wake remains bounded under repeated fast strokes and returns slowly without new input", () => {
  const particle = { wakeX: 0, wakeY: 0, wakeVX: 0, wakeVY: 0 };
  for (let frame = 0; frame < 100; frame += 1) {
    particle.wakeVX += 10;
    L.advanceWake(particle, 1);
    assert.ok(Math.hypot(particle.wakeX, particle.wakeY) <= 100.0001);
  }
  for (let frame = 0; frame < 30; frame += 1) L.advanceWake(particle, 1);
  assert.ok(Math.abs(particle.wakeX) > 1, "recovery is not instantaneous");
  for (let frame = 0; frame < 570; frame += 1) L.advanceWake(particle, 1);
  assert.ok(Math.abs(particle.wakeX) < .01);
});

test("opposite surface edges share an axis with opposite depth and position", () => {
  const point = B.create(1, L.createSeededRandom(9))[0];
  point.cross = -1;
  const first = B.position({}, point, 4, 1920, 1080);
  point.cross = 1;
  const second = B.position({}, point, 4, 1920, 1080);
  assert.equal(first.x, second.x);
  assert.ok(Math.abs(first.y - second.y) > 10);
  assert.ok(Math.abs(first.scale + second.scale - 2.04) < .0001);
});

test("cached surface columns reproduce pure positions and fill interior cross-sections", () => {
  const points = B.create(4000, L.createSeededRandom(9));
  const columns = B.createColumns(points.length);
  assert.equal(columns.length, 160);
  B.prepare(columns, 7, 1920, 1080);
  assert.equal(points.filter((point) => Math.abs(point.cross) < .85).length, 3360);
  for (const point of points) {
    const cached = B.position({}, point, 7, 1920, 1080, columns);
    const pure = B.position({}, point, 7, 1920, 1080);
    for (const key of ["x", "y", "alpha", "scale"]) assert.equal(cached[key], pure[key]);
  }
});
