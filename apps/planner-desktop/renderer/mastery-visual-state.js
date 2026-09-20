(function(root,factory) {
  const api=factory();
  if(typeof module==="object"&&module.exports) module.exports=api;
  root.plannerMasteryVisualState=api;
})(typeof globalThis!=="undefined"?globalThis:this,()=>{
  "use strict";
  // Locked raw edges match official mastery in/out membership. Visual group IDs
  // and reusable texture paths are not membership keys. No metadata => no guess.
  function buildTriggerIndex(nodes,{getId,isMastery,isEligible,neighbors}) {
    const byId=new Map(nodes.map(n=>[String(getId(n)),n]));
    const index=new Map();
    for(const mastery of nodes) {
      if(!isMastery(mastery)) continue;
      const id=String(getId(mastery));
      const candidates=new Set();
      for(const neighbor of neighbors(id)||[]) {
        const key=String(neighbor),node=byId.get(key);
        if(key!==id&&node&&!isMastery(node)&&isEligible(node)) candidates.add(key);
      }
      index.set(id,Object.freeze([...candidates].sort()));
    }
    return index;
  }
  function isTriggered(candidateIds,allocated,weaponSet1,weaponSet2) {
    return (candidateIds||[]).some(id=>allocated.has(id)||weaponSet1.has(id)||weaponSet2.has(id));
  }
  return {buildTriggerIndex,isTriggered};
});
