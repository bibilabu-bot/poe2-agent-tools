const test = require("node:test");
const assert = require("node:assert/strict");
const {
  cleanStatDisplay,
  normalizeStatKey,
  compileStatTemplate,
} = require("../renderer/stat-utils.js");

test("cleanStatDisplay removes display markup while preserving readable text", () => {
  assert.equal(
    cleanStatDisplay("  [Shock]  [Flask|Flask] grants {0:integer}   power\r\n"),
    "Shock Flask grants {0} power",
  );
});

test("normalizeStatKey groups equivalent numeric stat lines", () => {
  assert.equal(normalizeStatKey("+12.5% [Fire] Resistance"), "#% Fire Resistance");
  assert.equal(normalizeStatKey("-.5% Fire Resistance"), "#% Fire Resistance");
});

test("compileStatTemplate matches numeric values in placeholder order", () => {
  const template = compileStatTemplate("Gain {1}% [Fire] Damage and {0} Life", "获得 {1}% 火焰伤害与 {0} 生命");

  assert.deepEqual(template.indices, [1, 0]);
  assert.deepEqual(template.regex.exec("Gain +12.5% Fire Damage and 40 Life").slice(1), ["+12.5", "40"]);
});

test("compileStatTemplate rejects non-numeric values and treats malformed placeholders literally", () => {
  const template = compileStatTemplate("Gain {0}% Damage", "获得 {0}% 伤害");
  assert.equal(template.regex.test("Gain many% Damage"), false);

  const malformed = compileStatTemplate("Gain {bad}% Damage", "获得伤害");
  assert.equal(malformed.regex.test("Gain {bad}% Damage"), true);
  assert.equal(malformed.regex.test("Gain 10% Damage"), false);
});
