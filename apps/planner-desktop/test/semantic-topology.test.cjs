const test=require('node:test'),assert=require('node:assert/strict');
const {deriveSemanticTopology:derive}=require('../renderer/semantic-topology.js');
const passive=id=>({id,kind:'small',sourceStats:['10% increased Damage']});
const attribute=id=>({...passive(id),isGenericAttribute:true,sourceStats:['+5 to any [Attributes|Attribute]']});
test('connected attribute components, individual sockets and cut passive components preserve L0 edges',()=>{
  const nodes=[attribute('1'),attribute('2'),passive('3'),passive('4'),{...passive('5'),isOrdinaryJewelSocket:true},passive('6'),attribute('7')];
  const adjacency={'1':['2','3'],'2':['1','4'],'3':['1','4'],'4':['3','2','5'],'5':['4','6'],'6':['5'],'7':[]};
  const before=JSON.stringify({nodes,adjacency});const result=derive(nodes,adjacency);
  assert.deepEqual(result.clusters.map(c=>[c.id,c.nodeIds]),[['attribute:1',['1','2']],['attribute:7',['7']],['jewel:5',['5']],['passive:3',['3','4']],['passive:6',['6']]]);
  const allEdges=result.clusters.flatMap(c=>c.edges).concat(result.clusterEdges.flatMap(e=>e.physicalEdges));
  assert.equal(allEdges.length,6);
  assert.equal(new Set(allEdges.map(JSON.stringify)).size,6);
  assert.equal(JSON.stringify({nodes,adjacency}),before);
  assert.deepEqual(result,derive([...nodes].reverse(),Object.fromEntries(Object.entries(adjacency).reverse().map(([k,v])=>[k,[...v].reverse()]))));
  assert.deepEqual(result,derive(nodes.map(n=>({...n,allocated:true,isGeneralEligible:false,group:999,orbit:1})),adjacency));
});
test('specials stay unclassified, ascendancy stays separate, Chinese text cannot establish attributes',()=>{
  const nodes=[{...attribute('1'),asc:'Mercenary3'}, {...passive('2'),isJewelSocket:true}, {...passive('3'),isConditionalReveal:true}, {...attribute('4'),sourceStats:['+10 to any [Attributes|Attribute]']}, {...passive('5'),name:'属性',stats:['+5 力量']}, {...passive('6'),kind:'classstart'}];
  const result=derive(nodes,{});
  assert.deepEqual(result.excludedAscendancyNodeIds,['1']);
  assert.deepEqual(result.unclassifiedNodes.map(n=>n.nodeId),['2','3','4','6']);
  assert.equal(result.nodeToCluster['5'],'passive:5');
});
test('parallel cross-cluster edges are retained and duplicate adjacency is normalized',()=>{
  const result=derive([attribute('1'),attribute('2'),passive('3'),passive('4')],{'1':['2','3','3'],'2':['4'],'3':['4']});
  assert.equal(result.clusterEdges.length,1);
  assert.deepEqual(result.clusterEdges[0].physicalEdges,[['1','3'],['2','4']]);
});
test('unclassified incident edges are preserved without forcing nodes into clusters',()=>{
  const nodes=[passive('1'),{...passive('2'),kind:'classstart'},{id:'3',kind:'unknown'}, {...passive('4'),asc:'Mercenary3'}];
  const result=derive(nodes,{'1':['2'],'2':['3'],'3':['4']});
  assert.deepEqual(result.unclassifiedEdges,[['1','2'],['2','3']]);
  assert.equal(result.nodeToCluster['2'],undefined);
  assert.deepEqual(result.excludedAscendancyNodeIds,['4']);
});
