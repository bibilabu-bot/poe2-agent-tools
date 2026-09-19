const test = require("node:test");
const assert = require("node:assert/strict");
const { nextOpenPanel, canCloseWithEscape } = require("../renderer/layout-shell.js");
const fs = require("node:fs");
const path = require("node:path");

test("clicking a closed tool opens it and clicking it again collapses it", () => {
  assert.equal(nextOpenPanel(null, "search"), "search");
  assert.equal(nextOpenPanel("search", "search"), null);
});

test("switching tools keeps exactly one panel open", () => {
  assert.equal(nextOpenPanel("class", "stats"), "stats");
});

test("Escape does not steal dialog or form editing interactions", () => {
  assert.equal(canCloseWithEscape(), true);
  assert.equal(canCloseWithEscape({ dialogOpen: true }), false);
  assert.equal(canCloseWithEscape({ editing: true }), false);
});

test("the shipped page loads the layout shell before planner binding and retains every moved control once", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../renderer/index.html"), "utf8");
  assert.ok(html.indexOf('src="layout-shell.js"') < html.indexOf('src="planner.js"'));
  const movedIds = ["importWeGame", "openBuild", "saveBuild", "undo", "redo", "fit", "zin", "zout", "classSelect", "budget", "search", "langSelect", "statSummary"];
  for (const id of movedIds) {
    assert.equal((html.match(new RegExp(`id=["']${id}["']`, "g")) || []).length, 1, `${id} must remain unique`);
  }
});
