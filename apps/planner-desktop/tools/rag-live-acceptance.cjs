"use strict";
// Explicit opt-in; secrets stay inside Electron/main and the trusted Python pipe.
// Uses a separate synthetic conversation, never resets the user's chat/notebook.
const {app,safeStorage}=require("electron");
const fs=require("node:fs/promises"),path=require("node:path"),crypto=require("node:crypto"),os=require("node:os"),assert=require("node:assert/strict");
const {AgentCredentialStore}=require("../electron/agent-credential-store.cjs");
const {createRetrievalSettings}=require("../electron/retrieval-settings.cjs");
const {PythonAgentClient}=require("../electron/python-agent-client.cjs");
const {AgentService}=require("../electron/agent-service.cjs");
const {buildPassiveCorpus,passiveCorpusIdentity}=require("../electron/passive-corpus.cjs");
const lock=require("../../../data/upstream-sources.lock.json");
const candidates=require("../data/localization-candidates.json");
// Electron's encryption context must match the desktop profile before ready.
app.setPath("userData",path.join(app.getPath("appData"),"poe2-planner-desktop"));
app.whenReady().then(async()=>{
  if(process.env.P2AT_RAG_LIVE!=="1")throw new Error("Explicit P2AT_RAG_LIVE=1 required for paid API calls");
  const userData=path.join(app.getPath("appData"),"poe2-planner-desktop");
  const profiles=await createRetrievalSettings({userDataPath:userData,safeStorage,isTrustedSender:()=>false}).profiles();
  if(!profiles)throw new Error("Save embedding and reranker profiles before live acceptance");
  const read=async(file,integrity)=>{const bytes=await fs.readFile(file);assert.equal(bytes.length,integrity.bytes);assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"),integrity.sha256);return bytes.toString("utf8");};
  const core=path.join(userData,"game-data/core");
  const source=id=>lock.sources.find(s=>s.id===id).integrity;
  const corpus=buildPassiveCorpus({
    official:JSON.parse(await read(path.join(core,"official-data.json"),source("shared.ggg.passive-tree"))),
    runtime:JSON.parse(await read(path.join(core,"tree-pre.json"),source("runtime.drydream.tree-pre"))),
    translation:await read(path.join(core,"ChineseTranslation.lua"),source("runtime.translation.zh-cn")),
    wegame:await read(path.join(userData,"game-data/localization-candidates/wegame-passive-tree-zh-cn.js"),candidates.candidates[0].integrity),sourceVersion:lock.snapshotId});
  const fixture=corpus.nodes.find(n=>n.id==="52");
  assert.equal(fixture.name,"狂热者誓言");assert.ok(fixture.stats.some(s=>s.text.includes("能量护盾无法充能")));
  console.log("RAG_CORPUS "+JSON.stringify({nodes:corpus.nodes.length,uniqueTexts:new Set(corpus.nodes.map(n=>n.text)).size,version:corpus.version,acceptanceNode:fixture}));
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),"p2at-rag-live-"));
  const client=new PythonAgentClient({memoryPath:path.join(temp,"memory.sqlite3"),onProgress:p=>console.log("RAG_PROGRESS "+JSON.stringify(p))});
  try{
    const config={path:path.join(userData,"passive-rag.sqlite3"),profiles,sourceVersion:passiveCorpusIdentity(lock,candidates)};
    await client.request("rag_configure",config);
    console.log("RAG_BUILD "+JSON.stringify(await client.request("rag_build",{corpus})));
    const query="有没有哪个天赋可以通过生命再生回复能量护盾";
    const search=await client.request("rag_search",{arguments:{query}});
    console.log("RAG_SEARCH "+JSON.stringify(search));assert.ok(search.matches.some(r=>r.id==="52"));
    const evidence=await client.request("rag_search",{tool:"read_passive_nodes",arguments:{ids:["52"]}});
    console.log("RAG_READ "+JSON.stringify(evidence));
    const chat=await new AgentCredentialStore({userDataPath:userData,safeStorage}).load();
    if(!chat)throw new Error("Chat configuration required");
    const agent=new AgentService({client});
    agent.ragConfiguration=async()=>config;
    await agent.configure(chat);
    const reply=await agent.send({model:process.env.P2AT_RAG_CHAT_MODEL||"kimi-k3",text:query,toolsEnabled:true});
    assert.equal(reply.ok,true,reply.error?.code);
    const tools=reply.trace.map(r=>({name:r.name,ok:r.ok,arguments:r.arguments,result:r.result}));
    console.log("RAG_AGENT "+JSON.stringify({text:reply.text,tools}));
    assert.ok(reply.trace.some(r=>r.name==="search_passive_nodes"&&r.ok));
    assert.ok(reply.trace.some(r=>r.name==="read_passive_nodes"&&r.ok&&r.result.includes('"52"')));
    for(const word of ["52","狂热者誓言","溢出","无法充能"])assert.ok(reply.text.includes(word),`Reply omitted ${word}`);
    assert.ok(!/只能靠|完全取决/.test(reply.text),"Reply overstates source evidence");
    await agent.reset();
    await agent.restoreConversation([{role:"user",content:"测试项目的上线安排在周五。"},{role:"assistant",content:"已记下上线安排。"}]);
    const memory=await agent.send({model:process.env.P2AT_RAG_CHAT_MODEL||"kimi-k3",text:"请用 search_memory_semantic 查一下之前说的发布日程，然后用 read_memory 核对原文。我们哪天上线？",toolsEnabled:true});
    assert.equal(memory.ok,true,memory.error?.code);
    assert.ok(memory.trace.some(r=>r.name==="search_memory_semantic"&&r.ok));
    assert.ok(memory.trace.some(r=>r.name==="read_memory"&&r.ok));assert.ok(memory.text.includes("周五"));
    console.log("RAG_MEMORY "+JSON.stringify({text:memory.text,tools:memory.trace}));
  }finally{client.terminate();/* Keep synthetic DB in OS temp for audit, never touch user's memory. */}
}).then(()=>app.exit(0),error=>{console.error("RAG_ACCEPTANCE_FAILED "+JSON.stringify({code:error.code,message:error.message}));app.exit(1);});
