const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");
const B = require("../background.js");

test("background seed and bounded paths are independent of title sampling", () => {
  const points = B.create(L.QUALITY_PRESETS.balanced.backgroundMax, L.createSeededRandom(7));
  assert.deepEqual(points, B.create(1000, L.createSeededRandom(7)));
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

test("hover ripple is local, finite at its center, bounded and explicitly disabled", () => {
  const out = {};
  for (let x = -150; x <= 150; x += 5) {
    for (let time = 0; time < 3000; time += 100) {
      L.hoverOffset(out, x, 0, time, true);
      assert.ok(Number.isFinite(out.x) && Number.isFinite(out.y));
      assert.ok(Math.hypot(out.x, out.y) <= 10);
      if (Math.abs(x) >= 115) assert.equal(out.x, 0);
    }
  }
  L.hoverOffset(out, 20, 30, 900, false);
  assert.deepEqual(out, { x: 0, y: 0 });
});
