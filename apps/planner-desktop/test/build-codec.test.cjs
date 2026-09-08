const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {
  BUILD_FORMAT,
  BUILD_SCHEMA_VERSION,
  BUILD_LIMITS,
  createBuildDocument,
  decodeBuildDocument,
  serializeBuildDocument,
} = require("../renderer/build-codec.js");

function validDocument(overrides = {}) {
  const document = {
    format: BUILD_FORMAT,
    schemaVersion: BUILD_SCHEMA_VERSION,
    build: {
      class: { base: "Mercenary", ascendancyId: "Mercenary1" },
      budgets: { passive: 123, weaponSet: 24, ascendancy: 8 },
      allocations: {
        normal: ["20", "3"],
        weaponSet1: ["40"],
        weaponSet2: ["50"],
        ascendancy: ["600"],
        instilledPassives: ["Paragon", "Augmented Flesh"],
      },
    },
    ui: {
      camera: { x: 12, y: -4, scale: 0.2 },
      weaponMode: "ws1",
      showAscendancy: true,
      showLockedConditional: false,
      showInstilledOnGraph: true,
    },
  };
  return Object.assign(document, overrides);
}

test("valid schema-v1 documents round-trip all allocation categories deterministically", () => {
  const source = validDocument();
  const before = structuredClone(source);
  const decoded = decodeBuildDocument(source);

  assert.equal(decoded.ok, true);
  assert.deepEqual(source, before);
  assert.deepEqual(decoded.value.build.allocations, {
    normal: ["3", "20"],
    weaponSet1: ["40"],
    weaponSet2: ["50"],
    ascendancy: ["600"],
    instilledPassives: ["Augmented Flesh", "Paragon"],
  });
  assert.deepEqual(createBuildDocument(decoded.value, decoded.preservation), {
    ...before,
    build: {
      ...before.build,
      allocations: {
        normal: ["3", "20"],
        weaponSet1: ["40"],
        weaponSet2: ["50"],
        ascendancy: ["600"],
        instilledPassives: ["Augmented Flesh", "Paragon"],
      },
    },
  });
  assert.match(serializeBuildDocument(decoded.value, decoded.preservation), /\n$/);
});

test("unknown object fields survive a load/edit/save cycle as inert data", () => {
  const source = JSON.parse(JSON.stringify({
    ...validDocument(),
    extension: { url: "https://invalid.example", __protoMarker: "safe" },
  }).replace('"__protoMarker"', '"__proto__"'));
  source.build.class.thirdPartyClassHint = "example";
  source.build.thirdPartyExtension = { value: 42 };

  const decoded = decodeBuildDocument(source);
  const saved = createBuildDocument(decoded.value, decoded.preservation);

  assert.equal(decoded.ok, true);
  assert.equal(saved.extension.url, "https://invalid.example");
  assert.equal(Object.hasOwn(saved.extension, "__proto__"), true);
  assert.equal(saved.extension.__proto__, "safe");
  assert.equal(saved.build.class.thirdPartyClassHint, "example");
  assert.deepEqual(saved.build.thirdPartyExtension, { value: 42 });
  assert.equal({}.safe, undefined);
});

test("unresolved node IDs and instilled names are inactive but preserved", () => {
  const source = validDocument();
  source.build.allocations.normal.push("999");
  source.build.allocations.instilledPassives.push("Retired Passive");

  const decoded = decodeBuildDocument(source, {
    knownNodeIds: new Set(["3", "20", "40", "50", "600"]),
    knownInstilledPassives: new Set(["Augmented Flesh", "Paragon"]),
  });
  const saved = createBuildDocument(decoded.value, decoded.preservation);

  assert.equal(decoded.ok, true);
  assert.deepEqual(decoded.value.build.allocations.normal, ["3", "20"]);
  assert.deepEqual(decoded.preservation.unresolvedAllocations.normal, ["999"]);
  assert.deepEqual(decoded.preservation.unresolvedAllocations.instilledPassives, ["Retired Passive"]);
  assert.deepEqual(saved.build.allocations.normal, ["3", "20", "999"]);
  assert.deepEqual(saved.build.allocations.instilledPassives, ["Augmented Flesh", "Paragon", "Retired Passive"]);
  assert.equal(decoded.diagnostics.warningCount, 2);
  assert.ok(decoded.diagnostics.warnings.every(({ code }) => code === "unresolved_allocation"));
});

