(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.plannerStatUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function cleanStatDisplay(s) {
    return String(s ?? "")
      // GGG rich-text/stat-description links:
      // [Shock] -> Shock
      // [Flask|Flask] -> Flask
      .replace(/\[([^\]|]+)\|([^\]]+)\]/g, "$2")
      .replace(/\[([^\]]+)\]/g, "$1")
      // StatDescription formatting token -> plain placeholder.
      .replace(/\{(\d+):[^}]+\}/g, "{$1}")
      .replace(/\r/g, "")
      .replace(/[ \t]+/g, " ")
      .trim();
  }

  function normalizeStatKey(s) {
    return cleanStatDisplay(s)
      .replace(/\{\d+\}/g, "#")
      .replace(/[+-]?(?:\d+(?:\.\d+)?|\.\d+)/g, "#")
      .replace(/\s+/g, " ")
      .trim();
  }

  function compileStatTemplate(en, zh) {
    en = cleanStatDisplay(en);
    zh = cleanStatDisplay(zh);
    const tokenRe = /\{(\d+)\}/g;
    let pattern = "^";
    let last = 0;
    const indices = [];
    let match;

    while ((match = tokenRe.exec(en))) {
      pattern += escapeRegex(en.slice(last, match.index));
      pattern += "([+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+))";
      indices.push(Number(match[1]));
      last = match.index + match[0].length;
    }
    pattern += escapeRegex(en.slice(last)) + "$";

    try {
      return { en, zh, regex: new RegExp(pattern), indices };
    } catch {
      return null;
    }
  }

  return { cleanStatDisplay, normalizeStatKey, compileStatTemplate };
});
