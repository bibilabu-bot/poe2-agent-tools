"use strict";
(() => {
  const $=id=>document.getElementById(id),dialog=$("promptEditor"),status=$("promptEditorStatus");
  let busy=false,loaded=false,page="system",dirty=false,pages=[];
  function controls(){
    $("savePromptBlocks").disabled=busy||!loaded;$("resetPromptBlocks").disabled=busy||!loaded;$("closePromptEditor").disabled=busy;
    for(const field of $("promptEditorBlocks").querySelectorAll("textarea"))field.disabled=busy;
  }
  function selectPage(next){
    if(!pages.some(item=>item.id===next))next="system";
    page=next;
    for(const button of $("promptPageNav").querySelectorAll("button")){
      const active=button.dataset.page===next;
      button.setAttribute("aria-pressed",String(active));
      button.setAttribute("aria-current",active?"page":"false");
    }
    for(const section of $("promptEditorBlocks").children)section.hidden=section.dataset.page!==next;
    $("promptCategoryHelp").textContent=next==="system"
      ?"全部非工具的固定提示文本，包括记忆上下文前缀。原文完整显示，换行和空格原样保存；动态历史、笔记和检索结果是数据，不是提示词模板。"
      :"上方简短说明帮助模型选择何时调用；下方详细工具提示词说明使用规则。两者都不会改变工具名称、参数或执行权限。";
  }
  function render(prompt){
    if(!Array.isArray(prompt?.blocks)||!prompt.blocks.length||prompt.blocks.some(b=>!b||!["system","tool"].includes(b.category)||typeof b.text!=="string"))throw Error("提示词块读取失败");
    const enabled=new Set(prompt.sections.map(block=>block.id));
    pages=[{id:"system",label:"系统提示词"},...prompt.blocks.filter(block=>block.category==="tool"&&!block.page).map(block=>({id:block.id,label:block.label}))];
    $("promptPageNav").replaceChildren(...pages.map(item=>{
      const button=document.createElement("button");button.type="button";button.dataset.page=item.id;button.textContent=item.label;
      button.addEventListener("click",()=>selectPage(item.id));return button;
    }));
    const byId=new Map(prompt.blocks.map(block=>[block.id,block]));
    const ordered=prompt.blocks.filter(block=>!block.id.startsWith("purpose_")).flatMap(block=>
      block.id.startsWith("tool_")?[byId.get(`purpose_${block.id.slice(5)}`),block].filter(Boolean):[block]);
    $("promptEditorBlocks").replaceChildren(...ordered.map(block=>{
      const section=document.createElement("section"),label=document.createElement("label"),field=document.createElement("textarea"),help=document.createElement("p");
      section.dataset.page=block.category==="system"?"system":(block.page||block.id);
      field.id=`prompt-block-${block.id}`;field.dataset.block=block.id;field.value=block.text;field.rows=block.id.startsWith("purpose_")?2:6;field.spellcheck=false;
      field.addEventListener("input",()=>{dirty=true;status.textContent="有未保存修改；切换页面会保留草稿，请点击保存全部修改。";});
      label.htmlFor=field.id;label.textContent=`${block.label} · ${block.id}${block.category==="system"&&block.id!=="memory_prefix"?` · ${enabled.has(block.id)?"当前启用":"当前未启用"}`:""}${block.custom?" · 已自定义":" · 默认"}`;
      help.className="agent-help";help.textContent=block.usage+(block.id.startsWith("purpose_")?"。最多 120 字符。":"。每块最多 4000 字符。");
      section.append(label,help,field);return section;
    }));
    loaded=true;dirty=false;selectPage(page);
    status.textContent=prompt.storageError||`${prompt.version} · 系统 ${prompt.blocks.filter(b=>b.category==="system").length} 块 / 工具 ${prompt.blocks.filter(b=>b.id.startsWith("tool_")).length} 个（各有简短说明与详细提示词）。保存后用于后续请求。`;
  }
  async function perform(action,success=""){
    if(busy)return;busy=true;controls();
    try{const result=await action();if(!result?.ok)throw Error(result?.error?.message||"操作失败，请重试");render(result.prompt);if(success)status.textContent+=" "+success;}
    catch(error){status.textContent=error.message;}
    finally{busy=false;controls();}
  }
  $("openPromptEditor").addEventListener("click",()=>{
    loaded=false;dirty=false;page="system";pages=[];$("promptEditorBlocks").replaceChildren();$("promptPageNav").replaceChildren();status.textContent="正在读取全部提示词…";dialog.showModal();dialog.querySelector(".prompt-page-content").scrollTop=0;
    perform(()=>window.desktopAPI?.agent?.inspectPrompt());
  });
  function mayClose(){return !busy&&(!dirty||window.confirm("有未保存的提示词修改，确定放弃并关闭？"));}
  function requestClose(){if(mayClose())dialog.close();}
  $("closePromptEditor").addEventListener("click",requestClose);
  dialog.addEventListener("cancel",event=>{event.preventDefault();requestClose();});
  $("savePromptBlocks").addEventListener("click",()=>{
    const overrides=Object.fromEntries([...$("promptEditorBlocks").querySelectorAll("textarea")].map(field=>[field.dataset.block,field.value]));
    perform(()=>window.desktopAPI.agent.savePrompts(overrides),"已保存，后续请求生效。");
  });
  $("resetPromptBlocks").addEventListener("click",()=>{if(window.confirm("恢复两类全部默认提示词？这会替换本机自定义提示词，不影响历史记录。"))perform(()=>window.desktopAPI.agent.savePrompts({}));});
})();
