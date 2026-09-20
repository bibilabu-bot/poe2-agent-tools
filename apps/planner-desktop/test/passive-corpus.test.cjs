"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {passiveCorpusIdentity} = require("../electron/passive-corpus.cjs");

test("RAG identity invalidates changed source bytes even when snapshot label is unchanged", () => {
  const lock={snapshotId:"same",sources:[{integrity:{sha256:"a"}}]};
  const candidate={candidates:[{integrity:{sha256:"b"}}]};
  const baseline=passiveCorpusIdentity(lock,candidate);
  assert.equal(passiveCorpusIdentity(structuredClone(lock),structuredClone(candidate)),baseline);
  assert.notEqual(passiveCorpusIdentity(lock,{candidates:[{integrity:{sha256:"c"}}]}),baseline);
  assert.notEqual(passiveCorpusIdentity({...lock,sources:[]},candidate),baseline);
});
