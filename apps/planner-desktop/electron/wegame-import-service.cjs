"use strict";

const { adaptWeGamePassiveImport } = require("../src/interop/wegame-import-adapter.js");

const ERROR_CODES = Object.freeze({
  INVALID_URL: "WEGAME_INVALID_URL", REDIRECT_REJECTED: "WEGAME_REDIRECT_REJECTED", TIMEOUT: "WEGAME_TIMEOUT",
  NETWORK: "WEGAME_NETWORK_ERROR", HTTP: "WEGAME_HTTP_ERROR", CONTENT_TYPE: "WEGAME_CONTENT_TYPE_ERROR",
  RESPONSE_TOO_LARGE: "WEGAME_RESPONSE_TOO_LARGE", INVALID_JSON: "WEGAME_INVALID_JSON", BUSY: "WEGAME_BUSY",
  BUSINESS: "WEGAME_BUSINESS_ERROR", SCHEMA: "WEGAME_SCHEMA_ERROR", TREE: "WEGAME_TREE_ERROR", INTERNAL: "WEGAME_INTERNAL_ERROR",
});
const ALLOWED_HOSTS = new Set(["www.wegame.com.cn"]);
const TOKEN = /^[A-Za-z0-9_-]{8,256}$/;
const API_PREFIX = "/api/v1/wegame.pallas.poe2.Profile/";

class WeGameImportError extends Error { constructor(code, message, status = null) { super(message); this.name = "WeGameImportError"; this.code = code; this.status = status; } }

function parseShareUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new WeGameImportError(ERROR_CODES.INVALID_URL, "Enter a valid WeGame public share URL."); }
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname) || url.username || url.password || url.port || url.pathname !== "/helper/poe2/" || url.search) throw new WeGameImportError(ERROR_CODES.INVALID_URL, "This is not an approved WeGame PoE2 public share URL.");
  const match = /^#\/share\/([^/?#]+)$/.exec(url.hash);
  if (!match || !TOKEN.test(match[1])) throw new WeGameImportError(ERROR_CODES.INVALID_URL, "The WeGame share token has an invalid shape.");
  return Object.freeze({ url: url.href, token: match[1] });
}

function publicFailure(error) {
  const known = new Set(Object.values(ERROR_CODES));
  return Object.freeze({ ok: false, error: Object.freeze({ code: known.has(error?.code) ? error.code : ERROR_CODES.INTERNAL, message: known.has(error?.code) ? error.message : "WeGame import failed safely.", status: Number.isInteger(error?.status) ? error.status : null }) });
}

