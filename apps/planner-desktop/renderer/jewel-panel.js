(function(root) {
  'use strict';
  function mount({read,commit,focus}) {
    const core=root.plannerJewelState;
    let selectedSocket='', selectedInstance='';
    const button=document.createElement('button');
    button.id='manageJewels';button.type='button';button.textContent='珠宝管理';
    const host=document.createElement('dialog');host.id='jewelManager';
    host.style.cssText='width:min(620px,90vw);max-height:85vh;overflow:auto;background:#171a20;color:#e8dfcd;border:1px solid #9a8257;border-radius:12px;padding:22px';
    host.innerHTML=`<button id="jewelCloseTop" type="button" style="float:right;position:sticky;top:0" aria-label="关闭珠宝管理">关闭</button><h2 style="margin-top:0">珠宝与插槽</h2>
      <p>已批准样本目录：6 种珠宝 · 12 个真实普通插槽。不是完整游戏珠宝库。</p>
      <p style="color:#e9be76">仅管理装备记录。属性、半径、规则及种子效果尚未计算。</p>
      <label for="jewelSocket">普通插槽</label><select id="jewelSocket"></select>
      <p id="jewelSocketStatus"></p><button id="jewelLocate" type="button">定位插槽</button>
      <hr><label for="jewelDefinition">样本珠宝种类</label><select id="jewelDefinition"></select>
      <button id="jewelCreate" type="button">添加实例到库存</button>
      <label for="jewelInstance" style="display:block;margin-top:16px">我的珠宝实例</label><select id="jewelInstance"></select>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0">
        <button id="jewelEquip" type="button">装备 / 替换</button><button id="jewelRemove" type="button">卸下此插槽</button>
        <button id="jewelCopy" type="button">复制实例</button><button id="jewelDelete" type="button">删除实例</button>
      </div><p>替换与卸下会保留原实例。仍有珠宝的插槽不能退点；请先卸下。重置或换职业会明确确认清空珠宝。</p>
      <details><summary id="jewelInactiveCount">保留的异常装备记录</summary><div id="jewelInactive"></div></details>
      <p id="jewelMessage" role="status" aria-live="polite"></p><button id="jewelClose" type="button">关闭</button>`;
    document.body.append(host);
    // Layout shell moves existing controls at DOMContentLoaded; attach afterwards.
    const attach=()=>{document.querySelector('#tool-panel-class')?.append(button);};
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',attach,{once:true});else attach();
    const q=id=>host.querySelector('#'+id);
    const options=(select,rows,value)=>{select.replaceChildren(...rows.map(([v,t])=>{const o=document.createElement('option');o.value=v;o.textContent=t;return o;}));select.value=value;if(select.selectedIndex<0)select.selectedIndex=0;return select.value;};
    function render() {
      const {state,catalog,allocated,ready}=read();
      button.disabled=!ready;
      const index=core.catalogIndex(catalog), normalized=core.normalizeJewelState(state,catalog);
      const label=i=>`${index.definitions.get(i.definitionId)?.displayName || '未知珠宝'} · ${i.id.slice(-8)}`;
      selectedSocket=options(q('jewelSocket'),catalog.sockets.map(s=>[s.nodeId,`${s.nodeId} · ${allocated.has(s.nodeId)?'已分配':'未分配'}${state.placements.some(p=>p.socketNodeId===s.nodeId)?' · 有装备记录':' · 空'}`]),selectedSocket);
      options(q('jewelDefinition'),catalog.definitions.filter(d=>d.status==='active').map(d=>[d.definitionId,d.displayName]),q('jewelDefinition').value);
      selectedInstance=options(q('jewelInstance'),state.instances.map(i=>[i.id,`${label(i)}${state.placements.some(p=>p.instanceId===i.id)?' · 已放置':' · 库存'}`]),selectedInstance);
      const placement=normalized.activePlacements?.find(p=>p.socketNodeId===selectedSocket);
      q('jewelSocketStatus').textContent=placement?`${label(state.instances.find(i=>i.id===placement.instanceId))}：${allocated.has(selectedSocket)?'已装备（效果未计算）':'插槽未分配，记录保留但未启用'}`:'空插槽或无法启用的保留记录。';
      q('jewelEquip').disabled=!ready || !selectedInstance || !allocated.has(selectedSocket);
      q('jewelRemove').disabled=!ready || !state.placements.some(p=>p.socketNodeId===selectedSocket);
      for(const id of ['jewelDelete','jewelCopy'])q(id).disabled=!ready||!selectedInstance;
      q('jewelCreate').disabled=!ready;q('jewelLocate').disabled=!selectedSocket;
      // Normalization returns clones, so compare identities rather than references.
      const records=state.placements.filter(p=>!normalized.activePlacements?.some(a=>a.socketNodeId===p.socketNodeId&&a.instanceId===p.instanceId)||!allocated.has(p.socketNodeId));
      q('jewelInactiveCount').textContent=`保留但未启用的装备记录（${records.length}）`;
      q('jewelInactive').replaceChildren(...records.map(p=>{const row=document.createElement('div');row.textContent=`${p.socketNodeId} → ${p.instanceId} `;const remove=document.createElement('button');remove.textContent='移除此记录';remove.disabled=!ready;remove.onclick=()=>run('removePlacement',p.socketNodeId,p.instanceId);row.append(remove);return row;}));
    }
    function run(action,...args) {
      const {state,catalog,allocated,ready}=read();if(!ready)return;
      try {
        const result=core[action](state,...args,{catalog,allocated});
        if(!result.ok){q('jewelMessage').textContent='未更改：插槽须已分配，且实例须受支持并未装备在其他插槽。';return;}
        if(result.id)selectedInstance=result.id;
        commit(result.state);render();q('jewelMessage').textContent='已更新。请保存 Build 以保留更改。';
      }catch {q('jewelMessage').textContent='操作失败，珠宝记录未更改。';}
    }
    button.onclick=()=>{render();host.showModal();};
    q('jewelClose').onclick=()=>host.close();
    q('jewelCloseTop').onclick=()=>host.close();
    q('jewelSocket').onchange=e=>{selectedSocket=e.target.value;render();};
    q('jewelInstance').onchange=e=>{selectedInstance=e.target.value;render();};
    q('jewelCreate').onclick=()=>run('createInstance',q('jewelDefinition').value,{});
    q('jewelEquip').onclick=()=>run('replaceSocket',selectedSocket,selectedInstance);
    q('jewelRemove').onclick=()=>run('removePlacement',selectedSocket,undefined);
    q('jewelCopy').onclick=()=>run('copyInstance',selectedInstance);
    q('jewelDelete').onclick=()=>{if(root.confirm('删除此珠宝实例及其所有装备记录？'))run('deleteInstance',selectedInstance);};
    q('jewelLocate').onclick=()=>{focus(selectedSocket);host.close();};
    return {render,selectSocket:id=>{selectedSocket=id;render();if(!host.open)host.showModal();}};
  }
  root.plannerJewelPanel={mount};
})(window);
