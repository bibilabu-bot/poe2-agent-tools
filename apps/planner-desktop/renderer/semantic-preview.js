(function(root){
  'use strict';
  const labels={attribute:'属性簇',jewel:'珠宝簇',passive:'天赋簇'};
  function mount(host,snapshot,candidate){
    host.replaceChildren();
    const topology=root.plannerSemanticTopology.deriveSemanticTopology(snapshot.nodes,snapshot.adjacency);
    const nodes=new Map(snapshot.nodes.map(n=>[n.id,n]));
    const groups=[['通用',candidate.allocated],['武器 I',candidate.weaponSet1Allocated],['武器 II',candidate.weaponSet2Allocated],['升华',candidate.ascAllocated]];
    const imported=new Set(groups.flatMap(([,ids])=>Array.from(ids||[])));
    const touched=topology.clusters.filter(c=>c.nodeIds.some(id=>imported.has(id)));
    const el=(tag,text,parent=host)=>{const n=document.createElement(tag);if(text)n.textContent=text;parent.append(n);return n;};
    el('p',`全树 ${topology.clusters.length} 簇 · 属性 ${topology.clusters.filter(c=>c.type==='attribute').length} · 珠宝 ${topology.clusters.filter(c=>c.type==='jewel').length} · 天赋 ${topology.clusters.filter(c=>c.type==='passive').length} · 跨簇连接 ${topology.clusterEdges.length}`);
    el('p',`本次导入涉及 ${touched.length} 簇；全树未分类 ${topology.unclassifiedNodes.length} 个节点，升华另列 ${topology.excludedAscendancyNodeIds.length} 个节点。`);
    el('p','只读验证：簇来自当前加载的整棵树；“导入”标记来自本次候选，不是当前 Build。不会分配天赋。');
    const filterLabel=el('label','');const filter=el('input','',filterLabel);filter.type='checkbox';filter.checked=true;
    filterLabel.append(document.createTextNode('仅看本次导入涉及的簇'));
    const selectLabel=el('label','选择簇');const select=el('select','',selectLabel);select.setAttribute('aria-label','选择语义簇');
    const queryLabel=el('label','节点 ID 定位');const query=el('input','',queryLabel);query.type='text';query.inputMode='numeric';query.placeholder='例如 722';query.setAttribute('aria-label','节点 ID 定位');
    const locate=el('button','定位所属簇');locate.type='button';
    const status=el('p','');status.setAttribute('role','status');
    const sectionLabel=el('label','查看内容');const section=el('select','',sectionLabel);section.setAttribute('aria-label','簇详情内容');
    for(const [value,label] of [['nodes','内部节点'],['edges','内部真实边'],['boundaries','跨簇真实边']]){const o=el('option',label,section);o.value=value;}
    const detail=el('p','');const list=el('ul','');list.className='semantic-preview-list';
    const prev=el('button','上一页');prev.type='button';const next=el('button','下一页');next.type='button';
    let offset=0;
    const nodeLabel=id=>`${id} ${nodes.get(id)?.name||''}${imported.has(id)?' [导入：'+groups.filter(([,ids])=>ids?.has(id)).map(([label])=>label).join(' / ')+']':''}`;
    function render(){
      list.replaceChildren();const cluster=topology.clusters.find(c=>c.id===select.value);
      if(!cluster){detail.textContent='没有符合筛选条件的簇';prev.disabled=next.disabled=true;return;}
      let rows;
      if(section.value==='nodes')rows=cluster.nodeIds.map(id=>({text:nodeLabel(id)}));
      else if(section.value==='edges')rows=cluster.edges.map(([a,b])=>({text:`${nodeLabel(a)} ↔ ${nodeLabel(b)}`}));
      else rows=topology.clusterEdges.filter(e=>e.source===cluster.id||e.target===cluster.id).flatMap(e=>e.physicalEdges.map(([a,b])=>({text:`${a} ↔ ${b}`,neighbor:e.source===cluster.id?e.target:e.source})));
      detail.textContent=`${labels[cluster.type]} ${cluster.id} · ${cluster.nodeIds.length} 节点 / ${cluster.edges.length} 内部边 · 当前 ${rows.length?offset+1:0}–${Math.min(offset+30,rows.length)} / ${rows.length}`;
      for(const row of rows.slice(offset,offset+30)){
        const li=el('li',row.text,list);
        if(row.neighbor){const button=el('button','进入 '+row.neighbor,li);button.type='button';button.onclick=()=>{filter.checked=false;populate(row.neighbor);};}
      }
      prev.disabled=offset===0;next.disabled=offset+30>=rows.length;
    }
    function populate(preferred){
      select.replaceChildren();
      for(const c of filter.checked?touched:topology.clusters){const o=el('option',`${labels[c.type]} ${c.id} · ${c.nodeIds.length} 节点`,select);o.value=c.id;}
      if(preferred&&Array.from(select.options).some(o=>o.value===preferred))select.value=preferred;
      offset=0;render();
    }
    locate.onclick=()=>{
      const id=query.value.trim(),clusterId=topology.nodeToCluster[id];
      if(clusterId){status.textContent=nodeLabel(id)+' → '+clusterId;filter.checked=false;populate(clusterId);return;}
      const unknown=topology.unclassifiedNodes.find(n=>n.nodeId===id);
      status.textContent=unknown?`${nodeLabel(id)}：未分类（${unknown.reason}），未强行归簇。`:topology.excludedAscendancyNodeIds.includes(id)?`${nodeLabel(id)}：升华节点，单独处理。`:'当前树中没有该节点 ID';
    };
    query.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();locate.click();}};
    filter.onchange=()=>populate(select.value);select.onchange=section.onchange=()=>{offset=0;render();};
    prev.onclick=()=>{offset=Math.max(0,offset-30);render();};next.onclick=()=>{offset+=30;render();};
    populate();
  }
  root.plannerSemanticPreview={mount};
})(globalThis);
