(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.plannerWeGameImportUI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const expectedFormat = "poe2-agent-tools-wegame-passive-import";

  function list(value, path) {
    if (!Array.isArray(value)) throw new Error(`${path} is not an array.`);
    return value;
  }

  function summarize(value) {
    if (!value || value.format !== expectedFormat || value.version !== 1) {
      throw new Error("Unsupported WeGame passive import candidate.");
    }
    const candidate = value.candidate;
    if (!candidate || candidate.transactional !== true) throw new Error("WeGame candidate is not transactional.");
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
    if (!confirmation?.partialImportAcknowledged) throw new Error("Partial import must be acknowledged.");
    if (!base || !catalog.classStartIds.has(base)) throw new Error("A valid base class must be confirmed.");
    const sourceAscendancy = value.candidate.class?.ascendancyId || null;
    if (sourceAscendancy !== ascendancyId) throw new Error("Confirmed ascendancy does not match the imported allocation evidence.");
    if (ascendancyId && !catalog.ascendanciesByClass.get(base)?.has(ascendancyId)) {
      throw new Error("Confirmed ascendancy does not belong to the selected base class.");
    }

    const normal = new Set([String(catalog.classStartIds.get(base))]);
    const asc = new Set();
    const weapon1 = new Set();
    const weapon2 = new Set();
    const weaponSetOmissions=[];
    const seen = new Set();
    function accept(records, expected, target) {
      for (const record of records) {
        const id = typeof record?.numericId === "string" && /^(0|[1-9]\d*)$/.test(record.numericId) ? record.numericId : "";
        if (!id || typeof record?.officialId !== "string" || !record.officialId || record.active !== true || seen.has(id)) throw new Error("Imported passive identifiers are missing or conflicting.");
        seen.add(id);
        if (!catalog.nodeIds.has(id)) throw new Error(`Imported passive ${id} is missing from the current Planner catalog.`);
        if (expected === "normal" && !catalog.normalIds.has(id)) throw new Error(`Imported passive ${id} is not an ordinary Planner passive.`);
        if (expected === "socket" && !catalog.ordinarySocketIds.has(id)) throw new Error(`Imported passive ${id} is not a supported ordinary socket.`);
        if (expected === "ascendancy" && catalog.ascendancyIds.get(id) !== ascendancyId) throw new Error(`Imported passive ${id} conflicts with the confirmed ascendancy.`);
        target.add(id);
      }
    }
    accept(value.candidate.active.normal, "normal", normal);
    accept(value.candidate.active.ordinarySockets, "socket", normal);
    if (ascendancyId) {
      const start = catalog.ascendancyStartIds.get(ascendancyId);
      if (!start) throw new Error("The confirmed ascendancy start is unavailable.");
      asc.add(String(start));
    }
    accept(value.candidate.active.ascendancy, "ascendancy", asc);
    const sourceSets=value.candidate.inactive.sourceSpecialisations;
    for(const sourceSet of sourceSets) {
      const target=sourceSet.sourceLabel==="set1" ? weapon1 : sourceSet.sourceLabel==="set2" ? weapon2 : null;
      if(!target) throw new Error(`Unsupported source specialisation label ${sourceSet.sourceLabel}.`);
      for(const record of sourceSet.passives) {
        const id=typeof record?.numericId==="string" && /^(0|[1-9]\d*)$/.test(record.numericId) ? record.numericId : "";
        if(!id || typeof record?.officialId!=="string" || !record.officialId) throw new Error("Weapon-set passive identifiers are missing.");
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
      freeAscendancyIds: new Set([...(catalog.freeAscendancyIds?.get(ascendancyId) || [])].map(String)),
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
      counts:{...counts,weaponSet1Applied:weapon1.size,weaponSet2Applied:weapon2.size,weaponSetOmitted:weaponSetOmissions.length},
      weaponSetOmissions:Object.freeze(weaponSetOmissions),
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
    createLatestRequestGate,applyImportTransaction,canSaveBuild
  });
});
