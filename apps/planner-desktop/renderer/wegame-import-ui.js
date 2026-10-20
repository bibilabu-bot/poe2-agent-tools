(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.plannerWeGameImportUI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const expectedFormat = "poe2-agent-tools-wegame-passive-import";
  const failureMessages = Object.freeze({
    CANDIDATE_FORMAT: "预览格式不支持，请重新读取分享。",
    CANDIDATE_TRANSACTIONAL: "预览缺少事务标记，请重新读取分享。",
    CANDIDATE_LIST: "预览节点列表格式不完整，请重新读取分享。",
    PARTIAL_ACK_REQUIRED: "请勾选实验性部分导入确认。",
    BASE_CLASS_INVALID: "请确认有效的基础职业。",
    ASCENDANCY_MISMATCH: "所选升华与分享中的升华不一致，请重新确认升华。",
    ASCENDANCY_CLASS_MISMATCH: "所选升华不属于当前基础职业，请重新确认职业。",
    PASSIVE_RECORD_INVALID: "节点标识或有效标记异常，请重新读取分享。",
    DUPLICATE_PASSIVE: "节点在多个导入类别中重复，无法安全应用。",
    NODE_MISSING: "当前 Planner 缺少该节点且没有可省略的普通节点证据，无法安全应用。",
    NORMAL_CATEGORY_MISMATCH: "该节点不属于当前 Planner 普通天赋类别。",
    SOCKET_CATEGORY_MISMATCH: "该节点不是受支持的普通珠宝孔。",
    ASCENDANCY_NODE_MISMATCH: "该节点不属于已确认的升华。",
    ASCENDANCY_START_MISSING: "已确认升华的起点在当前目录中不可用。",
    WEAPON_LABEL_INVALID: "来源武器组标记不支持。",
    WEAPON_RECORD_INVALID: "来源武器组节点标识异常，请重新读取分享。",
    UNEXPECTED: "候选校验发生未知异常，请重新读取预览并反馈此错误码。",
  });
  class CandidateError extends Error {
    constructor(code, message, nodeId) {
      super(message); this.code=code;
      if(typeof nodeId==="string" && /^(0|[1-9]\d{0,9})$/.test(nodeId)) this.nodeId=nodeId;
    }
  }
  function candidateFailure(error) {
    const code=error instanceof CandidateError && Object.hasOwn(failureMessages,error.code) ? error.code : "UNEXPECTED";
    const nodeId=code!=="UNEXPECTED" && typeof error.nodeId==="string" && /^(0|[1-9]\d{0,9})$/.test(error.nodeId) ? error.nodeId : null;
    return Object.freeze({code,...(nodeId ? {nodeId} : {}),message:`[${code}] ${nodeId ? `节点 ${nodeId}：` : ""}${failureMessages[code]}`});
  }

  function list(value, path) {
    if (!Array.isArray(value)) throw new CandidateError("CANDIDATE_LIST", `${path} is not an array.`);
    return value;
  }

  function summarize(value) {
    if (!value || value.format !== expectedFormat || value.version !== 1) {
      throw new CandidateError("CANDIDATE_FORMAT", "Unsupported WeGame passive import candidate.");
    }
    const candidate = value.candidate;
    if (!candidate || candidate.transactional !== true) throw new CandidateError("CANDIDATE_TRANSACTIONAL", "WeGame candidate is not transactional.");
    const sourceSets = list(candidate.inactive?.sourceSpecialisations, "candidate.inactive.sourceSpecialisations");
    const sourceSetCounts = Object.fromEntries(sourceSets.map(set => [set.sourceLabel, list(set.passives, `sourceSpecialisations.${set.sourceLabel}.passives`).length]));
    return Object.freeze({
      normal: list(candidate.active?.normal, "candidate.active.normal").length,
      ascendancy: list(candidate.active?.ascendancy, "candidate.active.ascendancy").length,
      ordinarySockets: list(candidate.active?.ordinarySockets, "candidate.active.ordinarySockets").length,
      sourceSpecialisations: list(candidate.inactive?.sourceSpecialisations, "candidate.inactive.sourceSpecialisations").length,
      weaponSet1: sourceSetCounts.set1 || 0,
      weaponSet2: sourceSetCounts.set2 || 0,
      skillOverrides: list(candidate.inactive?.skillOverrides, "candidate.inactive.skillOverrides").length,
      jewelData: candidate.inactive?.jewelData == null ? 0 : 1,
      unresolved: list(candidate.unresolved, "candidate.unresolved").length,
      diagnostics: Number.isSafeInteger(value.diagnostics?.total) ? value.diagnostics.total : 0,
    });
  }

  function createPlannerCandidate(value, confirmation, current, catalog) {
    const counts = summarize(value);
    const base = confirmation?.baseClassName;
    const ascendancyId = confirmation?.ascendancyId || null;
    if (!confirmation?.partialImportAcknowledged) throw new CandidateError("PARTIAL_ACK_REQUIRED", "Partial import must be acknowledged.");
    if (!base || !catalog.classStartIds.has(base)) throw new CandidateError("BASE_CLASS_INVALID", "A valid base class must be confirmed.");
    const sourceAscendancy = value.candidate.class?.ascendancyId || null;
    if (sourceAscendancy !== ascendancyId) throw new CandidateError("ASCENDANCY_MISMATCH", "Confirmed ascendancy does not match the imported allocation evidence.");
    if (ascendancyId && !catalog.ascendanciesByClass.get(base)?.has(ascendancyId)) {
      throw new CandidateError("ASCENDANCY_CLASS_MISMATCH", "Confirmed ascendancy does not belong to the selected base class.");
    }

    const normal = new Set([String(catalog.classStartIds.get(base))]);
    const asc = new Set();
    const weapon1 = new Set();
    const weapon2 = new Set();
    const importedFreeAscendancyIds = new Set();
    const weaponSetOmissions=[];
    const normalOmissions=[];
    const seen = new Set();
    function accept(records, expected, target) {
      for (const record of records) {
        const id = typeof record?.numericId === "string" && /^(0|[1-9]\d*)$/.test(record.numericId) ? record.numericId : "";
        if (!id || typeof record?.officialId !== "string" || !record.officialId || record.active !== true) throw new CandidateError("PASSIVE_RECORD_INVALID", "Imported passive identifiers are missing or conflicting.",id);
        if (seen.has(id)) throw new CandidateError("DUPLICATE_PASSIVE", "Imported passive identifiers are missing or conflicting.",id);
        seen.add(id);
        if (!catalog.nodeIds.has(id)) {
          // Main's locked-tree adapter has already mapped and classified this ID.
          // Preserve the existing explicit partial-import policy, never activate it.
          if(expected==="normal" && record.classification==="normal") {
            normalOmissions.push({sourceLabel:"normal",numericId:id,reason:"missing-from-planner"}); continue;
          }
          throw new CandidateError("NODE_MISSING", `Imported passive ${id} is missing from the current Planner catalog.`,id);
        }
        if (expected === "normal" && !catalog.normalIds.has(id)) throw new CandidateError("NORMAL_CATEGORY_MISMATCH", `Imported passive ${id} is not an ordinary Planner passive.`,id);
        if (expected === "socket" && !catalog.ordinarySocketIds.has(id)) throw new CandidateError("SOCKET_CATEGORY_MISMATCH", `Imported passive ${id} is not a supported ordinary socket.`,id);
        if (expected === "ascendancy" && catalog.ascendancyIds.get(id) !== ascendancyId) throw new CandidateError("ASCENDANCY_NODE_MISMATCH", `Imported passive ${id} conflicts with the confirmed ascendancy.`,id);
        if (expected === "ascendancy" && record.pointCost === 0) importedFreeAscendancyIds.add(id);
        target.add(id);
      }
    }
    accept(value.candidate.active.normal, "normal", normal);
    accept(value.candidate.active.ordinarySockets, "socket", normal);
    if (ascendancyId) {
      const start = catalog.ascendancyStartIds.get(ascendancyId);
      if (!start) throw new CandidateError("ASCENDANCY_START_MISSING", "The confirmed ascendancy start is unavailable.");
      asc.add(String(start));
    }
    accept(value.candidate.active.ascendancy, "ascendancy", asc);
    const sourceSets=value.candidate.inactive.sourceSpecialisations;
    for(const sourceSet of sourceSets) {
      const target=sourceSet.sourceLabel==="set1" ? weapon1 : sourceSet.sourceLabel==="set2" ? weapon2 : null;
      if(!target) throw new CandidateError("WEAPON_LABEL_INVALID", "Unsupported source specialisation label.");
      for(const record of sourceSet.passives) {
        const id=typeof record?.numericId==="string" && /^(0|[1-9]\d*)$/.test(record.numericId) ? record.numericId : "";
        if(!id || typeof record?.officialId!=="string" || !record.officialId) throw new CandidateError("WEAPON_RECORD_INVALID", "Weapon-set passive identifiers are missing.",id);
        if(!catalog.nodeIds.has(id)) { weaponSetOmissions.push({sourceLabel:sourceSet.sourceLabel,numericId:id,reason:"missing-from-planner"}); continue; }
        if(!catalog.weaponEligibleIds.has(id)) { weaponSetOmissions.push({sourceLabel:sourceSet.sourceLabel,numericId:id,reason:"not-weapon-eligible"}); continue; }
        target.add(id);
      }
    }

    return Object.freeze({
      baseClassName: base,
      classStartId: String(catalog.classStartIds.get(base)),
      selectedAscendancyId: ascendancyId,
      ascStartId: ascendancyId ? String(catalog.ascendancyStartIds.get(ascendancyId)) : null,
      freeAscendancyIds: new Set([
        ...[...(catalog.freeAscendancyIds?.get(ascendancyId) || [])].map(String),
        ...importedFreeAscendancyIds,
      ]),
      maxPoints: current.maxPoints,
      maxWeaponPoints: current.maxWeaponPoints,
      maxAscPoints: current.maxAscPoints,
      allocated: normal,
      weaponSet1Allocated: weapon1,
      weaponSet2Allocated: weapon2,
      ascAllocated: asc,
      instillAllocated: new Set(),
      camera: { ...current.camera },
      weaponMode: "general",
      showAsc: Boolean(ascendancyId),
      showLockedConditional: current.showLockedConditional,
      showInstillOnGraph: current.showInstillOnGraph,
      preservation: null,
      counts:{...counts,normalApplied:counts.normal-normalOmissions.length,totalOmitted:normalOmissions.length+weaponSetOmissions.length,weaponSet1Applied:weapon1.size,weaponSet2Applied:weapon2.size,weaponSetOmitted:weaponSetOmissions.length},
      weaponSetOmissions:Object.freeze(weaponSetOmissions),
      omissions:Object.freeze([...normalOmissions,...weaponSetOmissions]),
    });
  }

  function isNonEmptyBuild(state) {
    return Boolean(state.classStartId || state.allocated.size || state.ascAllocated.size ||
      state.weaponSet1Allocated.size || state.weaponSet2Allocated.size || state.instillAllocated.size);
  }

  function summarizeApplicationBudget(candidate) {
    const general=Math.max(0,candidate.allocated.size-(candidate.classStartId ? 1 : 0));
    const weaponSet1=candidate.weaponSet1Allocated.size;
    const weaponSet2=candidate.weaponSet2Allocated.size;
    const freeAscendancyIds=new Set(candidate.freeAscendancyIds || []);
    if(candidate.ascStartId) freeAscendancyIds.add(String(candidate.ascStartId));
    const ascendancy=[...candidate.ascAllocated].filter(id=>!freeAscendancyIds.has(String(id))).length;
    return Object.freeze({general,weaponSet1,weaponSet2,ascendancy,effectivePassive:general+Math.max(weaponSet1,weaponSet2)});
  }

  function createLatestRequestGate() {
    let generation=0;
    return Object.freeze({
      begin() { generation+=1; return generation; },
      invalidate() { generation+=1; },
      isCurrent(token) { return token===generation; },
    });
  }

  function applyImportTransaction(candidate, operations, transactionAdapter) {
    const result=transactionAdapter.applyBuildCandidateTransaction(candidate,operations);
    return Object.freeze({...result,unsafe:!result.ok&&Boolean(result.rollbackError)});
  }

  function canSaveBuild({ready,supported,unsafe}) {
    return Boolean(ready&&supported&&!unsafe);
  }

  return Object.freeze({
    summarize,createPlannerCandidate,isNonEmptyBuild,summarizeApplicationBudget,
    createLatestRequestGate,applyImportTransaction,canSaveBuild,candidateFailure
  });
});
