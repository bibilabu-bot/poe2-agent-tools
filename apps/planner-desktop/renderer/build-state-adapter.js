(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.plannerBuildStateAdapter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  function compareNodeIds(left, right) {
    if (/^-?\d+$/.test(left) && /^-?\d+$/.test(right)) {
      const leftNumber = BigInt(left);
      const rightNumber = BigInt(right);
      if (leftNumber < rightNumber) return -1;
      if (leftNumber > rightNumber) return 1;
    }
    return left < right ? -1 : left > right ? 1 : 0;
  }

  function sorted(values, compare = compareNodeIds) {
    return [...values].map(String).sort(compare);
  }

  function withoutStart(values, startId) {
    return sorted(values).filter((id) => id !== startId);
  }

  function extractBuildValue(state) {
    return {
      format: "poe2-agent-tools-build",
      schemaVersion: 1,
      build: {
        class: {
          base: state.baseClassName,
          ascendancyId: state.selectedAscendancyId,
        },
        budgets: {
          passive: state.maxPoints,
          weaponSet: state.maxWeaponPoints,
          ascendancy: state.maxAscPoints,
        },
        allocations: {
          normal: withoutStart(state.allocated, state.classStartId),
          weaponSet1: sorted(state.weaponSet1Allocated),
          weaponSet2: sorted(state.weaponSet2Allocated),
          ascendancy: withoutStart(state.ascAllocated, state.ascStartId),
          instilledPassives: sorted(state.instillAllocated, undefined),
        },
      },
      ui: {
        camera: {
          x: state.camera.x,
          y: state.camera.y,
          scale: state.camera.scale,
        },
        weaponMode: state.weaponMode,
        showAscendancy: state.showAsc,
        showLockedConditional: state.showLockedConditional,
        showInstilledOnGraph: state.showInstillOnGraph,
      },
    };
  }

  function requiredStart(mapping, key, label) {
    if (key === null) return null;
    const value = mapping?.get(key);
    if (value === undefined || value === null) {
      throw new Error(`Cannot derive ${label} for ${key}.`);
    }
    return String(value);
  }

  function createBuildCandidate(value, preservation, catalogs) {
    const build = value.build;
    const classStartId = requiredStart(catalogs.classStartIds, build.class.base, "class start");
    const ascStartId = requiredStart(
      catalogs.ascendancyStartIds,
      build.class.ascendancyId,
      "ascendancy start",
    );
    const ui = value.ui || {};
    const camera = ui.camera || {};

    return {
      baseClassName: build.class.base,
      classStartId,
      selectedAscendancyId: build.class.ascendancyId,
      ascStartId,
      maxPoints: build.budgets.passive,
      maxWeaponPoints: build.budgets.weaponSet,
      maxAscPoints: build.budgets.ascendancy,
      allocated: new Set(classStartId === null
        ? build.allocations.normal
        : [classStartId, ...build.allocations.normal]),
      weaponSet1Allocated: new Set(build.allocations.weaponSet1),
      weaponSet2Allocated: new Set(build.allocations.weaponSet2),
      ascAllocated: new Set(ascStartId === null
        ? build.allocations.ascendancy
        : [ascStartId, ...build.allocations.ascendancy]),
      instillAllocated: new Set(build.allocations.instilledPassives),
      camera: {
        x: Object.hasOwn(camera, "x") ? camera.x : undefined,
        y: Object.hasOwn(camera, "y") ? camera.y : undefined,
        scale: Object.hasOwn(camera, "scale") ? camera.scale : undefined,
      },
      weaponMode: ui.weaponMode,
      showAsc: ui.showAscendancy,
      showLockedConditional: ui.showLockedConditional,
      showInstillOnGraph: ui.showInstilledOnGraph,
      preservation,
    };
  }

  function applyBuildCandidateTransaction(candidate, operations) {
    const previous = operations.snapshot();
    try {
      operations.commit(candidate);
      operations.finalize?.();
      return { ok: true, error: null };
    } catch (error) {
      try {
        operations.rollback(previous);
      } catch (rollbackError) {
        return { ok: false, error, rollbackError };
      }
      return { ok: false, error };
    }
  }

  function clearBuildPreservation(state) {
    state.preservation = null;
  }

  return {
    extractBuildValue,
    createBuildCandidate,
    applyBuildCandidateTransaction,
    clearBuildPreservation,
  };
});
