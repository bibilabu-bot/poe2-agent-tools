(function initWeGameImportAdapter(root, factory) {
  const api = factory(typeof require === "function" ? require("./passive-id-map.js") : root.plannerPassiveIdMap);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.weGameImportAdapter = api;
})(typeof globalThis === "object" ? globalThis : this, function weGameImportAdapterFactory(passiveIdApi) {
  "use strict";

  const LIMITS = Object.freeze({ depth: 32, array: 20000, objectKeys: 20000, diagnostics: 100, string: 4096, key: 256 });
  const ordinarySockets = new Set(["2491", "7960", "21984", "26196", "26725", "32763", "46882", "54127", "55190", "60735", "61419", "61834"]);
  const sensitiveKeyFragments = Object.freeze(["openid", "roleid", "sharecode", "rolename", "charactername", "nickname", "accountid", "userid", "token", "authorization", "cookie", "credential", "password", "secret"]);
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const isSensitiveKey = key => sensitiveKeyFragments.some(fragment => key.toLowerCase().replace(/[^a-z0-9]/g, "").includes(fragment));
  const compareIds = (a, b) => Number(a) - Number(b);

  class WeGameAdapterError extends Error {
    constructor(code, message) { super(message); this.name = "WeGameAdapterError"; this.code = code; }
  }

  function inspect(value, depth = 0, seen = new Set()) {
    if (depth > LIMITS.depth) throw new WeGameAdapterError("WEGAME_SCHEMA_LIMIT", "WeGame response nesting is too deep.");
    if (typeof value === "string" && value.length > LIMITS.string) throw new WeGameAdapterError("WEGAME_SCHEMA_LIMIT", "WeGame response contains an oversized string.");
    if (!value || typeof value !== "object") return;
    if (seen.has(value)) throw new WeGameAdapterError("WEGAME_SCHEMA_INVALID", "WeGame response contains a cycle.");
    seen.add(value);
    const keys = Object.keys(value);
    if (keys.length > (Array.isArray(value) ? LIMITS.array : LIMITS.objectKeys)) throw new WeGameAdapterError("WEGAME_SCHEMA_LIMIT", "WeGame response collection is too large.");
    if (keys.some(key => key.length > LIMITS.key)) throw new WeGameAdapterError("WEGAME_SCHEMA_LIMIT", "WeGame response contains an oversized object key.");
    for (const key of keys) inspect(value[key], depth + 1, seen);
    seen.delete(value);
  }

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function assertEnvelope(value, name) {
    if (!value || typeof value !== "object" || !value.result || value.result.error_code !== 0) {
      throw new WeGameAdapterError("WEGAME_BUSINESS_ERROR", `${name} did not contain a successful WeGame result.`);
    }
  }
  function validNumeric(value) {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value)
      : typeof value === "string" && /^(0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value)) ? value : null;
  }

  function createDiagnosticCollector() {
    const details = []; let total = 0;
    return {
      add(code, severity, path, message) { total += 1; if (details.length < LIMITS.diagnostics) details.push(Object.freeze({ code, severity, path, message })); },
      result() { return Object.freeze({ total, truncated: total > details.length, details: Object.freeze(details) }); },
    };
  }

  function preserveInert(value, path, diagnostics) {
    if (Array.isArray(value)) return value.map((item, index) => preserveInert(item, `${path}[${index}]`, diagnostics));
    if (!value || typeof value !== "object") return value;
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (isSensitiveKey(key)) {
        diagnostics.add("SENSITIVE_TALENT_FIELD_REDACTED", "warning", `${path}.[redacted]`, "Identity-bearing talent evidence was excluded from the candidate.");
        continue;
      }
      output[key] = preserveInert(value[key], `${path}.${key}`, diagnostics);
    }
    return output;
  }

  function adaptWeGamePassiveImport(input, officialTree) {
    inspect(input);
    const roleInfo = input?.roleInfo;
    const talentResponse = input?.talentTree;
    assertEnvelope(roleInfo, "GetRoleInfo"); assertEnvelope(talentResponse, "GetTalentTree");
    if (!roleInfo.role || typeof roleInfo.role !== "object" || !talentResponse.talent_tree || typeof talentResponse.talent_tree !== "object") {
      throw new WeGameAdapterError("WEGAME_SCHEMA_DRIFT", "Required role or talent_tree data is missing.");
    }
    if (!officialTree || typeof officialTree.nodes !== "object" || !Array.isArray(officialTree.jewelSlots)) {
      throw new WeGameAdapterError("WEGAME_TREE_INVALID", "Locked official passive tree is unavailable or malformed.");
    }
    const diagnostics = createDiagnosticCollector();
    const jewelSlots = new Set(officialTree.jewelSlots.map(String));
    const mapper = passiveIdApi.createPassiveIdMap(officialTree, { classifyNumeric(id, node) {
      if (ordinarySockets.has(id) && jewelSlots.has(id) && node?.isJewelSocket === true && !node?.isBlighted) return "sockets";
      if (node?.isJewelSocket === true) return "special-socket";
      if (node?.ascendancyId) return "ascendancy";
      return "normal";
    }});
    const tree = talentResponse.talent_tree;
    if (!Array.isArray(tree.hashes)) throw new WeGameAdapterError("WEGAME_SCHEMA_DRIFT", "talent_tree.hashes must be an array.");

    const active = { normal: [], ascendancy: [], sockets: [] };
    const unresolved = [];
    function mapList(values, path, target, activeAllowed) {
      if (!Array.isArray(values)) throw new WeGameAdapterError("WEGAME_SCHEMA_DRIFT", `${path} must be an array.`);
      if (values.length > LIMITS.array) throw new WeGameAdapterError("WEGAME_SCHEMA_LIMIT", `${path} is too large.`);
      const seen = new Set();
      for (let index = 0; index < values.length; index += 1) {
        const numericId = validNumeric(values[index]);
        if (!numericId) { unresolved.push({ source: path, index, sourceValue: preserveInert(values[index], `${path}[${index}]`, diagnostics), reason: "invalid-id", status: "inactive" }); diagnostics.add("INVALID_PASSIVE_ID", "warning", `${path}[${index}]`, "Passive ID is not a non-negative safe integer."); continue; }
        if (seen.has(numericId)) { diagnostics.add("DUPLICATE_PASSIVE_ID", "warning", path, `Duplicate passive ${numericId} was preserved once.`); continue; }
        seen.add(numericId);
        const identity = mapper.numericToOfficial(numericId); const classification = mapper.classifyNumeric(numericId);
        if (identity.status !== "mapped" || classification.status !== "mapped") { unresolved.push({ source: path, numericId, reason: identity.status }); diagnostics.add("UNKNOWN_PASSIVE_ID", "warning", path, `Passive ${numericId} is not present in the locked tree.`); continue; }
        target.push(Object.freeze({ numericId, officialId: identity.officialId, classification: classification.classification, active: activeAllowed }));
      }
    }
    const mappedHashes = []; mapList(tree.hashes, "talent_tree.hashes", mappedHashes, true);
    for (const item of mappedHashes) {
      if (own(active, item.classification)) active[item.classification].push(item);
      else { unresolved.push({ source: "talent_tree.hashes", numericId: item.numericId, officialId: item.officialId, reason: item.classification }); diagnostics.add("UNSUPPORTED_SPECIAL_SOCKET", "warning", "talent_tree.hashes", `Special jewel socket ${item.numericId} is preserved but inactive.`); }
    }

    const sourceSets = [];
    const specialisations = tree.specialisations;
    if (specialisations !== undefined && (!specialisations || typeof specialisations !== "object" || Array.isArray(specialisations))) throw new WeGameAdapterError("WEGAME_SCHEMA_DRIFT", "talent_tree.specialisations must be an object.");
    for (const label of Object.keys(specialisations || {}).sort()) {
      const mapped = []; mapList(specialisations[label], `talent_tree.specialisations.${label}`, mapped, false);
      sourceSets.push(Object.freeze({ sourceLabel: label, status: "inactive", requiresDecision: true, targetWeaponSet: null, passives: Object.freeze(mapped) }));
    }
    if (sourceSets.length) diagnostics.add("WEAPON_SET_MAPPING_UNRESOLVED", "warning", "talent_tree.specialisations", "Source-labelled specialisations are inactive until their native weapon-set meaning is confirmed.");

    const overrides = tree.skill_overrides === undefined ? {} : tree.skill_overrides;
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) throw new WeGameAdapterError("WEGAME_SCHEMA_DRIFT", "talent_tree.skill_overrides must be an object.");
    const preservedOverrides = [];
    for (const key of Object.keys(overrides).sort(compareIds)) {
      const numericId = validNumeric(key); const value = overrides[key];
      const grantedKeys = ["grantedStrength", "grantedDexterity", "grantedIntelligence"].filter(name => own(value || {}, name));
      const validOverride = numericId && value && typeof value === "object" && !Array.isArray(value)
        && typeof value.id === "string" && value.id.length > 0 && value.id.length <= 256
        && (!own(value, "stats") || (Array.isArray(value.stats) && value.stats.length <= 32 && value.stats.every(stat => typeof stat === "string")))
        && grantedKeys.length === 1 && grantedKeys.every(name => Number.isSafeInteger(value[name]) && value[name] >= 0 && value[name] <= 1000);
      if (!validOverride) { diagnostics.add("INVALID_SKILL_OVERRIDE", "warning", `talent_tree.skill_overrides.${key}`, "Malformed override is preserved but inactive."); }
      else {
        const identity = mapper.numericToOfficial(numericId);
        if (identity.status !== "mapped") diagnostics.add("UNKNOWN_OVERRIDE_PASSIVE", "warning", `talent_tree.skill_overrides.${key}`, "Override passive is unknown to the locked tree.");
      }
      preservedOverrides.push(Object.freeze({ numericId: numericId || null, sourceKey: key, status: "inactive", value: preserveInert(value, `talent_tree.skill_overrides.${key}`, diagnostics) }));
    }
    if (preservedOverrides.length) diagnostics.add("SKILL_OVERRIDES_SEMANTIC_LOSS", "warning", "talent_tree.skill_overrides", `${preservedOverrides.length} attribute-choice overrides are preserved but cannot currently be applied by Planner schema v2.`);

    const ascendancies = [...new Set(active.ascendancy.map(item => officialTree.nodes[item.numericId]?.ascendancyId).filter(Boolean))];
    const roleClassName = typeof roleInfo.role.class_name === "string" ? roleInfo.role.class_name.slice(0, 256) : null;
    const classResolution = ascendancies.length === 1
      ? { sourceDisplayName: roleClassName, base: null, ascendancyId: ascendancies[0], status: "requires-confirmation" }
      : { sourceDisplayName: roleClassName, base: null, ascendancyId: null, status: "unresolved" };
    diagnostics.add("CLASS_CONFIRMATION_REQUIRED", "warning", "role.class_name", "Base class is not a durable WeGame field and must be confirmed before transactional application.");
    const interpretedTalentFields = new Set(["hashes", "specialisations", "skill_overrides", "jewel_data"]);
    const uninterpretedTalent = {};
    for (const key of Object.keys(tree).sort()) {
      if (interpretedTalentFields.has(key)) continue;
      if (isSensitiveKey(key)) diagnostics.add("SENSITIVE_TALENT_FIELD_REDACTED", "warning", "talent_tree.[redacted]", "Identity-bearing talent evidence was excluded from the candidate.");
      else uninterpretedTalent[key] = preserveInert(tree[key], `talent_tree.${key}`, diagnostics);
    }

    return Object.freeze({
      format: "poe2-agent-tools-wegame-passive-import", version: 1,
      candidate: Object.freeze({
        transactional: true,
        class: Object.freeze(classResolution),
        active: Object.freeze({ normal: Object.freeze(active.normal), ascendancy: Object.freeze(active.ascendancy), ordinarySockets: Object.freeze(active.sockets) }),
        inactive: Object.freeze({ sourceSpecialisations: Object.freeze(sourceSets), skillOverrides: Object.freeze(preservedOverrides), jewelData: tree.jewel_data === undefined ? null : preserveInert(tree.jewel_data, "talent_tree.jewel_data", diagnostics), uninterpretedTalent: Object.freeze(uninterpretedTalent) }),
        unresolved: Object.freeze(unresolved),
      }),
      diagnostics: diagnostics.result(),
      rawPreservation: Object.freeze({ roleMetadata: Object.freeze({ level: Number.isSafeInteger(roleInfo.role.level) ? roleInfo.role.level : null }), talentTreeFields: Object.freeze(Object.keys(tree).filter(key => !isSensitiveKey(key)).sort()), skillOverrideCount: preservedOverrides.length, jewelDataPreserved: own(tree, "jewel_data"), scope: "memory-only-not-native-schema", equipmentFetched: false, skillsFetched: false }),
    });
  }
  return Object.freeze({ LIMITS, WeGameAdapterError, adaptWeGamePassiveImport });
});