function createWeGameImportService(dependencies = {}) {
  const fetchImpl = dependencies.fetch;
  const loadOfficialTree = dependencies.loadOfficialTree;
  const timeoutMs = dependencies.timeoutMs || 8000;
  const maxBytes = dependencies.maxBytes || 512 * 1024;
  let active = false;

  async function readBoundedBody(response) {
    if (!response.body?.getReader) {
      const fallback = new Uint8Array(await response.arrayBuffer());
      if (fallback.byteLength > maxBytes) throw new WeGameImportError(ERROR_CODES.RESPONSE_TOO_LARGE, "WeGame response exceeded the safe size limit.");
      return fallback;
    }
    const reader = response.body.getReader(), chunks = []; let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        total += value.byteLength;
        if (total > maxBytes) { await reader.cancel(); throw new WeGameImportError(ERROR_CODES.RESPONSE_TOO_LARGE, "WeGame response exceeded the safe size limit."); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  }

  async function request(endpoint, body) {
    if (typeof fetchImpl !== "function") throw new WeGameImportError(ERROR_CODES.INTERNAL, "WeGame transport is unavailable.");
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(`https://www.wegame.com.cn${API_PREFIX}${endpoint}`, { method: "POST", redirect: "manual", cache: "no-store", credentials: "omit", signal: controller.signal, headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
    } catch (error) { clearTimeout(timer); throw new WeGameImportError(error?.name === "AbortError" ? ERROR_CODES.TIMEOUT : ERROR_CODES.NETWORK, error?.name === "AbortError" ? "WeGame request timed out." : "WeGame could not be reached."); }
    try {
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location"); let redirect;
      try { redirect = new URL(location, response.url); } catch { throw new WeGameImportError(ERROR_CODES.REDIRECT_REJECTED, "WeGame returned an invalid redirect."); }
      if (redirect.protocol !== "https:" || !ALLOWED_HOSTS.has(redirect.hostname) || redirect.port || !redirect.pathname.startsWith(API_PREFIX)) throw new WeGameImportError(ERROR_CODES.REDIRECT_REJECTED, "WeGame redirected outside the approved API host.");
      throw new WeGameImportError(ERROR_CODES.REDIRECT_REJECTED, "Unexpected WeGame API redirect was rejected.");
    }
    if (!response.ok) throw new WeGameImportError(ERROR_CODES.HTTP, "WeGame returned an HTTP error.", response.status);
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") || "")) throw new WeGameImportError(ERROR_CODES.CONTENT_TYPE, "WeGame returned a non-JSON response.");
    const length = Number(response.headers.get("content-length")); if (Number.isFinite(length) && length > maxBytes) throw new WeGameImportError(ERROR_CODES.RESPONSE_TOO_LARGE, "WeGame response exceeded the safe size limit.");
    let bytes;
    try { bytes = await readBoundedBody(response); } catch (error) { if (error instanceof WeGameImportError) throw error; if (error?.name === "AbortError" || controller.signal.aborted) throw new WeGameImportError(ERROR_CODES.TIMEOUT, "WeGame request timed out."); throw new WeGameImportError(ERROR_CODES.NETWORK, "WeGame response could not be read."); }
    if (bytes.byteLength > maxBytes) throw new WeGameImportError(ERROR_CODES.RESPONSE_TOO_LARGE, "WeGame response exceeded the safe size limit.");
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw new WeGameImportError(ERROR_CODES.INVALID_JSON, "WeGame returned invalid JSON."); }
    } finally { clearTimeout(timer); }
  }

  async function importFromUrl(requestValue) {
    if (active) return publicFailure(new WeGameImportError(ERROR_CODES.BUSY, "A WeGame import is already running."));
    active = true;
    try {
      const parsed = parseShareUrl(typeof requestValue === "string" ? requestValue : requestValue?.url);
      const base = { area: 0, openid: null, role_id: null, share_code: parsed.token, from_src: "poe2_helper" };
      const roleInfo = await request("GetRoleInfo", base);
      if (roleInfo?.result?.error_code !== 0) throw new WeGameImportError(ERROR_CODES.BUSINESS, "WeGame rejected or could not resolve this share.");
      const role = roleInfo.role || {};
      if (!Number.isSafeInteger(role.area) || role.area < 0 || role.area > 100 || typeof role.openid !== "string" || !role.openid || role.openid.length > 256 || typeof role.role_id !== "string" || !role.role_id || role.role_id.length > 256) throw new WeGameImportError(ERROR_CODES.SCHEMA, "WeGame role identity has an invalid shape.");
      const talentTree = await request("GetTalentTree", { ...base, area: role.area, openid: role.openid, role_id: role.role_id });
      const officialTree = await loadOfficialTree();
      return Object.freeze({ ok: true, value: adaptWeGamePassiveImport({ roleInfo, talentTree }, officialTree) });
    } catch (error) {
      if (error?.code === "WEGAME_BUSINESS_ERROR") return publicFailure(new WeGameImportError(ERROR_CODES.BUSINESS, error.message));
      if (error?.code === "WEGAME_TREE_INVALID") return publicFailure(new WeGameImportError(ERROR_CODES.TREE, error.message));
      if (typeof error?.code === "string" && error.code.startsWith("WEGAME_SCHEMA_")) return publicFailure(new WeGameImportError(ERROR_CODES.SCHEMA, error.message));
      return publicFailure(error);
    }
    finally { active = false; }
  }
  return Object.freeze({ importFromUrl });
}

module.exports = Object.freeze({ ALLOWED_HOSTS, API_PREFIX, ERROR_CODES, WeGameImportError, createWeGameImportService, parseShareUrl, publicFailure });
