#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const { cleanStatDisplay, normalizeStatKey, compileStatTemplate } = require("../renderer/stat-utils.js");

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function argsFrom(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith("--") || !argv[i + 1]) throw new Error(`invalid argument near ${argv[i] || "<end>"}`);
    args[argv[i].slice(2)] = argv[i + 1];
  }
  for (const key of ["wegame", "wegame-sha256", "official", "tree-pre", "translation", "lock"]) {
    if (!args[key]) throw new Error(`missing --${key}`);
  }
  return args;
}

function digest(file) {
  const bytes = fs.readFileSync(file);
  return { bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
}

function assertDigest(label, file, expected) {
  const actual = digest(file);
  if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) {
    throw new Error(`${label} integrity mismatch: expected ${expected.bytes}/${expected.sha256}, got ${actual.bytes}/${actual.sha256}`);
  }
  return actual;
}

function lockSource(lock, id) {
  const source = lock.sources?.find(item => item.id === id);
  if (!Number.isInteger(source?.integrity?.bytes) || source.integrity.bytes < 0 || !/^[0-9a-f]{64}$/.test(source.integrity.sha256 || "")) throw new Error(`lock source ${id} is missing valid integrity metadata`);
  return source.integrity;
}

function luaUnescape(value) {
  return value.replace(/\\(\d{1,3}|[abfnrtv\\"])/g, (_whole, token) => {
    if (/^\d+$/.test(token)) return String.fromCharCode(Number(token));
    return { a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", "\\": "\\", '"': '"' }[token] ?? token;
  });
}

function parseTranslation(text) {
  const passiveZh = new Map();
  const classZh = new Map();
  const statExactZh = new Map();
  const statIndex = new Map();
  let section = null;
  let statTemplateCount = 0;
  const mapRe = /^\s*\["((?:\\.|[^"\\])*)"\]="((?:\\.|[^"\\])*)",?\s*$/;
  const pairRe = /^\s*\{"((?:\\.|[^"\\])*)","((?:\\.|[^"\\])*)"\},?\s*$/;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "d.passives = {") { section = "passives"; continue; }
    if (line === "d.classes = {") { section = "classes"; continue; }
    if (line === "d.statLines = {") { section = "statLines"; continue; }
    if (section && line === "}") { section = null; continue; }
    if (!section) continue;
    if (section === "passives" || section === "classes") {
      const match = mapRe.exec(rawLine);
      if (!match) continue;
      const zh = luaUnescape(match[1]);
      const en = luaUnescape(match[2]);
      const target = section === "passives" ? passiveZh : classZh;
      if (zh && en && !target.has(en)) target.set(en, zh);
      continue;
    }
    const match = pairRe.exec(rawLine);
    if (!match) continue;
    const zh = cleanStatDisplay(luaUnescape(match[1]));
    const en = cleanStatDisplay(luaUnescape(match[2]));
    if (!zh || !en) continue;
    if (!/\{\d+\}/.test(en) && !statExactZh.has(en)) statExactZh.set(en, zh);
    const record = compileStatTemplate(en, zh);
    if (!record) continue;
    const key = normalizeStatKey(en);
    if (!statIndex.has(key)) statIndex.set(key, []);
    statIndex.get(key).push(record);
    statTemplateCount += 1;
  }
  return { passiveZh, classZh, statExactZh, statIndex, statTemplateCount };
}

function translateStat(line, translation) {
  const en = cleanStatDisplay(line);
  const exact = translation.statExactZh.get(en);
  if (exact) return { kind: "exact", value: exact };
  for (const record of translation.statIndex.get(normalizeStatKey(en)) || []) {
    const match = record.regex.exec(en);
    if (!match) continue;
    const values = new Map();
    record.indices.forEach((index, i) => { if (!values.has(index)) values.set(index, match[i + 1]); });
    return {
      kind: "template",
      value: record.zh.replace(/\{(\d+)\}/g, (whole, index) => values.get(Number(index)) ?? whole),
    };
  }
  return { kind: "missing", value: en };
}

function numericTokens(value) {
  return cleanStatDisplay(value).match(/[+-]?(?:\d+(?:\.\d+)?|\.\d+)/g) || [];
}

function markupCount(value) {
  return (String(value).match(/\[[^\]]+\]/g) || []).length;
}

