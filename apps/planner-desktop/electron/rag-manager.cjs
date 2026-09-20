"use strict";
const path = require("node:path");
const { PythonAgentClient } = require("./python-agent-client.cjs");

function createRagManager({userDataPath,profiles,loadCorpus,isTrustedSender,sourceVersion}) {
  let state={building:false,ready:false,count:0,completed:0,total:0}, building=null;
  const client = new PythonAgentClient({onProgress:progress=>{state={...state,...progress};}});
  const indexPath = path.join(userDataPath,"passive-rag.sqlite3");
  let epoch=0;
  const configuration = async()=>({path:indexPath,profiles:await profiles(),sourceVersion});
  const guard = event=>{if(!isTrustedSender(event)) throw new Error("untrusted");};
  const build = async()=>{
    const token=++epoch;
    state={...state,building:true,error:null,completed:0,total:0};
    try {
      const config = await configuration();
      if(token!==epoch)throw new Error("cancelled");
      if(!config.profiles) throw new Error("profiles required");
      await client.request("rag_configure",config);
      const corpus=await loadCorpus();
      if(token!==epoch)throw new Error("cancelled");
      const result=await client.request("rag_build",{corpus});
      state={...state,...result};
    } catch { state={...state,error:"构建未完成：请检查模型配置、连接测试和本地天赋数据。可重试并复用已完成向量。"}; }
    finally {state={...state,building:false};building=null;}
  };
  return {
    configuration,
    status:async event=>{guard(event);if(!building) {try {state={...state,...await client.request("rag_configure",await configuration())};} catch {state={...state,ready:false,error:"无法读取 RAG 配置或索引"};}}return {...state};},
    build:async event=>{guard(event);if(!building) building=build();return {...state};},
    cancel:async event=>{guard(event);epoch++;client.terminate();return {ok:true};},
    close:()=>client.terminate()
  };
}
module.exports={createRagManager};