test("duplicates and normal/weapon-set redundancy warn and normalize", () => {
  const source = validDocument();
  source.build.allocations.normal = ["3", "3", "20"];
  source.build.allocations.weaponSet1 = ["3", "40", "40", "70"];
  source.build.allocations.weaponSet2 = ["3", "70"];

  const decoded = decodeBuildDocument(source);

  assert.equal(decoded.ok, true);
  assert.deepEqual(decoded.value.build.allocations.normal, ["3", "20"]);
  assert.deepEqual(decoded.value.build.allocations.weaponSet1, ["40", "70"]);
  assert.deepEqual(decoded.value.build.allocations.weaponSet2, ["70"]);
  assert.equal(decoded.diagnostics.warningCount, 4);
  assert.deepEqual(
    decoded.diagnostics.warnings.map(({ code }) => code).sort(),
    ["duplicate_allocation", "duplicate_allocation", "redundant_allocation", "redundant_allocation"],
  );
});

test("diagnostic details are capped while aggregate warning counts remain", () => {
  const source = validDocument();
  source.build.allocations.normal = [];
  source.build.allocations.weaponSet1 = [];
  source.build.allocations.weaponSet2 = [];
  for (let index = 0; index < BUILD_LIMITS.maxDiagnosticDetails + 1; index += 1) {
    source.build.allocations.normal.push(String(index), String(index));
  }

  const decoded = decodeBuildDocument(source);

  assert.equal(decoded.ok, true);
  assert.equal(decoded.diagnostics.warningCount, BUILD_LIMITS.maxDiagnosticDetails + 1);
  assert.equal(decoded.diagnostics.warnings.length, BUILD_LIMITS.maxDiagnosticDetails);
  assert.equal(decoded.diagnostics.detailsTruncated, true);
});

test("a future schema version is rejected without a normalized value", () => {
  const decoded = decodeBuildDocument(validDocument({ schemaVersion: 2 }));

  assert.equal(decoded.ok, false);
  assert.equal(decoded.value, null);
  assert.equal(decoded.diagnostics.fatals[0].code, "unsupported_schema_version");
});

test("malformed JSON, null roots and excessive string-input depth are fatal", () => {
  assert.equal(decodeBuildDocument("{").diagnostics.fatals[0].code, "malformed_json");
  assert.equal(decodeBuildDocument("null").diagnostics.fatals[0].code, "invalid_root");

  const source = validDocument();
  let cursor = source;
  for (let depth = 0; depth <= BUILD_LIMITS.maxTraversalDepth; depth += 1) {
    cursor.extension = {};
    cursor = cursor.extension;
  }
  assert.ok(decodeBuildDocument(JSON.stringify(source)).diagnostics.fatals.some(
    ({ code }) => code === "traversal_depth_exceeded",
  ));
});

test("missing required objects and arrays are fatal", () => {
  const cases = [
    {},
    validDocument({ build: null }),
    { ...validDocument(), build: { ...validDocument().build, class: {} } },
    { ...validDocument(), build: { ...validDocument().build, budgets: {} } },
    {
      ...validDocument(),
      build: {
        ...validDocument().build,
        allocations: { ...validDocument().build.allocations, normal: null },
      },
    },
  ];

  for (const source of cases) {
    const decoded = decodeBuildDocument(source);
    assert.equal(decoded.ok, false);
    assert.ok(decoded.diagnostics.fatalCount > 0);
  }
});

test("malformed known values are fatal and are never coerced", () => {
  const source = validDocument();
  source.build.class.base = 123;
  source.build.budgets.passive = "123";
  source.build.allocations.normal = [123];
  source.ui.weaponMode = "weapon-one";

  const decoded = decodeBuildDocument(source);

  assert.equal(decoded.ok, false);
  assert.ok(decoded.diagnostics.fatalCount >= 4);
  assert.equal(decoded.value, null);
});

test("budget ranges and class/ascendancy invariants are enforced", () => {
  const source = validDocument();
  source.build.class.base = null;
  source.build.budgets.passive = 0;
  source.build.budgets.weaponSet = 101;
  source.build.budgets.ascendancy = 9;

  const decoded = decodeBuildDocument(source);

  assert.equal(decoded.ok, false);
  assert.ok(decoded.diagnostics.fatals.some(({ path }) => path === "build.class.ascendancyId"));
  assert.ok(decoded.diagnostics.fatals.some(({ path }) => path === "build.budgets.passive"));
  assert.ok(decoded.diagnostics.fatals.some(({ path }) => path === "build.budgets.weaponSet"));
  assert.ok(decoded.diagnostics.fatals.some(({ path }) => path === "build.budgets.ascendancy"));
});

