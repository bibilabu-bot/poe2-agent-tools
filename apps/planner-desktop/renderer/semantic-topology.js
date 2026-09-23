(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.plannerSemanticTopology=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // Pure quotient of the published L0 adjacency. No Build or eligibility input.
  function deriveSemanticTopology(nodes,adjacency){
    const byId=new Map(nodes.map(n=>[String(n.id),n]));
    const ids=[...byId.keys()].sort(), types=new Map(), unclassifiedNodes=[];
    const excludedAscendancyNodeIds=[];
    for(const id of ids){
      const n=byId.get(id);
      if(n.isAscendancy||n.asc||n.ascendancyId){excludedAscendancyNodeIds.push(id);continue;}
      let reason=null,type=null;
      if(n.isClassStart||n.kind==='classstart') reason='class-start';
      else if(n.isBlighted||n.isConditionalReveal||n.unlockConstraint) reason='special-or-conditional';
      else if(n.isOrdinaryJewelSocket) type='jewel';
      else if(n.isJewelSocket||n.kind==='jewel') reason='special-or-unverified-socket';
      else if(n.isGenericAttribute===true){
        if(n.kind==='small'&&n.sourceStats?.length===1&&n.sourceStats[0]==='+5 to any [Attributes|Attribute]') type='attribute';
        else reason='unverified-attribute-variant';
      } else if(['small','notable','keystone'].includes(n.kind)&&n.sourceStats?.length) type='passive';
      else reason='unknown-node-schema';
      if(type) types.set(id,type); else unclassifiedNodes.push({nodeId:id,reason});
    }
    const neighbors=new Map(ids.map(id=>[id,new Set()])),edgeMap=new Map();
    for(const id of ids) for(const raw of adjacency[id]||[]){
      const other=String(raw);if(!byId.has(other))continue;
      const edge=[id,other].sort();edgeMap.set(JSON.stringify(edge),edge);
      neighbors.get(id).add(other);neighbors.get(other).add(id);
    }
    const clusters=[],nodeToCluster={},seen=new Set();
    for(const id of ids){
      if(seen.has(id)||!types.has(id))continue;
      const type=types.get(id),members=[id];seen.add(id);
      if(type!=='jewel') for(let i=0;i<members.length;i++){
        for(const next of [...neighbors.get(members[i])].sort()) if(!seen.has(next)&&types.get(next)===type){seen.add(next);members.push(next);}
      }
      members.sort();const clusterId=type+':'+members[0];
      for(const member of members) nodeToCluster[member]=clusterId;
      clusters.push({id:clusterId,type,nodeIds:members,edges:[]});
    }
    clusters.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    const clusterMap=new Map(clusters.map(c=>[c.id,c])),boundaries=new Map(),unclassifiedEdges=[];
    const ascIds=new Set(excludedAscendancyNodeIds);
    for(const edge of [...edgeMap.values()].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b),'en'))){
      const a=nodeToCluster[edge[0]],b=nodeToCluster[edge[1]];
      if(!a||!b){
        if(!ascIds.has(edge[0])&&!ascIds.has(edge[1]))unclassifiedEdges.push(edge);
        continue;
      }
      if(a===b){clusterMap.get(a).edges.push(edge);continue;}
      const pair=[a,b].sort(),key=JSON.stringify(pair);
      if(!boundaries.has(key))boundaries.set(key,{source:pair[0],target:pair[1],physicalEdges:[]});
      boundaries.get(key).physicalEdges.push(edge);
    }
    return {version:'semantic-topology-v1',scope:'ordinary-tree',clusters,
      clusterEdges:[...boundaries.values()].sort((a,b)=>JSON.stringify([a.source,a.target]).localeCompare(JSON.stringify([b.source,b.target]),'en')),
      nodeToCluster,unclassifiedNodes,unclassifiedEdges,excludedAscendancyNodeIds};
  }
  return {deriveSemanticTopology};
});
