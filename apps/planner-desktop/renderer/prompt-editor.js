"use strict";
(() => {
  const $=id=>document.getElementById(id),dialog=$("promptEditor"),status=$("promptEditorStatus");
  let busy=false,loaded=false,category="system",dirty=false;
  function controls(){
    $("savePromptBlocks").disabled=busy||!loaded;$("resetPromptBlocks").disabled=busy||!loaded;$("closePromptEditor").disabled=busy;
    for(const field of $("promptEditorBlocks").querySelectorAll("textarea"))field.disabled=busy;
  }
  function selectCategory(next){
    category=next;
    $("systemPromptCategory").setAttribute("aria-pressed",String(next==="system"));
    $("toolPromptCategory").setAttribute("aria-pressed",String(next==="tool"));
    for(const section of $("promptEditorBlocks").children)section.hidden=section.dataset.category!==next;
    $("promptCategoryHelp").textContent=next==="system"
      ?"全部非工具的固定提示文本，包括记忆上下文前缀。原文完整显示，换行和空格原样保存；动态历史、笔记和检索结果是数据，不是提示词模板。"
      :"全部工具描述全文。修改会用于模型看到的工具说明；工具名称、参数类型和执行权限是程序契约，不是可编辑的提示词。切换分类不会丢失未保存修改。";
  }
  function render(prompt){
    if(!Array.isArray(prompt?.blocks)||!prompt.blocks.length||prompt.blocks.some(b=>!b||!["system","tool"].includes(b.category)||typeof b.text!=="string"))throw Error("提示词块读取失败");
    const enabled=new Set(prompt.sections.map(block=>block.id));
    $("promptEditorBlocks").replaceChildren(...prompt.blocks.map(block=>{
      const section=document.createElement("section"),label=document.createElement("label"),field=document.createElement("textarea"),help=document.createElement("p");
      section.dataset.category=block.category;
      field.id=`prompt-block-${block.id}`;field.dataset.block=block.id;field.value=block.text;field.rows=6;field.spellcheck=false;
      field.addEventListener("input",()=>{dirty=true;status.textContent="有未保存修改；切换分类会保留草稿，请点击保存全部修改。";});
      label.htmlFor=field.id;label.textContent=`${block.label} · ${block.id}${block.category==="system"&&block.id!=="memory_prefix"?` · ${enabled.has(block.id)?"当前启用":"当前未启用"}`:""}${block.custom?" · 已自定义":" · 默认"}`;
      help.className="agent-help";help.textContent=block.usage+"。每块最多 4000 字符。";
      section.append(label,help,field);return section;
    }));
    loaded=true;dirty=false;selectCategory(category);
    status.textContent=prompt.storageError||`${prompt.version} · 系统 ${prompt.blocks.filter(b=>b.category==="system").length} 块 / 工具 ${prompt.blocks.filter(b=>b.category==="tool").length} 块。保存后用于后续请求。`;
  }
  async function perform(action,success=""){
    if(busy)return;busy=true;controls();
    try{const result=await action();if(!result?.ok)throw Error(result?.error?.message||"操作失败，请重试");render(result.prompt);if(success)status.textContent+=" "+success;}
    catch(error){status.textContent=error.message;}
    finally{busy=false;controls();}
  }
  $("systemPromptCategory").addEventListener("click",()=>selectCategory("system"));
  $("toolPromptCategory").addEventListener("click",()=>selectCategory("tool"));
  $("openPromptEditor").addEventListener("click",()=>{
    loaded=false;dirty=false;$("promptEditorBlocks").replaceChildren();selectCategory("system");status.textContent="正在读取全部提示词…";dialog.showModal();
    perform(()=>window.desktopAPI?.agent?.inspectPrompt());
  });
  function mayClose(){return !busy&&(!dirty||window.confirm("有未保存的提示词修改，确定放弃并关闭？"));}
  $("closePromptEditor").addEventListener("click",()=>{if(mayClose())dialog.close();});
  dialog.addEventListener("cancel",event=>{if(!mayClose())event.preventDefault();});
  $("savePromptBlocks").addEventListener("click",()=>{
    const overrides=Object.fromEntries([...$("promptEditorBlocks").querySelectorAll("textarea")].map(field=>[field.dataset.block,field.value]));
    perform(()=>window.desktopAPI.agent.savePrompts(overrides),"已保存，后续请求生效。");
  });
  $("resetPromptBlocks").addEventListener("click",()=>{if(window.confirm("恢复两类全部默认提示词？这会替换本机自定义提示词，不影响历史记录。"))perform(()=>window.desktopAPI.agent.savePrompts({}));});
})();
