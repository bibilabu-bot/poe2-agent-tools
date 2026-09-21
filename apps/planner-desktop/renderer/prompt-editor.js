"use strict";
(() => {
  const $=id=>document.getElementById(id),dialog=$("promptEditor"),status=$("promptEditorStatus");
  const names={base:"基础行为",memory:"会话记忆",rag:"只读知识检索",rag_unavailable:"检索不可用提示"};
  let busy=false,loaded=false;
  function controls(){ $("savePromptBlocks").disabled=busy||!loaded;$("resetPromptBlocks").disabled=busy||!loaded;$("closePromptEditor").disabled=busy; }
  function render(prompt){
    if(!Array.isArray(prompt?.blocks)||prompt.blocks.length!==4)throw Error("提示词块读取失败");
    const enabled=new Set(prompt.sections.map(block=>block.id));
    $("promptEditorBlocks").replaceChildren(...prompt.blocks.map(block=>{
      const section=document.createElement("section"),label=document.createElement("label"),field=document.createElement("textarea");
      field.id=`prompt-block-${block.id}`;field.dataset.block=block.id;field.value=block.text;field.maxLength=4000;field.rows=6;field.spellcheck=false;
      label.htmlFor=field.id;label.textContent=`${names[block.id]} · ${enabled.has(block.id)?"当前启用":"当前未启用"}${block.custom?" · 已自定义":" · 默认"}`;
      section.append(label,field);return section;
    }));
    loaded=true;status.textContent=prompt.storageError||`${prompt.version} · 启用状态是当前运行时快照，发送时重新检查。`;
  }
  async function perform(action,success=""){
    if(busy)return;busy=true;controls();
    try{const result=await action();if(!result?.ok)throw Error(result?.error?.message||"操作失败，请重试");render(result.prompt);if(success)status.textContent+=" "+success;}
    catch(error){status.textContent=error.message;}
    finally{busy=false;controls();}
  }
  $("openPromptEditor").addEventListener("click",()=>{
    loaded=false;$("promptEditorBlocks").replaceChildren();status.textContent="正在读取本地提示词块…";dialog.showModal();
    perform(()=>window.desktopAPI?.agent?.inspectPrompt());
  });
  $("closePromptEditor").addEventListener("click",()=>dialog.close());
  dialog.addEventListener("cancel",event=>{if(busy)event.preventDefault();});
  $("savePromptBlocks").addEventListener("click",()=>{
    const overrides=Object.fromEntries([...$("promptEditorBlocks").querySelectorAll("textarea")].map(field=>[field.dataset.block,field.value]));
    perform(()=>window.desktopAPI.agent.savePrompts(overrides),"已保存，后续请求生效。");
  });
  $("resetPromptBlocks").addEventListener("click",()=>{if(window.confirm("恢复全部默认提示词？这会替换本机自定义提示词，不影响历史记录。"))perform(()=>window.desktopAPI.agent.savePrompts({}));});
})();
