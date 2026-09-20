"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { testRetrievalConnection: probe } = require("../electron/retrieval-connection-test.cjs");
const config = {baseUrl:"https://example.com/v1", model:"text-embedding-v4", dimensions:3, apiKey:"synthetic-key"};
test("embedding probe sends only fixed sample and validates the returned vector",async()=>{
  const result=await probe("embedding",config,async(url,options)=>{
    assert.equal(url,"https://example.com/v1/embeddings"); assert.equal(options.redirect,"error");
    assert.deepEqual(JSON.parse(options.body).input,["连接测试：你好"]);
    assert.equal(options.headers.Authorization,"Bearer synthetic-key");
    return Response.json({data:[{embedding:[1,2,3]}]});
  });
  assert.equal(result.ok,true); assert.ok(!JSON.stringify(result).includes(config.apiKey));
  for (const embedding of [[],[0,0,0],[1,2],["1",2,3]]) assert.equal((await probe("embedding",config,async()=>Response.json({data:[{embedding}]}))).ok,false);
});
test("reranker supports native and flat protocols and validates complete results",async()=>{
  const results=[{index:0,relevance_score:0.9},{index:1,relevance_score:0.1}];
  for (const native of [true,false]) {
    const result=await probe("reranker",{...config,model:"custom",baseUrl:native?"https://example.com/text-rerank":"https://example.com/rerank"},async(_url,options)=>{
      const body=JSON.parse(options.body);assert.equal((native?body.input:body).documents.length,2);
      return Response.json(native?{output:{results}}:{results});
    });assert.equal(result.ok,true);
  }
  assert.equal((await probe("reranker",config,async()=>Response.json({results:[results[0],results[0]]}))).ok,false);
});
test("probe rejects HTTP errors, business errors, malformed or oversized bodies without leaking secrets",async()=>{
  for(const response of [new Response(config.apiKey,{status:401}),Response.json({error:{message:config.apiKey}}),new Response("not json"),new Response("x".repeat(256001))]) {
    const result=await probe("embedding",config,async()=>response);
    assert.equal(result.ok,false);assert.ok(!JSON.stringify(result).includes(config.apiKey));
  }
  const result=await probe("embedding",config,async()=>{throw new Error(config.apiKey)});
  assert.ok(!JSON.stringify(result).includes(config.apiKey));
});
test("timeout covers a stalled response body",async()=>{
  const result=await probe("embedding",config,async(_url,{signal})=>new Response(new ReadableStream({start(controller){signal.addEventListener("abort",()=>controller.error(new Error("aborted")));}})),20);
  assert.equal(result.ok,false);assert.match(result.error.message,/超时/);
});
