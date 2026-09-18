"use strict";

const crypto = require("node:crypto");
const { isSensitiveKey } = require("../src/interop/wegame-sensitive-fields.js");
const OPAQUE_HEX_ID = /^[a-f0-9]{64}$/i;
const SHARE_TOKEN_LIKE = /^[A-Za-z0-9_-]{40,}$/;

function canonicalFixtureBytes(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const text = buffer.toString("utf8");
  return Buffer.from(text.replace(/\r\n/g, "\n"), "utf8");
}

function collectSchemaPaths(value, currentPath = "$", output = new Set()) {
  if (Array.isArray(value)) {
    output.add(`${currentPath}:array`);
    for (const item of value) collectSchemaPaths(item, `${currentPath}[]`, output);
  } else if (value && typeof value === "object") {
    output.add(`${currentPath}:object`);
    for (const key of Object.keys(value)) collectSchemaPaths(value[key], `${currentPath}.${key}`, output);
  } else {
    output.add(`${currentPath}:${value === null ? "null" : typeof value}`);
  }
  return [...output].sort();
}

function schemaFingerprint(pathsOrValue) {
  const paths = Array.isArray(pathsOrValue) ? pathsOrValue : collectSchemaPaths(pathsOrValue);
  return crypto.createHash("sha256").update(paths.join("\n")).digest("hex");
}

function assertSanitized(value, currentPath = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSanitized(item, `${currentPath}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (isSensitiveKey(key)) {
        throw new Error(`forbidden sensitive key at ${currentPath}.${key}`);
      }
      assertSanitized(child, `${currentPath}.${key}`);
    }
    return;
  }
  if (typeof value === "string" && (OPAQUE_HEX_ID.test(value) || SHARE_TOKEN_LIKE.test(value))) {
    throw new Error(`unsanitized opaque identifier at ${currentPath}`);
  }
}

module.exports = { assertSanitized, canonicalFixtureBytes, collectSchemaPaths, schemaFingerprint };
