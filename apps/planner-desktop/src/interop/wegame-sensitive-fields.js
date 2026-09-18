(function initWeGameSensitiveFields(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.weGameSensitiveFields = api;
})(typeof globalThis === "object" ? globalThis : this, function weGameSensitiveFieldsFactory() {
  "use strict";
  const SENSITIVE_KEY_FRAGMENTS = Object.freeze([
    "openid", "roleid", "sharecode", "rolename", "charactername", "accountname", "accountid", "nickname",
    "deviceid", "userid", "sessionid", "traceid", "token", "authorization", "cookie", "credential", "password", "secret",
    "createdtime", "lastlogintime", "seasongameduration", "totalgameduration", "playduration", "gameduration",
  ]);
  function normalizeSensitiveKey(key) { return String(key).toLowerCase().replace(/[^a-z0-9]/g, ""); }
  function isSensitiveKey(key) {
    const normalized = normalizeSensitiveKey(key);
    return SENSITIVE_KEY_FRAGMENTS.some(fragment => normalized.includes(fragment));
  }
  return Object.freeze({ SENSITIVE_KEY_FRAGMENTS, isSensitiveKey, normalizeSensitiveKey });
});
