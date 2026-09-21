"use strict";
(() => {
  const panel=document.getElementById("promptInspector");
  const button=document.getElementById("inspectPrompt");
  const status=document.getElementById("promptInspectionStatus");
  const output=document.getElementById("promptInspectionText");
  let revision=0;
  function clear() { revision+=1; output.textContent=""; output.hidden=true; status.textContent="尚未读取；请主动读取当前模板与功能状态。"; }
  panel.addEventListener("toggle",clear);
  button.addEventListener("click",async()=>{
    const request=++revision;
    output.textContent="";output.hidden=true;button.disabled=true;status.textContent="正在读取本地公开模板…";
    try {
      const result=await window.desktopAPI?.agent?.inspectPrompt();
      if(request!==revision)return;
      if(!result?.ok)throw new Error(result?.error?.message||"提示词读取不可用");
      const p=result.prompt;
      if(typeof p?.text!=="string"||p.text.length>8000||p.privateContextIncluded!==false)throw new Error("提示词查看结果无效");
      const state=p.features;
      status.textContent=`${p.version} · ${p.configured?"运行时已连接":"运行时尚未连接"} · 记忆 ${state.memory?"启用":"未启用"} / RAG ${state.rag?"已挂载":"未挂载"} / 检索故障提示 ${state.ragUnavailable?"启用":"未启用"}。这是读取时快照；发送时会重新检查功能状态。`;
      output.textContent=p.text;output.hidden=false;
    }catch(error){if(request===revision)status.textContent=error.message;}
    finally{button.disabled=false;}
  });
})();
