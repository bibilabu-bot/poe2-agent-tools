(function(root,factory){
  const api=factory(typeof module==="object" && module.exports ? require("./passive-graph.js") : root.plannerPassiveGraph);
  if(typeof module==="object" && module.exports) module.exports=api;
  else root.plannerRefundPlan=api;
})(globalThis,function(pg){
  "use strict";
  const categories=["general","weaponSet1","weaponSet2","ascendancy"];
  const sorted=ids=>[...new Set(ids)].sort(pg.compareNodeIds);
  // Pure transition: callbacks inspect the supplied candidate sets, never mutate live state.
  function planRefund(input,id,category){
    const fail=(code,message)=>({success:false,errorCode:code,message,category});
    if(!categories.includes(category)) return fail("INVALID_CATEGORY","无效的退点类别");
    const before=input.sets;
    const next=Object.fromEntries(categories.map(c=>[c,new Set(before[c])]));
    if((category==="general" && id===input.classStartId) || (category==="ascendancy" && id===input.ascStartId))
      return fail("START_NODE_PROTECTED","起点不能取消");
    if(!next[category].has(id)) return fail("NOT_ALLOCATED","该类别未分配此节点");
    const blocked=ids=>input.blockedBy(new Set(ids)).length>0;
    if(category==="general" && blocked([id])) return fail("BLOCKED_BY_CONDITIONAL","已分配条件显现天赋仍依赖此节点");
    next[category].delete(id);
    const reach=(start,eligible)=>start ? pg.reachableEligibleIds(input.graph,{starts:[start],isEligible:eligible}) : new Set();
    const pruneWeapon=c=>{
      if(!input.classStartId) return;
      const active=new Set([...next.general,...next[c]]);
      const reachable=reach(input.classStartId,(n,x)=>active.has(x)&&input.canTraverse(n,next));
      next[c]=new Set([...next[c]].filter(x=>reachable.has(x)));
    };
    if(category==="general"){
      const candidate=next.general;
      next.general=candidate.has(input.classStartId) ? reach(input.classStartId,(_n,x)=>candidate.has(x)) : new Set();
      if(blocked([...before.general].filter(x=>!next.general.has(x))))
        return fail("BLOCKED_BY_CONDITIONAL","退点会破坏已分配条件显现天赋的前置条件");
      pruneWeapon("weaponSet1");pruneWeapon("weaponSet2");
    }else if(category==="ascendancy"){
      const candidate=next.ascendancy;
      next.ascendancy=candidate.has(input.ascStartId) ? reach(input.ascStartId,(n,x)=>candidate.has(x)&&input.canTraverseAsc(n)) : new Set();
      if(blocked([...before.ascendancy].filter(x=>!next.ascendancy.has(x))))
        return fail("BLOCKED_BY_CONDITIONAL","普通树已分配条件显现天赋仍依赖此升华节点");
      if(!input.classStartId) next.general.clear();
      else {
        let changed=true;
        while(changed){
          changed=false;
          for(const x of next.general){
            if(x!==input.classStartId && !input.ordinaryValid(x,next)){next.general.delete(x);changed=true;}
          }
        }
        next.general=reach(input.classStartId,(n,x)=>next.general.has(x)&&!input.isAsc(n));
      }
      // Existing ascendancy refund does not prune weapon sets.
    }else pruneWeapon(category);
    const removedByCategory=Object.fromEntries(categories.map(c=>[c,sorted([...before[c]].filter(x=>!next[c].has(x)))]));
    const removed=sorted(Object.values(removedByCategory).flat());
    const cascadeNodeIds=removed.filter(x=>x!==id);
    return {success:true,category,next,removedByCategory,cascadeNodeIds,
      additionalRefundCount:cascadeNodeIds.length,totalRefundCount:removed.length};
  }
  function describe(plan){
    const {next,success,...details}=plan;
    return {applicable:true,refundable:success,complete:true,...details};
  }
  return Object.freeze({planRefund,describe,categories});
});