function duplicateSummary(pairs, leftKey, rightKey) {
  const grouped = new Map();
  const counts = new Map();
  for (const pair of pairs) {
    const left = pair[leftKey];
    const right = pair[rightKey];
    if (!left || !right) continue;
    if (!grouped.has(left)) grouped.set(left, new Set());
    grouped.get(left).add(right);
    counts.set(left, (counts.get(left) || 0) + 1);
  }
  const ambiguous = [...grouped.entries()].filter(([, values]) => values.size > 1);
  return {
    repeatedKeys: [...counts.values()].filter(count => count > 1).length,
    oneToManyKeys: ambiguous.length,
    examples: ambiguous.slice(0, 10).map(([key, values]) => ({ key, values: [...values].sort() })),
  };
}

function exportedLocal(source, exported) {
  const exportMatches = [...source.matchAll(/export\s*\{/g)];
  const exportAt = exportMatches.length ? exportMatches.at(-1).index + exportMatches.at(-1)[0].length : -1;
  const match = new RegExp(`(?:^|,)\\s*([A-Za-z_$][\\w$]*)\\s+as\\s+${exported}(?=\\s*[,}])`).exec(source.slice(exportAt < 0 ? 0 : exportAt));
  if (!match) throw new Error(`WeGame module does not export ${exported}`);
  return match[1];
}

function parseDataLiteral(source, start) {
  let index = start;
  const skip = () => { while (/\s/.test(source[index] || "")) index += 1; };
  const string = () => {
    const quote = source[index++];
    let value = "";
    while (index < source.length) {
      const char = source[index++];
      if (char === quote) return value;
      if (char === "$" && quote === "`" && source[index] === "{") throw new Error("template interpolation is not allowed in WeGame data literals");
      if (char !== "\\") { value += char; continue; }
      const escaped = source[index++];
      if (escaped === "u") { value += String.fromCharCode(Number.parseInt(source.slice(index, index + 4), 16)); index += 4; }
      else if (escaped === "x") { value += String.fromCharCode(Number.parseInt(source.slice(index, index + 2), 16)); index += 2; }
      else value += { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", "0": "\0" }[escaped] ?? escaped;
    }
    throw new Error("unterminated string in WeGame data literal");
  };
  const identifier = () => {
    const match = /^[A-Za-z_$][\w$]*/.exec(source.slice(index));
    if (!match) throw new Error(`expected identifier at offset ${index}`);
    index += match[0].length;
    return match[0];
  };
  const value = () => {
    skip();
    const char = source[index];
    if (char === "!") { index += 1; return !value(); }
    if (char === '"' || char === "'" || char === "`") return string();
    if (char === "[") {
      index += 1;
      const result = [];
      skip();
      while (source[index] !== "]") {
        result.push(value()); skip();
        if (source[index] === ",") { index += 1; skip(); if (source[index] === "]") break; }
        else if (source[index] !== "]") throw new Error(`expected comma or ] at offset ${index}`);
      }
      index += 1;
      return result;
    }
    if (char === "{") {
      index += 1;
      const result = {};
      skip();
      while (source[index] !== "}") {
        const key = ['"', "'", "`"].includes(source[index]) ? string() : (/[-+\d.]/.test(source[index]) ? String(value()) : identifier());
        skip();
        if (source[index++] !== ":") throw new Error(`expected colon at offset ${index - 1}`);
        result[key] = value(); skip();
        if (source[index] === ",") { index += 1; skip(); if (source[index] === "}") break; }
        else if (source[index] !== "}") throw new Error(`expected comma or } at offset ${index}`);
      }
      index += 1;
      return result;
    }
    const number = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?/i.exec(source.slice(index));
    if (number) { index += number[0].length; return Number(number[0]); }
    const word = identifier();
    if (word === "true") return true;
    if (word === "false") return false;
    if (word === "null") return null;
    throw new Error(`non-literal identifier ${word} is not allowed in WeGame data`);
  };
  const parsed = value();
  return { parsed, end: index };
}

function parseWeGame(file) {
  const source = fs.readFileSync(file, "utf8");
  const result = {};
  for (const exported of ["classes", "nodes", "skillOverrides"]) {
    const local = exportedLocal(source, exported);
    const match = new RegExp(`(?:\\b(?:const|let|var)\\s+|,)${local}\\s*=`).exec(source);
    if (!match) throw new Error(`cannot locate literal assignment for WeGame export ${exported}`);
    result[exported] = parseDataLiteral(source, match.index + match[0].length).parsed;
  }
  if (!Array.isArray(result.classes) || !result.nodes || Array.isArray(result.nodes) || !result.skillOverrides || Array.isArray(result.skillOverrides)) throw new Error("unexpected WeGame localization schema");
  return result;
}

async function main() {
  const args = argsFrom(process.argv.slice(2));
  const lock = JSON.parse(fs.readFileSync(args.lock, "utf8"));
  const inputEvidence = {
    wegame: assertDigest("wegame", args.wegame, { bytes: digest(args.wegame).bytes, sha256: args["wegame-sha256"] }),
    official: assertDigest("official", args.official, lockSource(lock, "shared.ggg.passive-tree")),
    treePre: assertDigest("tree-pre", args["tree-pre"], lockSource(lock, "runtime.drydream.tree-pre")),
    translation: assertDigest("translation", args.translation, lockSource(lock, "runtime.translation.zh-cn")),
  };
  const wegame = parseWeGame(args.wegame);
  const official = JSON.parse(fs.readFileSync(args.official, "utf8"));
  const treePre = JSON.parse(fs.readFileSync(args["tree-pre"], "utf8"));
  const translation = parseTranslation(fs.readFileSync(args.translation, "utf8"));
  const wgNodes = wegame.nodes;
  const officialNodes = official.nodes;
  const treePreNodes = treePre.nodes;
  const officialIds = Object.keys(officialNodes);
  const wgIds = Object.keys(wgNodes);
  const matchedIds = officialIds.filter(id => wgNodes[id]);
  const identityConflicts = matchedIds.filter(id => officialNodes[id].id !== wgNodes[id].id);
  const matchingIdentity = matchedIds.filter(id => officialNodes[id].id === wgNodes[id].id);
  const officialRaw = new Map(officialIds.map(id => [officialNodes[id].id, id]));
  const wgRaw = new Map(wgIds.map(id => [wgNodes[id].id, id]));
  const rawMatches = [...officialRaw.keys()].filter(id => wgRaw.has(id));
  const rawNumericChanges = rawMatches.filter(raw => officialRaw.get(raw) !== wgRaw.get(raw));

  const namePairs = [];
  const stats = { officialInstances: 0, wegameInstancesOnComparableNodes: 0, hanInstances: 0, noHanInstances: 0, pairedInstances: 0, nonIdenticalPositionalInstances: 0, identicalPositionalInstances: 0, countConflictNodes: 0, markupCountMismatches: 0, numericTokenMismatches: 0 };
  const uniqueOfficialStats = new Set();
  const uniquePairedStats = new Set();
  const uniqueTranslatedStats = new Set();
  const representativeDifferences = [];

  for (const id of officialIds) {
    const enNode = officialNodes[id];
    for (const stat of enNode.stats || []) {
      stats.officialInstances += 1;
      uniqueOfficialStats.add(cleanStatDisplay(stat));
    }
    const zhNode = wgNodes[id];
    if (!zhNode || enNode.id !== zhNode.id) continue;
    namePairs.push({ id, rawId: enNode.id, en: enNode.name || "", zh: zhNode.name || "" });
    const enStats = enNode.stats || [];
    const zhStats = zhNode.stats || [];
    stats.wegameInstancesOnComparableNodes += zhStats.length;
    stats.hanInstances += zhStats.filter(line => /[\u3400-\u9fff]/.test(line)).length;
    stats.noHanInstances += zhStats.filter(line => !/[\u3400-\u9fff]/.test(line)).length;
    if (enStats.length !== zhStats.length) stats.countConflictNodes += 1;
    for (let index = 0; index < Math.min(enStats.length, zhStats.length); index += 1) {
      const en = cleanStatDisplay(enStats[index]);
      const zh = cleanStatDisplay(zhStats[index]);
      stats.pairedInstances += 1;
      uniquePairedStats.add(en);
      if (zh && zh !== en) {
        stats.nonIdenticalPositionalInstances += 1;
        uniqueTranslatedStats.add(en);
      } else {
        stats.identicalPositionalInstances += 1;
      }
      if (markupCount(enStats[index]) !== markupCount(zhStats[index])) stats.markupCountMismatches += 1;
      if (JSON.stringify(numericTokens(enStats[index])) !== JSON.stringify(numericTokens(zhStats[index]))) stats.numericTokenMismatches += 1;
    }
  }
  stats.uniqueOfficial = uniqueOfficialStats.size;
  stats.uniquePaired = uniquePairedStats.size;
  stats.uniqueNonIdenticalPositional = uniqueTranslatedStats.size;

  const hasHan = value => /[\u3400-\u9fff]/.test(String(value || ""));
  const translatedNames = namePairs.filter(pair => hasHan(pair.zh));
  const untranslatedNames = namePairs.filter(pair => !hasHan(pair.zh));
  const pobNameCovered = namePairs.filter(pair => translation.passiveZh.has(pair.en));
  const pobConflicts = namePairs.filter(pair => {
    const pob = translation.passiveZh.get(pair.en);
    return pob && pair.zh && pob !== pair.zh;
  });
  for (const pair of pobConflicts.slice(0, 12)) {
    representativeDifferences.push({ id: pair.id, rawId: pair.rawId, en: pair.en, wegame: pair.zh, pob: translation.passiveZh.get(pair.en) });
  }

  const officialStatLines = officialIds.flatMap(id => officialNodes[id].stats || []);
  const pobStats = officialStatLines.map(line => translateStat(line, translation));
  const classPairs = official.classes.map((entry, index) => ({ index, en: entry.name, zh: wegame.classes[index]?.name || "" }));
  const officialAsc = official.classes.flatMap(entry => entry.ascendancies || []);
  const wgAsc = new Map(wegame.classes.flatMap(entry => entry.ascendancies || []).map(entry => [entry.id, entry]));
  const ascPairs = officialAsc.map(entry => ({ id: entry.id, en: entry.name, zh: wgAsc.get(entry.id)?.name || "" }));

  const officialOverrides = official.skillOverrides || {};
  const wgOverrides = wegame.skillOverrides || {};
  const overrideIds = Object.keys(officialOverrides);
  const overrideMatches = overrideIds.filter(id => wgOverrides[id] && officialOverrides[id].id === wgOverrides[id].id);

  const treePreIds = Object.keys(treePreNodes);
  const treePreNamePairs = treePreIds.filter(id => wgNodes[id]).map(id => ({
    id,
    en: treePreNodes[id].name || "",
    zh: wgNodes[id].name || "",
  }));
  const treePreStats = { englishInstances: 0, wegameInstances: 0, pairedInstances: 0, hanInstances: 0, noHanInstances: 0, countConflictNodes: 0, nodeMarkupTotalMismatches: 0, positionalMarkupMismatches: 0, numericTokenOrderMismatches: 0, numericTokenValueMismatches: 0, conflictExamples: [], markupMismatchExamples: [], numericMismatchExamples: [], noHanExamples: [] };
  for (const id of treePreIds) {
    const enStats = treePreNodes[id].stats || [];
    const zhStats = wgNodes[id]?.stats || [];
    treePreStats.englishInstances += enStats.length;
    treePreStats.wegameInstances += zhStats.length;
    treePreStats.hanInstances += zhStats.filter(hasHan).length;
    treePreStats.noHanInstances += zhStats.filter(line => !hasHan(line)).length;
    for (const line of zhStats.filter(line => !hasHan(line))) if (treePreStats.noHanExamples.length < 10) treePreStats.noHanExamples.push({ id, text: line });
    if (enStats.reduce((sum, line) => sum + markupCount(line), 0) !== zhStats.reduce((sum, line) => sum + markupCount(line), 0)) treePreStats.nodeMarkupTotalMismatches += 1;
    if (enStats.length !== zhStats.length) {
      treePreStats.countConflictNodes += 1;
      if (treePreStats.conflictExamples.length < 10) treePreStats.conflictExamples.push({ id, enCount: enStats.length, zhCount: zhStats.length, en: enStats, zh: zhStats });
    }
    for (let index = 0; index < Math.min(enStats.length, zhStats.length); index += 1) {
      const en = cleanStatDisplay(enStats[index]);
      const zh = cleanStatDisplay(zhStats[index]);
      treePreStats.pairedInstances += 1;
      if (markupCount(enStats[index]) !== markupCount(zhStats[index])) {
        treePreStats.positionalMarkupMismatches += 1;
        if (treePreStats.markupMismatchExamples.length < 10) treePreStats.markupMismatchExamples.push({ id, index, en: enStats[index], zh: zhStats[index] });
      }
      const enNumbers = numericTokens(enStats[index]);
      const zhNumbers = numericTokens(zhStats[index]);
      if (JSON.stringify(enNumbers) !== JSON.stringify(zhNumbers)) {
        if (JSON.stringify([...enNumbers].sort()) === JSON.stringify([...zhNumbers].sort())) treePreStats.numericTokenOrderMismatches += 1;
        else treePreStats.numericTokenValueMismatches += 1;
        if (treePreStats.numericMismatchExamples.length < 10) treePreStats.numericMismatchExamples.push({ id, index, en: enStats[index], zh: zhStats[index] });
      }
    }
  }

  const report = {
    schemaVersion: 1,
    inputs: inputEvidence,
    wegameAgainstOfficial: {
      nodes: {
        officialTotal: officialIds.length,
        wegameTotal: wgIds.length,
        numericMatches: matchedIds.length,
        matchingNumericAndRawIdentity: matchingIdentity.length,
        numericIdentityConflicts: identityConflicts.length,
        missingFromWeGame: officialIds.length - matchedIds.length,
        extraInWeGame: wgIds.length - matchedIds.length,
        rawIdMatches: rawMatches.length,
        rawIdNumericChanges: rawNumericChanges.length,
      },
      names: {
        comparable: namePairs.length,
        translated: translatedNames.length,
        untranslatedOrEmpty: untranslatedNames.length,
        missingOrVersionConflict: officialIds.length - namePairs.length,
        duplicateChineseToEnglish: duplicateSummary(namePairs, "zh", "en"),
        duplicateEnglishToChinese: duplicateSummary(namePairs, "en", "zh"),
      },
      stats,
      classes: {
        officialTotal: classPairs.length,
        translated: classPairs.filter(pair => hasHan(pair.zh)).length,
        missing: classPairs.filter(pair => !pair.zh).length,
      },
      ascendancies: {
        officialTotal: ascPairs.length,
        translated: ascPairs.filter(pair => hasHan(pair.zh)).length,
        missing: ascPairs.filter(pair => !pair.zh).length,
      },
      skillOverrides: {
        officialTotal: overrideIds.length,
        wegameTotal: Object.keys(wgOverrides).length,
        matchingNumericAndRawIdentity: overrideMatches.length,
        missingOrConflict: overrideIds.length - overrideMatches.length,
      },
    },
    wegameAgainstTreePre: {
      treePreTotal: treePreIds.length,
      wegameTotal: wgIds.length,
      numericMatches: treePreNamePairs.length,
      namedInstances: treePreNamePairs.filter(pair => pair.en).length,
      hanNamedInstances: treePreNamePairs.filter(pair => pair.en && hasHan(pair.zh)).length,
      noHanNamedInstances: treePreNamePairs.filter(pair => pair.en && !hasHan(pair.zh)).length,
      hanNameInstances: treePreNamePairs.filter(pair => hasHan(pair.zh)).length,
      noHanOrEmptyNameInstances: treePreNamePairs.filter(pair => !hasHan(pair.zh)).length,
      noHanNameExamples: treePreNamePairs.filter(pair => !hasHan(pair.zh)).slice(0, 20),
      stats: treePreStats,
      missingFromWeGame: treePreIds.filter(id => !wgNodes[id]).length,
      extraInWeGame: wgIds.filter(id => !treePreNodes[id]).length,
    },
    currentPoBTranslationAgainstComparableOfficial: {
      comparableNameInstances: namePairs.length,
      coveredNameInstances: pobNameCovered.length,
      missingNameInstances: namePairs.length - pobNameCovered.length,
      conflictsWithWeGameInstances: pobConflicts.length,
      passiveDictionaryEntries: translation.passiveZh.size,
      classDictionaryEntries: translation.classZh.size,
      statTemplates: translation.statTemplateCount,
      officialStatInstances: officialStatLines.length,
      exactStatInstances: pobStats.filter(item => item.kind === "exact").length,
      templateStatInstances: pobStats.filter(item => item.kind === "template").length,
      missingStatInstances: pobStats.filter(item => item.kind === "missing").length,
    },
    representativeDifferences,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch(error => fail(error.stack || error.message));
