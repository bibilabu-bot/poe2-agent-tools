(function initLocalizationEngine(root, factory) {
  const statUtils = typeof module === "object" && module.exports
    ? require("./stat-utils.js")
    : root.plannerStatUtils;
  const api = factory(statUtils);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.plannerLocalizationEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, ({ cleanStatDisplay, normalizeStatKey, compileStatTemplate }) => {
  const QUALITY = Object.freeze({
    WEGAME_IDENTITY_STAT: "wegame-identity-stat-signature",
    WEGAME_IDENTITY_NAME: "wegame-identity-name",
    POB_EXACT: "pob-exact",
    POB_TEMPLATE: "pob-template",
    ENGLISH: "english-fallback",
  });
  const REVIEWED_WEGAME_STATS = new Map([
    ["52\u0000Excess Life Recovery from Regeneration is applied to Energy Shield\nEnergy Shield does not Recharge", "再生的溢出生命回复会作用于能量护盾。\n能量护盾无法充能。"],
    ["3994\u0000Gain Deflection Rating equal to 8% of Evasion Rating", "获得相当于闪避值 8% 的偏转值"],
    ["46365\u0000Your Minions are Gigantic", "你的召唤生物为庞然大物"],
    ["46365\u000025% reduced Reservation Efficiency of Minion Skills", "召唤生物技能的保留效能降低 25%"],
  ]);

  function normalizedTranslation(value) {
    return cleanStatDisplay(value).replace(/[。；，、]/g, "").replace(/\s+/g, "").toLowerCase();
  }

  function luaUnescape(value) {
    return String(value).replace(/\\(\d{1,3}|[abfnrtv\\"])/g, (_whole, token) => {
      if (/^\d+$/.test(token)) return String.fromCharCode(Number(token));
      return { a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", "\\": "\\", '"': '"' }[token] ?? token;
    });
  }

  function parsePobTranslation(text) {
    const passiveZh = new Map();
    const classZh = new Map();
    const statExactZh = new Map();
    const statIndex = new Map();
    let section = null;
    let statTemplateCount = 0;
    const mapRe = /^\s*\["((?:\\.|[^"\\])*)"\]="((?:\\.|[^"\\])*)",?\s*$/;
    const pairRe = /^\s*\{"((?:\\.|[^"\\])*)","((?:\\.|[^"\\])*)"\},?\s*$/;

    for (const rawLine of String(text).split(/\r?\n/)) {
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

  function exportedLocal(source, exported) {
    const matches = [...String(source).matchAll(/export\s*\{/g)];
    const start = matches.length ? matches.at(-1).index + matches.at(-1)[0].length : -1;
    const match = new RegExp(`(?:^|,)\\s*([A-Za-z_$][\\w$]*)\\s+as\\s+${exported}(?=\\s*[,}])`).exec(String(source).slice(Math.max(0, start)));
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
        if (char === "$" && quote === "`" && source[index] === "{") throw new Error("template interpolation is not allowed");
        if (char !== "\\") { value += char; continue; }
        const escaped = source[index++];
        if (escaped === "u") { value += String.fromCharCode(Number.parseInt(source.slice(index, index + 4), 16)); index += 4; }
        else if (escaped === "x") { value += String.fromCharCode(Number.parseInt(source.slice(index, index + 2), 16)); index += 2; }
        else value += { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", "0": "\0" }[escaped] ?? escaped;
      }
      throw new Error("unterminated string literal");
    };
    const identifier = () => {
      const match = /^[A-Za-z_$][\w$]*/.exec(source.slice(index));
      if (!match) throw new Error(`expected identifier at ${index}`);
      index += match[0].length;
      return match[0];
    };
    const value = () => {
      skip();
      const char = source[index];
      if (char === "!") { index += 1; return !value(); }
      if (char === '"' || char === "'" || char === "`") return string();
      if (char === "[") {
        index += 1; const out = []; skip();
        while (source[index] !== "]") {
          out.push(value()); skip();
          if (source[index] === ",") { index += 1; skip(); if (source[index] === "]") break; }
          else if (source[index] !== "]") throw new Error(`expected comma or ] at ${index}`);
        }
        index += 1; return out;
      }
      if (char === "{") {
        index += 1; const out = {}; skip();
        while (source[index] !== "}") {
          const key = ['"', "'", "`"].includes(source[index]) ? string() : (/[-+\d.]/.test(source[index]) ? String(value()) : identifier());
          skip(); if (source[index++] !== ":") throw new Error(`expected colon at ${index - 1}`);
          out[key] = value(); skip();
          if (source[index] === ",") { index += 1; skip(); if (source[index] === "}") break; }
          else if (source[index] !== "}") throw new Error(`expected comma or } at ${index}`);
        }
        index += 1; return out;
      }
      const number = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?/i.exec(source.slice(index));
      if (number) { index += number[0].length; return Number(number[0]); }
      const word = identifier();
      if (word === "true") return true;
      if (word === "false") return false;
      if (word === "null") return null;
      throw new Error(`non-literal identifier ${word} is not allowed`);
    };
    return value();
  }

  function parseWeGameModule(source) {
    source = String(source);
    const result = {};
    for (const exported of ["classes", "nodes", "skillOverrides"]) {
      const local = exportedLocal(source, exported);
      const match = new RegExp(`(?:\\b(?:const|let|var)\\s+|,)${local}\\s*=`).exec(source);
      if (!match) throw new Error(`cannot locate literal assignment for ${exported}`);
      result[exported] = parseDataLiteral(source, match.index + match[0].length);
    }
    if (!Array.isArray(result.classes) || !result.nodes || Array.isArray(result.nodes)) throw new Error("unexpected WeGame localization schema");
    return result;
  }

  function numericSignature(value) {
    return (cleanStatDisplay(value).match(/[+-]?(?:\d+(?:\.\d+)?|\.\d+)/g) || []).join("|");
  }

  function markupSignature(value) {
    return [...String(value).matchAll(/\[([^\]|]+)(?:\|[^\]]+)?\]/g)].map(match => match[1]).sort().join("|");
  }

  function statSignature(value) {
    return `${numericSignature(value)}::${markupSignature(value)}`;
  }

  function translatedResult(value, source, quality) {
    return Object.freeze({ value: cleanStatDisplay(value), source, quality, translated: true });
  }

  function englishResult(value, reason = "missing") {
    return Object.freeze({ value: cleanStatDisplay(value), source: "canonical-english", quality: QUALITY.ENGLISH, translated: false, reason });
  }

  function translatePobStat(value, pob) {
    const en = cleanStatDisplay(value);
    const exact = pob.statExactZh.get(en);
    if (exact) return translatedResult(exact, "pob2", QUALITY.POB_EXACT);
    for (const record of pob.statIndex.get(normalizeStatKey(en)) || []) {
      const match = record.regex.exec(en);
      if (!match) continue;
      const values = new Map();
      record.indices.forEach((index, i) => { if (!values.has(index)) values.set(index, match[i + 1]); });
      const translated = record.zh.replace(/\{(\d+)\}/g, (whole, index, offset, full) => {
        let replacement = values.get(Number(index));
        if (replacement == null) return whole;
        if (offset > 0 && full[offset - 1] === "+" && String(replacement).startsWith("+")) replacement = String(replacement).slice(1);
        return replacement;
      });
      return translatedResult(translated, "pob2", QUALITY.POB_TEMPLATE);
    }
    return englishResult(en);
  }

  function resolveNodeName(node, names, passiveZh) {
    const english = String(node?.name || "");
    const candidate = names.get(String(node?.id ?? node?.skill ?? ""));
    if (candidate?.translated && candidate.canonicalEnglish === english) return candidate;
    const fallback = passiveZh.get(english);
    return fallback && fallback !== english
      ? translatedResult(fallback, "pob2", QUALITY.POB_EXACT)
      : englishResult(english, "runtime-name-unmatched");
  }

  function buildLocalization({ officialTree, weGame, pob }) {
    const names = new Map();
    const stats = new Map();
    const diagnostics = { identityConflicts: 0, missingWeGame: 0, statSignatureConflicts: 0, acceptedWeGameNames: 0, acceptedWeGameStats: 0 };
    const officialNodes = officialTree?.nodes || {};

    for (const [numericId, official] of Object.entries(officialNodes)) {
      const wg = weGame?.nodes?.[numericId];
      const identityMatch = Boolean(wg && String(wg.id || "") === String(official.id || "") && String(wg.skill ?? numericId) === String(numericId));
      if (!wg) diagnostics.missingWeGame += 1;
      else if (!identityMatch) diagnostics.identityConflicts += 1;

      const englishName = String(official.name || "");
      const pobName = pob.passiveZh.get(englishName);
      const nameConsensus = pobName && normalizedTranslation(wg?.name) === normalizedTranslation(pobName);
      if (identityMatch && nameConsensus && String(wg.name || "").trim() && String(wg.name).trim() !== englishName) {
        names.set(numericId, Object.freeze({ value: String(wg.name).trim(), source: "wegame", quality: QUALITY.WEGAME_IDENTITY_NAME, translated: true }));
        diagnostics.acceptedWeGameNames += 1;
      } else {
        names.set(numericId, pobName && pobName !== englishName
          ? Object.freeze({ value: pobName, source: "pob2", quality: QUALITY.POB_EXACT, translated: true })
          : englishResult(englishName, identityMatch ? "untranslated" : "identity-unavailable"));
      }

      names.set(numericId, Object.freeze({ ...names.get(numericId), canonicalEnglish: englishName }));
      const officialStats = Array.isArray(official.stats) ? official.stats : [];
      const wgStats = identityMatch && Array.isArray(wg.stats) ? wg.stats : [];
      const buckets = new Map();
      for (const item of wgStats) {
        const signature = statSignature(item);
        if (!buckets.has(signature)) buckets.set(signature, []);
        buckets.get(signature).push(item);
      }
      const nodeStats = new Map();
      for (const english of officialStats) {
        const canonical=cleanStatDisplay(english);
        const signature = statSignature(english);
        const candidates = buckets.get(signature) || [];
        const hasSemanticAnchors = signature !== "::";
        const pobResult=translatePobStat(english,pob);
        const candidate=candidates[0];
        const reviewed=REVIEWED_WEGAME_STATS.get(`${numericId}\0${canonical}`);
        const semanticMatch=Boolean(candidate && ((pobResult.translated && normalizedTranslation(candidate)===normalizedTranslation(pobResult.value)) || (reviewed && normalizedTranslation(candidate)===normalizedTranslation(reviewed))));
        if (identityMatch && (hasSemanticAnchors || reviewed) && candidates.length === 1 && semanticMatch) {
          buckets.delete(signature);
          diagnostics.acceptedWeGameStats += 1;
          nodeStats.set(canonical, translatedResult(candidate, "wegame", reviewed ? "wegame-explicit-review" : "wegame-pob-consensus"));
          continue;
        }
        if (identityMatch && candidates.length !== 1) diagnostics.statSignatureConflicts += 1;
        nodeStats.set(canonical, pobResult);
      }
      stats.set(numericId, nodeStats);
    }
    return Object.freeze({ names, stats, diagnostics: Object.freeze(diagnostics) });
  }

  return Object.freeze({ QUALITY, buildLocalization, resolveNodeName, englishResult, markupSignature, numericSignature, parsePobTranslation, parseWeGameModule, statSignature, translatePobStat });
});
