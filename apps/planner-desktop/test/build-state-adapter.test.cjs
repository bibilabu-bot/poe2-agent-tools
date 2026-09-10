const test = require("node:test");
const assert = require("node:assert/strict");
const {
  extractBuildValue,
  createBuildCandidate,
  applyBuildCandidateTransaction,
  attemptBuildDecode,
  classifyBuildApplyResult,
  clearBuildPreservation,
} = require("../renderer/build-state-adapter.js");
const {
  decodeBuildDocument,
  serializeBuildDocument,
} = require("../renderer/build-codec.js");
const jewelCatalog = require("../src/jewels/catalog.js");
const jewelState = require("../renderer/jewel-state.js");

function runtimeState(overrides = {}) {
  return {
    baseClassName: "Mercenary",
    classStartId: "10",
    selectedAscendancyId: "Mercenary1",
    ascStartId: "100",
    maxPoints: 123,
    maxWeaponPoints: 24,
    maxAscPoints: 8,
    allocated: new Set(["10", "20", "3"]),
    weaponSet1Allocated: new Set(["40"]),
    weaponSet2Allocated: new Set(["50"]),
    ascAllocated: new Set(["100", "600"]),
    instillAllocated: new Set(["Paragon"]),
    camera: { x: 12, y: -4, scale: 0.2 },
    weaponMode: "ws1",
    showAsc: true,
    showLockedConditional: false,
    showInstillOnGraph: true,
    preservation: null,
    ...overrides,
  };
}

function catalogs() {
  return {
    classStartIds: new Map([["Mercenary", "10"]]),
    ascendancyStartIds: new Map([["Mercenary1", "100"]]),
    normalizeJewelState: state => jewelState.normalizeJewelState(state, jewelCatalog),
  };
}

test("complete schema-v1 state round-trips through the pure adapter", () => {
  const source = runtimeState();
  const value = extractBuildValue(source);
  const decoded = decodeBuildDocument(serializeBuildDocument(value));
  const candidate = createBuildCandidate(decoded.value, decoded.preservation, catalogs());

  assert.equal(decoded.ok, true);
  assert.deepEqual(extractBuildValue(candidate), extractBuildValue(source));
  assert.equal(candidate.preservation, decoded.preservation);
});

test("all five allocation categories are extracted without derived start nodes", () => {
  const value = extractBuildValue(runtimeState({
    instillAllocated: new Set(["Paragon", "Augmented Flesh"]),
  }));

  assert.deepEqual(value.build.allocations, {
    normal: ["3", "20"],
    weaponSet1: ["40"],
    weaponSet2: ["50"],
    ascendancy: ["600"],
    instilledPassives: ["Augmented Flesh", "Paragon"],
  });
});

test("class and ascendancy zero-cost starts are reconstructed", () => {
  const value = extractBuildValue(runtimeState());
  const candidate = createBuildCandidate(value, null, catalogs());

  assert.equal(candidate.classStartId, "10");
  assert.equal(candidate.ascStartId, "100");
  assert.deepEqual(candidate.allocated, new Set(["10", "20", "3"]));
  assert.deepEqual(candidate.ascAllocated, new Set(["100", "600"]));
});

test("an application failure rolls back the old state", () => {
  const oldState = runtimeState({ baseClassName: "Witch", classStartId: "11" });
  const holder = { current: oldState };
  const candidate = runtimeState();

  const result = applyBuildCandidateTransaction(candidate, {
    snapshot: () => holder.current,
    commit: (next) => { holder.current = next; },
    finalize: () => { throw new Error("derived index failed"); },
    rollback: (previous) => { holder.current = previous; },
  });

  assert.equal(result.ok, false);
  assert.equal(holder.current, oldState);
  assert.equal(result.rollbackError, undefined);
  assert.deepEqual(classifyBuildApplyResult(result), {
    rollbackFailed: false,
    safeToSave: true,
  });
});

test("a rollback failure is reported separately from the application failure", () => {
  const applyError = new Error("derived index failed");
  const rollbackError = new Error("rollback refresh failed");

  const result = applyBuildCandidateTransaction(runtimeState(), {
    snapshot: () => runtimeState(),
    commit: () => {},
    finalize: () => { throw applyError; },
    rollback: () => { throw rollbackError; },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, applyError);
  assert.equal(result.rollbackError, rollbackError);
  assert.deepEqual(classifyBuildApplyResult(result), {
    rollbackFailed: true,
    safeToSave: false,
  });
});

test("unexpected catalog decode exceptions become controlled results", () => {
  const failure = new Error("catalog lookup failed");
  const result = attemptBuildDecode(() => { throw failure; }, "{}");

  assert.deepEqual(result, { ok: false, decoded: null, error: failure });
  assert.doesNotThrow(() => attemptBuildDecode(() => { throw failure; }, "{}"));
});

test("unresolved data and unknown fields remain in the preservation sidecar", () => {
  const value = extractBuildValue(runtimeState());
  const document = JSON.parse(serializeBuildDocument(value));
  document.extension = { source: "future" };
  document.build.allocations.normal.push("999999");
  const decoded = decodeBuildDocument(document, {
    knownNodeIds: new Set(["3", "20", "40", "50", "600"]),
  });
  const candidate = createBuildCandidate(decoded.value, decoded.preservation, catalogs());
  const saved = JSON.parse(serializeBuildDocument(extractBuildValue(candidate), candidate.preservation));

  assert.deepEqual(saved.extension, { source: "future" });
  assert.ok(saved.build.allocations.normal.includes("999999"));
  assert.equal(candidate.allocated.has("999999"), false);
});

test("new/reset lifecycle explicitly clears the preservation sidecar", () => {
  const state = runtimeState({ preservation: { source: { future: true } } });

  clearBuildPreservation(state);

  assert.equal(state.preservation, null);
});

test("a v2 candidate rejects missing local jewel catalog validation", () => {
  assert.throws(() => createBuildCandidate(extractBuildValue(runtimeState()), null, {
    classStartIds: new Map([["Mercenary", "10"]]), ascendancyStartIds: new Map([["Mercenary1", "100"]]),
  }), /local jewel catalog/);
});
