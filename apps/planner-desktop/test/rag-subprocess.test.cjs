"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),http=require("node:http"),fs=require("node:fs/promises"),os=require("node:os"),path=require("node:path");
const {PythonAgentClient}=require("../electron/python-agent-client.cjs");

test("cancelled real subprocess build resumes cached batches without publishing partial nodes", async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),"p2at-rag-cancel-"));
  let blocked=true, arrived;
  const waiting=new Promise(resolve=>{arrived=resolve;});
  const seen=[];
  const server=http.createServer(async(req,res)=>{
    let raw="";for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw);seen.push(body.input);
    if(blocked && seen.length===3){arrived();return;}
    res.setHeader("Content-Type","application/json");
    res.end(JSON.stringify({data:body.input.map((_,index)=>({index,embedding:[1,0]}))}));
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const client=new PythonAgentClient();
  t.after(async()=>{client.terminate();server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
  const baseUrl=`http://127.0.0.1:${server.address().port}`;
  const config={path:path.join(directory,"rag.db"),profiles:{embedding:{baseUrl,model:"fixture",dimensions:2,apiKey:"fixture"},reranker:{baseUrl,model:"fixture",apiKey:"fixture"}}};
  await client.request("rag_configure",config);
  await client.request("rag_build",{corpus:{version:"old",nodes:[{id:"99",text:"old"}]}});
  const corpus={version:"new",nodes:Array.from({length:12},(_,i)=>({id:String(i),text:`中文🙂 ${i}`}))};
  const building=client.request("rag_build",{corpus});
  const rejected=assert.rejects(building,{code:"CANCELLED"});
  await waiting;client.terminate();await rejected;blocked=false;
  const status=await client.request("rag_configure",config);
  assert.equal(status.version,"old");assert.equal(status.count,1);
  const resumed=await client.request("rag_build",{corpus});
  assert.equal(resumed.version,"new");assert.equal(resumed.count,12);
  assert.deepEqual(seen.at(-1),["中文🙂 10","中文🙂 11"]);
  assert.equal(seen.flat().filter(text=>text==="中文🙂 0").length,1);
});
test("RAG runs embedding, reranking and evidence reads through real UTF-8 subprocess; restart and failed rerank are safe",async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),"p2at-rag-"));
  let fail=false;const requests=[];
  const server=http.createServer(async(req,res)=>{
    let raw="";for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests.push({url:req.url,body});
    assert.equal(req.headers.accept,"application/json");
    res.setHeader("Content-Type","application/json");
    if(req.url.endsWith("/embeddings"))res.end(JSON.stringify({data:body.input.map((text,index)=>({index,embedding:text.includes("护盾")?[1,0]:[0,1]}))}));
    else if(fail===true){res.statusCode=500;res.end("fixture-key must not leak");}
    else if(fail==="sse"){res.end('data: {"output":{"results":[]}}\n\n');}
    else res.end(JSON.stringify({results:body.documents.map((text,index)=>({index,relevance_score:text.includes("护盾")?0.9:0.1}))}));
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  const client=new PythonAgentClient();
  t.after(async()=>{client.terminate();server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
  const config={path:path.join(directory,"rag.db"),profiles:{embedding:{baseUrl:url,model:"fixture",dimensions:2,apiKey:"fixture-key"},reranker:{baseUrl:url+"/rerank",model:"fixture",apiKey:"fixture-key"}}};
  await client.request("rag_configure",config);
  const nodes=[{id:"901",name:"护盾🙂",text:"再生护盾🙂",stats:[{text:"不能充能"}]},{id:"902",name:"火焰",text:"火焰伤害",stats:[]}];
  const built=await client.request("rag_build",{corpus:{version:"fixture-v1",nodes}});assert.equal(built.count,2);
  const search=()=>client.request("rag_search",{arguments:{query:"护盾"}});
  assert.equal((await search()).matches[0].id,"901");
  const read=await client.request("rag_search",{tool:"read_passive_nodes",arguments:{ids:["901"]}});
  assert.equal(read.nodes[0].name,"护盾🙂");assert.equal(read.nodes[0].stats[0].text,"不能充能");
  client.terminate();assert.equal((await client.request("rag_configure",config)).ready,true);
  assert.equal((await search()).matches[0].id,"901");
  fail=true;await assert.rejects(search(),error=>error.code==="HTTP_500"&&!error.message.includes("fixture-key"));
  fail="sse";await assert.rejects(search(),error=>error.code==="INVALID_RESPONSE"&&!error.message.includes("fixture-key"));
  assert.ok(requests.some(r=>r.url==="/rerank"));
  assert.ok(!(await fs.readFile(config.path)).includes(Buffer.from("fixture-key")));
});
