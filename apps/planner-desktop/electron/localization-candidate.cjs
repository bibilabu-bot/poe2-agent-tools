"use strict";

const path = require("node:path");
const { RuntimeResourceError, RESOURCE_ERROR_CODES } = require("./runtime-resource-store.cjs");

function createLocalizationCandidateCatalog(configuration) {
  if (configuration?.schemaVersion !== 1 || !Array.isArray(configuration.candidates)) {
    throw new RuntimeResourceError(RESOURCE_ERROR_CODES.INTEGRITY_FAILED, "Localization candidate configuration is invalid.");
  }
  const byName = new Map();
  for (const candidate of configuration.candidates) {
    const name = candidate?.name;
    const url = candidate?.transport?.url;
    const integrity = candidate?.integrity;
    if (candidate?.status !== "REVIEW"
      || candidate?.scope !== "passive-tree-localization"
      || typeof name !== "string"
      || path.basename(name) !== name
      || !/^https:\/\/wegame\.gtimg\.com\/g\.[a-z0-9.-]+\/helper\/poe2\/assets\/tree-[A-Za-z0-9_-]+\.js$/.test(url || "")
      || integrity?.algorithm !== "sha256"
      || !/^[0-9a-f]{64}$/.test(integrity?.sha256 || "")
      || !Number.isSafeInteger(integrity?.bytes)
      || integrity.bytes <= 0
      || candidate?.provenance?.followMovingChunk !== false
      || candidate?.provenance?.promotion !== "controller-review-required") {
      throw new RuntimeResourceError(RESOURCE_ERROR_CODES.INTEGRITY_FAILED, "Localization candidate metadata is invalid.");
    }
    byName.set(name, Object.freeze({
      id: candidate.id,
      kind: "localization",
      name,
      url,
      bytes: integrity.bytes,
      sha256: integrity.sha256,
      status: candidate.status,
    }));
  }
  return Object.freeze({
    names: Object.freeze([...byName.keys()]),
    resolve(name) {
      if (typeof name !== "string" || path.basename(name) !== name) return null;
      return byName.get(name) || null;
    },
  });
}

function createBoundedCandidateFetch(fetchImpl, catalog) {
  const descriptors=catalog.names.map(name=>catalog.resolve(name));
  return async (url,options={})=>{
    const response=await fetchImpl(url,options);
    const candidate=descriptors.find(item=>item.url===url);
    if(!candidate) return response;
    if(!response.ok || !response.body?.getReader) return response;
    const reader=response.body.getReader();
    const chunks=[];
    let total=0;
    try {
      while(true) {
        options.signal?.throwIfAborted();
        const {done,value}=await new Promise((resolve,reject)=>{
          const aborted=()=>reject(options.signal?.reason||new Error("Localization candidate download aborted."));
          options.signal?.addEventListener("abort",aborted,{once:true});
          reader.read().then(resolve,reject).finally(()=>options.signal?.removeEventListener("abort",aborted));
        });
        if(done) break;
        total+=value.byteLength;
        if(total>candidate.bytes) {
          await reader.cancel();
          throw new Error("Localization candidate exceeded its fixed byte limit.");
        }
        chunks.push(Buffer.from(value));
      }
    } catch(error) {
      try { await reader.cancel(); } catch {}
      throw error;
    }
    return new Response(Buffer.concat(chunks,total),{status:response.status,headers:response.headers});
  };
}

module.exports = Object.freeze({ createBoundedCandidateFetch, createLocalizationCandidateCatalog });
