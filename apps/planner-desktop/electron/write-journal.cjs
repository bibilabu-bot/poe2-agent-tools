"use strict";
const {randomUUID}=require("node:crypto");
class WriteJournal {
  constructor(){this.id=randomUUID();this.operations=[];this.pending=new Set();}
  start(method,params){
    const entry={method,nodeId:String(params.nodeId||"").slice(0,128),category:String(params.category||"").slice(0,32),status:"unknown"};
    this.operations.push(entry);return entry;
  }
  settle(entry,result){
    entry.status=result?.success === true ? "applied" : result?.success === false ? "rejected" : "unknown";
    entry.reason=result?.errorCode || null;
    entry.addedIds=Array.isArray(result?.newIds)?result.newIds:[];
    entry.removedByCategory=result?.removedByCategory || {};
  }
  recordTrace(trace){
    if(!["allocate_tree_node","deallocate_tree_node"].includes(trace.name))return;
    let args;try{args=JSON.parse(trace.arguments);}catch{return;}
    if(!args || typeof args!=="object" || Array.isArray(args))return;
    const method=trace.name==="allocate_tree_node"?"allocate":"deallocate";
    const existing=this.operations.find(e=>!e.traced&&e.method===method&&e.nodeId===args.nodeId&&e.category===args.category);
    if(existing){existing.traced=true;return;}
    const e=this.start(method,args);e.status="not_executed";e.traced=true;
  }
  summary(interrupted){
    return {runId:this.id,interrupted,unsubmittedPlan:"unknown",rolledBack:false,operations:this.operations.slice(0,100).map(e=>({
      method:e.method,nodeId:e.nodeId,category:e.category,status:e.status,reason:e.reason,
      addedCount:e.addedIds?.length||0,addedIds:(e.addedIds||[]).slice(0,32),
      removedCounts:Object.fromEntries(Object.entries(e.removedByCategory||{}).map(([c,ids])=>[c,ids.length])),
      removedByCategory:Object.fromEntries(Object.entries(e.removedByCategory||{}).map(([c,ids])=>[c,ids.slice(0,32)])),
      idListsMayBeTruncated:(e.addedIds?.length||0)>32||Object.values(e.removedByCategory||{}).some(ids=>ids.length>32)}))};
  }
  async drain(ms=2000){
    let timer;
    try{await Promise.race([Promise.allSettled([...this.pending]),new Promise(resolve=>{timer=setTimeout(resolve,ms);})]);}
    finally{clearTimeout(timer);}
  }
}
module.exports={WriteJournal};
