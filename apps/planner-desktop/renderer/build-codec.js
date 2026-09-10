(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.plannerBuildCodec = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const BUILD_FORMAT = "poe2-agent-tools-build";
  const BUILD_SCHEMA_VERSION = 2;
  const BUILD_LIMITS = Object.freeze({
    maxFileBytes: 5 * 1024 * 1024,
    maxAllocationEntries: 20_000,
    maxKnownStringLength: 256,
    maxTraversalDepth: 64,
    maxDiagnosticDetails: 100,
    maxJewelInstances: 20_000,
    maxJewelPlacements: 20_000,
  });
  const ALLOCATION_KEYS = Object.freeze([
    "normal",
    "weaponSet1",
    "weaponSet2",
    "ascendancy",
    "instilledPassives",
  ]);
  const UI_KEYS = Object.freeze([
    "camera",
    "weaponMode",
    "showAscendancy",
    "showLockedConditional",
    "showInstilledOnGraph",
  ]);
  const CAMERA_KEYS = Object.freeze(["x", "y", "scale"]);
  const INSTANCE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
  const DEFINITION_ID = /^[a-z][a-z0-9.-]*:[a-z0-9][a-z0-9._-]*$/;
  const SOCKET_ID = /^(0|[1-9][0-9]{0,255})$/;

  function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
  }

  function isRecord(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function defineData(target, key, value) {
    Object.defineProperty(target, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }

  function safeClone(value) {
    if (Array.isArray(value)) return value.map(safeClone);
    if (!isRecord(value)) return value;

    const clone = {};
    for (const key of Object.keys(value).sort()) {
      defineData(clone, key, safeClone(value[key]));
    }
    return clone;
  }

  function mergeRecord(source, knownEntries, knownKeys) {
    const output = {};
    for (const [key, value] of knownEntries) defineData(output, key, safeClone(value));
    if (!isRecord(source)) return output;

    const known = new Set(knownKeys);
    for (const key of Object.keys(source).sort()) {
      if (!known.has(key)) defineData(output, key, safeClone(source[key]));
    }
    return output;
  }

  function utf8ByteLength(text) {
    let bytes = 0;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code <= 0x7f) bytes += 1;
      else if (code <= 0x7ff) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length
        && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    }
    return bytes;
  }

  function makeDiagnostics() {
    let detailCount = 0;
    const diagnostics = {
      fatalCount: 0,
      warningCount: 0,
      fatals: [],
      warnings: [],
      detailsTruncated: false,
    };

    function add(kind, code, path, message) {
      const countKey = kind === "fatal" ? "fatalCount" : "warningCount";
      const detailsKey = kind === "fatal" ? "fatals" : "warnings";
      diagnostics[countKey] += 1;
      if (detailCount < BUILD_LIMITS.maxDiagnosticDetails) {
        diagnostics[detailsKey].push({ code, path, message });
        detailCount += 1;
      } else if (kind === "fatal" && diagnostics.warnings.length > 0) {
        diagnostics.warnings.pop();
        diagnostics.fatals.push({ code, path, message });
        diagnostics.detailsTruncated = true;
      } else {
        diagnostics.detailsTruncated = true;
      }
    }

    return {
      diagnostics,
      fatal(code, path, message) {
        add("fatal", code, path, message);
      },
      warn(code, path, message) {
        add("warning", code, path, message);
      },
    };
  }

  function inspectJsonValue(value, reporter, path = "$", depth = 0, ancestors = new Set()) {
    if (depth > BUILD_LIMITS.maxTraversalDepth) {
      reporter.fatal(
        "traversal_depth_exceeded",
        path,
        `JSON traversal depth exceeds ${BUILD_LIMITS.maxTraversalDepth}.`,
      );
      return;
    }

    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        reporter.fatal("invalid_json_value", path, "JSON numbers must be finite.");
      }
      return;
    }
    if (typeof value !== "object") {
      reporter.fatal("invalid_json_value", path, "Value is not representable in JSON.");
      return;
    }
    if (!Array.isArray(value) && !isRecord(value)) {
      reporter.fatal("invalid_json_value", path, "Objects must be plain JSON records.");
      return;
    }
    if (ancestors.has(value)) {
      reporter.fatal("cyclic_input", path, "Build input must not contain cycles.");
      return;
    }

    ancestors.add(value);
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        inspectJsonValue(value[index], reporter, `${path}[${index}]`, depth + 1, ancestors);
      }
    } else {
      for (const key of Object.keys(value)) {
        inspectJsonValue(value[key], reporter, `${path}.${key}`, depth + 1, ancestors);
      }
    }
    ancestors.delete(value);
  }

  function parseInput(input, reporter) {
    if (typeof input === "string") {
      if (utf8ByteLength(input) > BUILD_LIMITS.maxFileBytes) {
        reporter.fatal("file_too_large", "$", "Build JSON exceeds the 5 MiB limit.");
        return null;
      }
      try {
        const parsed = JSON.parse(input);
        inspectJsonValue(parsed, reporter);
        return parsed;
      } catch {
        reporter.fatal("malformed_json", "$", "Build content is not valid JSON.");
        return null;
      }
    }

    inspectJsonValue(input, reporter);
    if (reporter.diagnostics.fatalCount) return null;
    const serialized = JSON.stringify(input);
    if (utf8ByteLength(serialized) > BUILD_LIMITS.maxFileBytes) {
      reporter.fatal("file_too_large", "$", "Build JSON exceeds the 5 MiB limit.");
      return null;
    }
    return input;
  }

  function requireRecord(parent, key, path, reporter) {
    if (!isRecord(parent) || !hasOwn(parent, key)) {
      reporter.fatal("missing_required_field", path, `${path} is required.`);
      return null;
    }
    if (!isRecord(parent[key])) {
      reporter.fatal("invalid_type", path, `${path} must be an object.`);
      return null;
    }
    return parent[key];
  }

  function readNullableIdentifier(parent, key, path, reporter) {
    if (!isRecord(parent) || !hasOwn(parent, key)) {
      reporter.fatal("missing_required_field", path, `${path} is required.`);
      return null;
    }
    const value = parent[key];
    if (value !== null && typeof value !== "string") {
      reporter.fatal("invalid_type", path, `${path} must be a string or null.`);
      return null;
    }
    if (typeof value === "string" && value.length === 0) {
      reporter.fatal("invalid_value", path, `${path} must not be empty.`);
    }
    if (typeof value === "string" && value.length > BUILD_LIMITS.maxKnownStringLength) {
      reporter.fatal("string_too_long", path, `${path} exceeds 256 characters.`);
    }
    return value;
  }

  function readBudget(parent, key, minimum, maximum, path, reporter) {
    if (!isRecord(parent) || !hasOwn(parent, key)) {
      reporter.fatal("missing_required_field", path, `${path} is required.`);
      return null;
    }
    const value = parent[key];
    if (!Number.isInteger(value)) {
      reporter.fatal("invalid_type", path, `${path} must be an integer.`);
      return null;
    }
    if (value < minimum || value > maximum) {
      reporter.fatal("invalid_value", path, `${path} is outside the schema-v1 range.`);
    }
    return value;
  }

  function optionContains(option, value, category) {
    if (option === undefined || option === null) return true;
    if (typeof option === "function") return Boolean(option(value, category));
    if (typeof option.has === "function") return option.has(value);
    if (Array.isArray(option)) return option.includes(value);
    throw new TypeError("Known-value options must be functions, arrays, or Set-like objects.");
  }

  function compareNodeIds(left, right) {
    const integerPattern = /^-?\d+$/;
    if (integerPattern.test(left) && integerPattern.test(right)) {
      const leftNumber = BigInt(left);
      const rightNumber = BigInt(right);
      if (leftNumber < rightNumber) return -1;
      if (leftNumber > rightNumber) return 1;
    }
    return left < right ? -1 : left > right ? 1 : 0;
  }

  function sortedUnique(values, category) {
    const unique = [...new Set(values)];
    return unique.sort(category === "instilledPassives" ? undefined : compareNodeIds);
  }

  function readAllocation(parent, key, reporter, knownValues) {
    const path = `build.allocations.${key}`;
    if (!isRecord(parent) || !hasOwn(parent, key)) {
      reporter.fatal("missing_required_field", path, `${path} is required.`);
      return { active: [], unresolved: [] };
    }
    const values = parent[key];
    if (!Array.isArray(values)) {
      reporter.fatal("invalid_type", path, `${path} must be an array.`);
      return { active: [], unresolved: [] };
    }
    if (values.length > BUILD_LIMITS.maxAllocationEntries) {
      reporter.fatal(
        "allocation_limit_exceeded",
        path,
        `${path} exceeds ${BUILD_LIMITS.maxAllocationEntries} entries.`,
      );
      return { active: [], unresolved: [] };
    }

    const seen = new Set();
    const active = [];
    const unresolved = [];
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index];
      const entryPath = `${path}[${index}]`;
      if (typeof value !== "string") {
        reporter.fatal("invalid_type", entryPath, "Allocation identifiers must be strings.");
        continue;
      }
      if (value.length === 0) {
        reporter.fatal("invalid_value", entryPath, "Allocation identifiers must not be empty.");
        continue;
      }
      if (value.length > BUILD_LIMITS.maxKnownStringLength) {
        reporter.fatal("string_too_long", entryPath, "Allocation identifier exceeds 256 characters.");
        continue;
      }
      if (seen.has(value)) {
        reporter.warn("duplicate_allocation", entryPath, `Duplicate ${key} allocation: ${value}`);
        continue;
      }
      seen.add(value);
      if (!optionContains(knownValues, value, key)) {
        unresolved.push(value);
        reporter.warn(
          "unresolved_allocation",
          entryPath,
          `${value} is unresolved in the currently loaded passive tree.`,
        );
        continue;
      }
      active.push(value);
    }
    return {
      active: sortedUnique(active, key),
      unresolved: sortedUnique(unresolved, key),
    };
  }

  function readUi(source, reporter) {
    if (!hasOwn(source, "ui")) return {};
    if (!isRecord(source.ui)) {
      reporter.fatal("invalid_type", "ui", "ui must be an object when present.");
      return {};
    }

    const ui = {};
    if (hasOwn(source.ui, "camera")) {
      if (!isRecord(source.ui.camera)) {
        reporter.fatal("invalid_type", "ui.camera", "ui.camera must be an object.");
      } else {
        const camera = {};
        for (const key of CAMERA_KEYS) {
          if (!hasOwn(source.ui.camera, key)) continue;
          const value = source.ui.camera[key];
          if (typeof value !== "number" || !Number.isFinite(value)) {
            reporter.fatal("invalid_type", `ui.camera.${key}`, `ui.camera.${key} must be finite.`);
            continue;
          }
          if (key === "scale" && (value < 0.008 || value > 2.5)) {
            camera.scale = Math.min(2.5, Math.max(0.008, value));
            reporter.warn("ui_scale_clamped", "ui.camera.scale", "Camera scale was clamped.");
          } else {
            camera[key] = value;
          }
        }
        ui.camera = camera;
      }
    }

    if (hasOwn(source.ui, "weaponMode")) {
      const value = source.ui.weaponMode;
      if (value !== "general" && value !== "ws1" && value !== "ws2") {
        reporter.fatal("invalid_value", "ui.weaponMode", "ui.weaponMode is not supported.");
      } else {
        ui.weaponMode = value;
      }
    }

    for (const key of ["showAscendancy", "showLockedConditional", "showInstilledOnGraph"]) {
      if (!hasOwn(source.ui, key)) continue;
      if (typeof source.ui[key] !== "boolean") {
        reporter.fatal("invalid_type", `ui.${key}`, `ui.${key} must be boolean.`);
      } else {
        ui[key] = source.ui[key];
      }
    }
    return ui;
  }

  function comparePlacements(left, right) {
    const a = BigInt(left.socketNodeId); const b = BigInt(right.socketNodeId);
    if (a !== b) return a < b ? -1 : 1;
    return left.socketNodeId < right.socketNodeId ? -1 : left.socketNodeId > right.socketNodeId ? 1
      : left.instanceId < right.instanceId ? -1 : left.instanceId > right.instanceId ? 1 : 0;
  }

  function readJewels(build, sourceVersion, reporter, optionsForJewels = null) {
    if (sourceVersion === 1) return { instances: [], placements: [] };
    const jewels = requireRecord(build, "jewels", "build.jewels", reporter);
    if (!jewels) return { instances: [], placements: [] };
    const readArray = (key, maximum) => {
      const path = `build.jewels.${key}`;
      if (!hasOwn(jewels, key)) { reporter.fatal("missing_required_field", path, `${path} is required.`); return []; }
      if (!Array.isArray(jewels[key])) { reporter.fatal("invalid_type", path, `${path} must be an array.`); return []; }
      if (jewels[key].length > maximum) reporter.fatal("jewel_limit_exceeded", path, `${path} exceeds ${maximum} entries.`);
      return jewels[key];
    };
    function validProperties(value, path, depth = 0) {
      if (depth > BUILD_LIMITS.maxTraversalDepth) { reporter.fatal("traversal_depth_exceeded", path, "Jewel properties exceed traversal depth."); return false; }
      if (value === null || ["string", "boolean", "number"].includes(typeof value)) return true;
      if (Array.isArray(value)) return value.every((entry, index) => validProperties(entry, `${path}[${index}]`, depth + 1));
      if (!isRecord(value)) return false;
      return Object.keys(value).every((key) => {
        if (key.length > BUILD_LIMITS.maxKnownStringLength) { reporter.fatal("string_too_long", `${path}.${key}`, "Jewel property key exceeds 256 characters."); return false; }
        return validProperties(value[key], `${path}.${key}`, depth + 1);
      });
    }
    const sourceInstances = readArray("instances", BUILD_LIMITS.maxJewelInstances);
    const sourcePlacements = readArray("placements", BUILD_LIMITS.maxJewelPlacements);
    const ids = new Set(); const instances = [];
    sourceInstances.forEach((item, index) => {
      const path = `build.jewels.instances[${index}]`;
      if (!isRecord(item)) { reporter.fatal("invalid_type", path, "Instance must be an object."); return; }
      if (typeof item.id !== "string" || !INSTANCE_ID.test(item.id)) reporter.fatal("invalid_value", `${path}.id`, "Invalid jewel instance ID.");
      if (typeof item.definitionId !== "string" || item.definitionId.length > BUILD_LIMITS.maxKnownStringLength || !DEFINITION_ID.test(item.definitionId)) reporter.fatal("invalid_value", `${path}.definitionId`, "Invalid jewel definition ID.");
      if (!isRecord(item.properties) || !validProperties(item.properties, `${path}.properties`)) reporter.fatal("invalid_type", `${path}.properties`, "properties must be a bounded JSON object.");
      if (ids.has(item.id)) reporter.fatal("duplicate_instance_id", `${path}.id`, `Duplicate jewel instance ID: ${item.id}`); else ids.add(item.id);
      if (typeof item.id === "string" && INSTANCE_ID.test(item.id) && typeof item.definitionId === "string" && DEFINITION_ID.test(item.definitionId) && isRecord(item.properties)) instances.push(safeClone(item));
    });
    const pairs = new Set(); const placements = [];
    sourcePlacements.forEach((item, index) => {
      const path = `build.jewels.placements[${index}]`;
      if (!isRecord(item)) { reporter.fatal("invalid_type", path, "Placement must be an object."); return; }
      if (typeof item.socketNodeId !== "string" || !SOCKET_ID.test(item.socketNodeId)) reporter.fatal("invalid_value", `${path}.socketNodeId`, "Invalid socket node ID.");
      if (typeof item.instanceId !== "string" || !INSTANCE_ID.test(item.instanceId)) reporter.fatal("invalid_value", `${path}.instanceId`, "Invalid jewel instance ID.");
      if (typeof item.socketNodeId !== "string" || !SOCKET_ID.test(item.socketNodeId) || typeof item.instanceId !== "string" || !INSTANCE_ID.test(item.instanceId)) return;
      const pair = `${item.socketNodeId}\u0000${item.instanceId}`;
      if (pairs.has(pair)) { reporter.warn("duplicate_placement", path, "Duplicate jewel placement was preserved once."); return; }
      pairs.add(pair); if (!ids.has(item.instanceId)) reporter.warn("dangling_placement", `${path}.instanceId`, "Placement references a missing jewel instance.");
      placements.push(safeClone(item));
    });
    const knownDefinitions = optionsForJewels?.definitions;
    const knownSockets = optionsForJewels?.sockets;
    const byInstance = new Map(instances.map(item => [item.id, item]));
    const socketCounts = new Map(); const instanceCounts = new Map();
    for (const placement of placements) { socketCounts.set(placement.socketNodeId, (socketCounts.get(placement.socketNodeId) || 0) + 1); instanceCounts.set(placement.instanceId, (instanceCounts.get(placement.instanceId) || 0) + 1); }
    for (const instance of instances) if (knownDefinitions && !optionContains(knownDefinitions, instance.definitionId, "definition")) reporter.warn("unknown_definition", "build.jewels.instances", `${instance.definitionId} is preserved but inactive.`);
    for (const placement of placements) {
      const descriptor = knownSockets && (typeof knownSockets.get === "function" ? knownSockets.get(placement.socketNodeId) : null);
      if (knownSockets && !descriptor) reporter.warn("unknown_socket", "build.jewels.placements", `${placement.socketNodeId} is preserved but inactive.`);
      else if (descriptor && descriptor.category !== "ordinary") reporter.warn("special_socket", "build.jewels.placements", `${placement.socketNodeId} is preserved but inactive.`);
      if (socketCounts.get(placement.socketNodeId) > 1) reporter.warn("socket_conflict", "build.jewels.placements", "Multiple instances occupy this socket; all are inactive.");
      if (instanceCounts.get(placement.instanceId) > 1) reporter.warn("instance_conflict", "build.jewels.placements", "One instance occupies multiple sockets; all are inactive.");
    }
    return { instances: instances.sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0), placements: placements.sort(comparePlacements) };
  }

  function decodeBuildDocument(input, options = {}) {
    const reporter = makeDiagnostics();
    const source = parseInput(input, reporter);
    if (source === null && reporter.diagnostics.fatalCount === 0) {
      reporter.fatal("invalid_root", "$", "Build JSON root must be an object.");
    }
    if (source === null || reporter.diagnostics.fatalCount) {
      return { ok: false, value: null, preservation: null, diagnostics: reporter.diagnostics };
    }
    if (!isRecord(source)) {
      reporter.fatal("invalid_root", "$", "Build JSON root must be an object.");
      return { ok: false, value: null, preservation: null, diagnostics: reporter.diagnostics };
    }

    if (!hasOwn(source, "format") || source.format !== BUILD_FORMAT) {
      reporter.fatal("invalid_format", "format", `format must equal ${BUILD_FORMAT}.`);
    }
    if (!hasOwn(source, "schemaVersion") || !Number.isInteger(source.schemaVersion)
      || source.schemaVersion < 1) {
      reporter.fatal("invalid_schema_version", "schemaVersion", "schemaVersion must be a positive integer.");
    } else if (source.schemaVersion > BUILD_SCHEMA_VERSION) {
      reporter.fatal(
        "unsupported_schema_version",
        "schemaVersion",
        `Schema version ${source.schemaVersion} is newer than supported version 2.`,
      );
    }

    const build = requireRecord(source, "build", "build", reporter);
    const classSource = requireRecord(build, "class", "build.class", reporter);
    const budgetsSource = requireRecord(build, "budgets", "build.budgets", reporter);
    const allocationsSource = requireRecord(build, "allocations", "build.allocations", reporter);
    const optionsForJewels = options.jewelCatalog ? {
      definitions: new Set((options.jewelCatalog.definitions || []).map(item => item.definitionId)),
      sockets: new Map((options.jewelCatalog.sockets || []).map(item => [item.nodeId, item])),
    } : null;
    const jewels = readJewels(build, source.schemaVersion, reporter, optionsForJewels);

    const base = readNullableIdentifier(classSource, "base", "build.class.base", reporter);
    const ascendancyId = readNullableIdentifier(
      classSource,
      "ascendancyId",
      "build.class.ascendancyId",
      reporter,
    );
    if (base === null && ascendancyId !== null) {
      reporter.fatal(
        "invalid_class_selection",
        "build.class.ascendancyId",
        "ascendancyId must be null when base is null.",
      );
    }
    if (typeof base === "string" && !optionContains(options.knownBaseClasses, base, "base")) {
      reporter.fatal("unknown_base_class", "build.class.base", `${base} is not a known base class.`);
    }
    let activeAscendancyId = ascendancyId;
    let unresolvedAscendancyId = null;
    if (typeof ascendancyId === "string"
      && !optionContains(options.knownAscendancies, ascendancyId, base)) {
      activeAscendancyId = null;
      unresolvedAscendancyId = ascendancyId;
      reporter.warn(
        "unresolved_ascendancy",
        "build.class.ascendancyId",
        `${ascendancyId} is unresolved for the selected base class.`,
      );
    }

    const budgets = {
      passive: readBudget(budgetsSource, "passive", 1, 300, "build.budgets.passive", reporter),
      weaponSet: readBudget(budgetsSource, "weaponSet", 0, 100, "build.budgets.weaponSet", reporter),
      ascendancy: readBudget(budgetsSource, "ascendancy", 8, 8, "build.budgets.ascendancy", reporter),
    };

    const allocationResults = {};
    for (const key of ALLOCATION_KEYS) {
      const knownValues = key === "instilledPassives"
        ? options.knownInstilledPassives
        : key === "ascendancy" && unresolvedAscendancyId !== null
          ? () => false
          : options.knownNodeIds;
      allocationResults[key] = readAllocation(allocationsSource, key, reporter, knownValues);
    }

    const normalIds = new Set(allocationResults.normal.active);
    for (const key of ["weaponSet1", "weaponSet2"]) {
      allocationResults[key].active = allocationResults[key].active.filter((identifier) => {
        if (!normalIds.has(identifier)) return true;
        reporter.warn(
          "redundant_allocation",
          `build.allocations.${key}`,
          `${identifier} is already active in normal allocations.`,
        );
        return false;
      });
    }

    if (Number.isInteger(budgets.passive)) {
      const effectiveUsed = allocationResults.normal.active.length + Math.max(
        allocationResults.weaponSet1.active.length,
        allocationResults.weaponSet2.active.length,
      );
      if (effectiveUsed > budgets.passive) {
        reporter.warn(
          "passive_budget_exceeded",
          "build.budgets.passive",
          `Resolved allocations use ${effectiveUsed} passive points with a budget of ${budgets.passive}.`,
        );
      }
    }
    if (Number.isInteger(budgets.weaponSet)) {
      for (const key of ["weaponSet1", "weaponSet2"]) {
        if (allocationResults[key].active.length > budgets.weaponSet) {
          reporter.warn(
            "weapon_budget_exceeded",
            `build.allocations.${key}`,
            `${key} exceeds the saved weapon-set budget.`,
          );
        }
      }
    }
    if (Number.isInteger(budgets.ascendancy)
      && allocationResults.ascendancy.active.length > budgets.ascendancy) {
      reporter.warn(
        "ascendancy_budget_exceeded",
        "build.allocations.ascendancy",
        "Ascendancy allocations exceed the saved ascendancy budget.",
      );
    }

    const ui = readUi(source, reporter);
    if (reporter.diagnostics.fatalCount) {
      return { ok: false, value: null, preservation: null, diagnostics: reporter.diagnostics };
    }

    const allocations = {};
    const unresolvedAllocations = {};
    for (const key of ALLOCATION_KEYS) {
      allocations[key] = allocationResults[key].active;
      unresolvedAllocations[key] = allocationResults[key].unresolved;
    }

    return {
      ok: true,
      value: {
        format: BUILD_FORMAT,
        schemaVersion: BUILD_SCHEMA_VERSION,
        build: {
          class: { base, ascendancyId: activeAscendancyId },
          budgets,
          allocations,
          jewels,
        },
        ui,
      },
      preservation: {
        source: safeClone(source),
        unresolvedAllocations,
        unresolvedAscendancyId,
      },
      diagnostics: reporter.diagnostics,
    };
  }

  function composeUi(value, source) {
    const uiValue = isRecord(value) ? value : {};
    const uiSource = isRecord(source) ? source : {};
    const entries = [];
    if (hasOwn(uiValue, "camera")) {
      const cameraValue = isRecord(uiValue.camera) ? uiValue.camera : {};
      const cameraSource = isRecord(uiSource.camera) ? uiSource.camera : {};
      const cameraEntries = CAMERA_KEYS
        .filter((key) => hasOwn(cameraValue, key))
        .map((key) => [key, cameraValue[key]]);
      entries.push(["camera", mergeRecord(cameraSource, cameraEntries, CAMERA_KEYS)]);
    }
    for (const key of UI_KEYS.slice(1)) {
      if (hasOwn(uiValue, key)) entries.push([key, uiValue[key]]);
    }
    return mergeRecord(uiSource, entries, UI_KEYS);
  }

  function createBuildDocument(value, preservation = null) {
    if (!isRecord(value) || !isRecord(value.build)) {
      throw new TypeError("A normalized Build value is required.");
    }
    const source = isRecord(preservation?.source) ? preservation.source : {};
    const sourceBuild = isRecord(source.build) ? source.build : {};
    const sourceClass = isRecord(sourceBuild.class) ? sourceBuild.class : {};
    const sourceBudgets = isRecord(sourceBuild.budgets) ? sourceBuild.budgets : {};
    const sourceAllocations = isRecord(sourceBuild.allocations) ? sourceBuild.allocations : {};
    const unresolved = isRecord(preservation?.unresolvedAllocations)
      ? preservation.unresolvedAllocations
      : {};

    const classValue = value.build.class;
    const budgetsValue = value.build.budgets;
    const allocationsValue = value.build.allocations;
    if (!isRecord(classValue) || !isRecord(budgetsValue) || !isRecord(allocationsValue)) {
      throw new TypeError("Normalized Build class, budgets, and allocations are required.");
    }

    const activeNormalIds = new Set(
      Array.isArray(allocationsValue.normal) ? allocationsValue.normal : [],
    );
    const allocationEntries = ALLOCATION_KEYS.map((key) => {
      let active = Array.isArray(allocationsValue[key]) ? allocationsValue[key] : [];
      if (key === "weaponSet1" || key === "weaponSet2") {
        active = active.filter((identifier) => !activeNormalIds.has(identifier));
      }
      const preserved = Array.isArray(unresolved[key]) ? unresolved[key] : [];
      return [key, sortedUnique([...active, ...preserved], key)];
    });
    const allocations = mergeRecord(sourceAllocations, allocationEntries, ALLOCATION_KEYS);
    const preservedAscendancyId = typeof preservation?.unresolvedAscendancyId === "string"
      ? preservation.unresolvedAscendancyId
      : null;
    const classDocument = mergeRecord(sourceClass, [
      ["base", classValue.base],
      ["ascendancyId", classValue.ascendancyId ?? preservedAscendancyId],
    ], ["base", "ascendancyId"]);
    const budgetsDocument = mergeRecord(sourceBudgets, [
      ["passive", budgetsValue.passive],
      ["weaponSet", budgetsValue.weaponSet],
      ["ascendancy", budgetsValue.ascendancy],
    ], ["passive", "weaponSet", "ascendancy"]);
    const jewelValue = isRecord(value.build.jewels) ? value.build.jewels : { instances: [], placements: [] };
    const jewelSource = isRecord(sourceBuild.jewels) ? sourceBuild.jewels : {};
    const jewelsDocument = mergeRecord(jewelSource, [
      ["instances", Array.isArray(jewelValue.instances) ? jewelValue.instances.slice().sort((a,b) => String(a.id).localeCompare(String(b.id))) : []],
      ["placements", Array.isArray(jewelValue.placements) ? jewelValue.placements.slice().sort(comparePlacements) : []],
    ], ["instances", "placements"]);
    const buildDocument = mergeRecord(sourceBuild, [
      ["class", classDocument],
      ["budgets", budgetsDocument],
      ["allocations", allocations],
      ["jewels", jewelsDocument],
    ], ["class", "budgets", "allocations", "jewels"]);
    const uiDocument = composeUi(value.ui, source.ui);

    const document = mergeRecord(source, [
      ["format", BUILD_FORMAT],
      ["schemaVersion", BUILD_SCHEMA_VERSION],
      ["build", buildDocument],
      ["ui", uiDocument],
    ], ["format", "schemaVersion", "build", "ui"]);
    const validation = decodeBuildDocument(document);
    if (!validation.ok) {
      const error = new TypeError("Cannot create an invalid schema-v1 Build document.");
      error.diagnostics = validation.diagnostics;
      throw error;
    }
    return document;
  }

  function serializeBuildDocument(value, preservation = null) {
    const serialized = `${JSON.stringify(createBuildDocument(value, preservation), null, 2)}\n`;
    if (utf8ByteLength(serialized) > BUILD_LIMITS.maxFileBytes) {
      throw new RangeError("Serialized Build JSON exceeds the 5 MiB limit.");
    }
    return serialized;
  }

  return Object.freeze({
    BUILD_FORMAT,
    BUILD_SCHEMA_VERSION,
    BUILD_LIMITS,
    createBuildDocument,
    decodeBuildDocument,
    serializeBuildDocument,
  });
});