test("file size, allocation length, identifier length and traversal depth limits are fatal", () => {
  const tooLarge = JSON.stringify({ padding: "x".repeat(BUILD_LIMITS.maxFileBytes) });
  assert.equal(decodeBuildDocument(tooLarge).diagnostics.fatals[0].code, "file_too_large");

  const tooMany = validDocument();
  tooMany.build.allocations.normal = Array.from(
    { length: BUILD_LIMITS.maxAllocationEntries + 1 },
    (_, index) => String(index),
  );
  assert.ok(decodeBuildDocument(tooMany).diagnostics.fatals.some(({ code }) => code === "allocation_limit_exceeded"));

  const longIdentifier = validDocument();
  longIdentifier.build.allocations.normal = ["x".repeat(BUILD_LIMITS.maxKnownStringLength + 1)];
  assert.ok(decodeBuildDocument(longIdentifier).diagnostics.fatals.some(({ code }) => code === "string_too_long"));

  const tooDeep = validDocument();
  let cursor = tooDeep;
  for (let depth = 0; depth <= BUILD_LIMITS.maxTraversalDepth; depth += 1) {
    cursor.extension = {};
    cursor = cursor.extension;
  }
  assert.ok(decodeBuildDocument(tooDeep).diagnostics.fatals.some(({ code }) => code === "traversal_depth_exceeded"));
});

test("optional UI fields normalize scale and reject invalid known UI values", () => {
  const clamped = validDocument();
  clamped.ui.camera.scale = 99;
  const decoded = decodeBuildDocument(clamped);
  assert.equal(decoded.ok, true);
  assert.equal(decoded.value.ui.camera.scale, 2.5);
  assert.equal(decoded.diagnostics.warnings[0].code, "ui_scale_clamped");

  const invalid = validDocument();
  invalid.ui.camera.x = Infinity;
  invalid.ui.showAscendancy = "true";
  assert.equal(decodeBuildDocument(invalid).ok, false);
});

test("optional class catalogs reject an unknown base and preserve an unknown ascendancy", () => {
  const unknownBase = decodeBuildDocument(validDocument(), {
    knownBaseClasses: new Set(["Sorceress"]),
  });
  assert.equal(unknownBase.ok, false);
  assert.ok(unknownBase.diagnostics.fatals.some(({ code }) => code === "unknown_base_class"));

  const unknownAscendancy = decodeBuildDocument(validDocument(), {
    knownBaseClasses: new Set(["Mercenary"]),
    knownAscendancies: new Set(["Mercenary2"]),
  });
  assert.equal(unknownAscendancy.ok, true);
  assert.equal(unknownAscendancy.value.build.class.ascendancyId, null);
  assert.deepEqual(unknownAscendancy.value.build.allocations.ascendancy, []);
  assert.equal(unknownAscendancy.preservation.unresolvedAscendancyId, "Mercenary1");
  assert.equal(
    createBuildDocument(unknownAscendancy.value, unknownAscendancy.preservation)
      .build.class.ascendancyId,
    "Mercenary1",
  );
});

test("over-budget allocations remain active and produce non-fatal warnings", () => {
  const source = validDocument();
  source.build.budgets.passive = 1;
  source.build.budgets.weaponSet = 0;
  source.build.allocations.ascendancy = Array.from({ length: 9 }, (_, index) => String(600 + index));

  const decoded = decodeBuildDocument(source);

  assert.equal(decoded.ok, true);
  assert.equal(decoded.value.build.allocations.normal.length, 2);
  assert.ok(decoded.diagnostics.warnings.some(({ code }) => code === "passive_budget_exceeded"));
  assert.ok(decoded.diagnostics.warnings.some(({ code }) => code === "weapon_budget_exceeded"));
  assert.ok(decoded.diagnostics.warnings.some(({ code }) => code === "ascendancy_budget_exceeded"));
});

test("serialization is deterministic for known values and does not require ui input", () => {
  const source = validDocument();
  delete source.ui;
  source.build.allocations.normal = ["10", "2", "1"];

  const first = decodeBuildDocument(source);
  const second = decodeBuildDocument(structuredClone(source));
  assert.equal(serializeBuildDocument(first.value, first.preservation), serializeBuildDocument(second.value, second.preservation));
  assert.deepEqual(createBuildDocument(first.value, first.preservation).ui, {});
  assert.deepEqual(first.value.build.allocations.normal, ["1", "2", "10"]);

  const redundantState = structuredClone(first.value);
  redundantState.build.allocations.weaponSet1 = ["2"];
  assert.deepEqual(
    createBuildDocument(redundantState, first.preservation).build.allocations.weaponSet1,
    [],
  );
});

test("the codec exports a browser global without CommonJS or platform APIs", () => {
  const filename = path.join(__dirname, "..", "renderer", "build-codec.js");
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(filename, "utf8"), context);

  assert.equal(typeof context.plannerBuildCodec.decodeBuildDocument, "function");
  assert.equal(context.plannerBuildCodec.BUILD_SCHEMA_VERSION, 1);
});
