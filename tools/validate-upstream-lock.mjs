#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STATUS = new Set(["active", "optional", "future-reference"]);
const ORIGIN = new Set(["github", "https"]);
const TRANSPORT = new Set(["raw-github", "https"]);
const PHASE = new Set(["runtime-cache", "runtime-and-compiler", "compiler-fetch", "compiler-reference"]);
const LICENSE = new Set(["confirmed", "unconfirmed", "mixed"]);
const REDISTRIBUTION = new Set(["allowed", "download-only", "review-required", "prohibited-until-confirmed"]);
const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(errors, value, pathName) {
  if (typeof value !== "string" || value.length === 0) errors.push(`${pathName} must be a non-empty string`);
}

export function validateUpstreamLock(lock) {
  const errors = [];
  if (!object(lock)) return ["lock must be an object"];
  if (lock.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  requireString(errors, lock.snapshotId, "snapshotId");
  if (lock.approvedPolicy !== "ADR-007") errors.push("approvedPolicy must be ADR-007");
  if (!ISO_DATE.test(lock.generatedAt ?? "")) errors.push("generatedAt must be an ISO-8601 UTC timestamp");
  if (!object(lock.promotion) || lock.promotion.mode !== "manual" || lock.promotion.approvalRequired !== true || lock.promotion.candidateAutomationAllowed !== true) {
    errors.push("promotion must require manual approval while allowing candidate automation");
  }
  if (!Array.isArray(lock.sources) || lock.sources.length === 0) {
    errors.push("sources must be a non-empty array");
    return errors;
  }

  const ids = new Set();
  for (const [index, source] of lock.sources.entries()) {
    const at = `sources[${index}]`;
    if (!object(source)) {
      errors.push(`${at} must be an object`);
      continue;
    }
    if (!ID.test(source.id ?? "")) errors.push(`${at}.id has an invalid format`);
    if (ids.has(source.id)) errors.push(`${at}.id duplicates ${source.id}`);
    ids.add(source.id);
    if (!STATUS.has(source.status)) errors.push(`${at}.status is invalid`);
    if (!Array.isArray(source.consumers) || source.consumers.length === 0 || source.consumers.some(value => typeof value !== "string" || value.length === 0)) {
      errors.push(`${at}.consumers must contain non-empty strings`);
    }
    requireString(errors, source.purpose, `${at}.purpose`);
    if (!PHASE.has(source.acquisitionPhase)) errors.push(`${at}.acquisitionPhase is invalid`);

    if (!object(source.origin) || !ORIGIN.has(source.origin.type)) {
      errors.push(`${at}.origin is invalid`);
    } else if (source.origin.type === "github") {
      requireString(errors, source.origin.repository, `${at}.origin.repository`);
      requireString(errors, source.origin.path, `${at}.origin.path`);
      if (!COMMIT.test(source.origin.revision ?? "")) errors.push(`${at}.origin.revision must be a full 40-character commit SHA`);
    } else {
      requireString(errors, source.origin.url, `${at}.origin.url`);
      if ("revision" in source.origin) errors.push(`${at}.origin.revision is not valid for a non-Git snapshot`);
    }

    if (!object(source.transport) || !TRANSPORT.has(source.transport.type)) {
      errors.push(`${at}.transport is invalid`);
    } else {
      requireString(errors, source.transport.url, `${at}.transport.url`);
      if (source.origin?.type === "github" && !source.transport.url.includes(source.origin.revision ?? "")) {
        errors.push(`${at}.transport.url must contain the pinned commit SHA`);
      }
    }

    if (!object(source.integrity) || source.integrity.algorithm !== "sha256" || !SHA256.test(source.integrity.sha256 ?? "") || !Number.isSafeInteger(source.integrity.bytes) || source.integrity.bytes <= 0) {
      errors.push(`${at}.integrity must contain sha256 and a positive byte count`);
    }

    if (!object(source.license) || !LICENSE.has(source.license.status) || !REDISTRIBUTION.has(source.license.redistribution)) {
      errors.push(`${at}.license has an invalid status or redistribution policy`);
    } else {
      requireString(errors, source.license.notes, `${at}.license.notes`);
    }

    if (source.origin?.type === "https") {
      if (!object(source.snapshot) || !ID.test(source.snapshot.snapshotId ?? "") || !ISO_DATE.test(source.snapshot.accessedAt ?? "") || source.snapshot.reviewStatus !== "manual-review-required") {
        errors.push(`${at}.snapshot must identify access time and manual review status`);
      }
    }
  }
  return errors;
}

export async function readAndValidateUpstreamLock(lockPath) {
  const text = await fs.readFile(lockPath, "utf8");
  return validateUpstreamLock(JSON.parse(text));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const defaultPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "upstream-sources.lock.json");
  const errors = await readAndValidateUpstreamLock(process.argv[2] ? path.resolve(process.argv[2]) : defaultPath);
  if (errors.length) {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log("upstream source lock is valid");
  }
}
