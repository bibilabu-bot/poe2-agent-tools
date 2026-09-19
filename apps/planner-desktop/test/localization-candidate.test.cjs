"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const configuration = require("../data/localization-candidates.json");
const { createBoundedCandidateFetch, createLocalizationCandidateCatalog } = require("../electron/localization-candidate.cjs");

test("accepts only the fixed REVIEW WeGame candidate", () => {
  const catalog=createLocalizationCandidateCatalog(configuration);
  const descriptor=catalog.resolve("wegame-passive-tree-zh-cn.js");
  assert.equal(descriptor.status,"REVIEW");
  assert.equal(descriptor.bytes,2027563);
  assert.equal(descriptor.sha256,"eb7f434e4061b27ba09ae5c8f4d0a753ff44a3ac2c746763d224916afaa385ab");
  assert.equal(catalog.resolve("../tree.js"),null);
});

test("rejects a moving or unreviewed candidate", () => {
  const invalid=structuredClone(configuration);
  invalid.candidates[0].provenance.followMovingChunk=true;
  assert.throws(()=>createLocalizationCandidateCatalog(invalid),/metadata is invalid/);
  invalid.candidates[0].provenance.followMovingChunk=false;
  invalid.candidates[0].status="active";
  assert.throws(()=>createLocalizationCandidateCatalog(invalid),/metadata is invalid/);
});

function smallCatalog(bytes) {
  const candidate=structuredClone(configuration);
  candidate.candidates[0].integrity.bytes=bytes;
  return createLocalizationCandidateCatalog(candidate);
}

test("candidate transport streams only up to the fixed byte limit", async () => {
  const catalog=smallCatalog(4);
  const url=catalog.resolve("wegame-passive-tree-zh-cn.js").url;
  const fetchExact=createBoundedCandidateFetch(async()=>new Response("1234"),catalog);
  assert.equal(await (await fetchExact(url)).text(),"1234");
  const fetchOversize=createBoundedCandidateFetch(async()=>new Response("12345"),catalog);
  await assert.rejects(fetchOversize(url),/exceeded its fixed byte limit/);
});

test("candidate transport aborts a stalled response body", async () => {
  const catalog=smallCatalog(4);
  const url=catalog.resolve("wegame-passive-tree-zh-cn.js").url;
  const stalled=createBoundedCandidateFetch(async()=>new Response(new ReadableStream({pull(){ return new Promise(()=>{}); }})),catalog);
  const controller=new AbortController();
  const pending=stalled(url,{signal:controller.signal});
  controller.abort(new Error("timeout"));
  await assert.rejects(pending,/timeout/);
});
