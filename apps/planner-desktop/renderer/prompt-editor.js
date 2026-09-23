"use strict";
(() => {
  const $=id=>document.getElementById(id),dialog=$("promptEditor"),status=$("promptEditorStatus");
  // Navigation metadata only: never transforms governed prompt text or tool schemas.
  const groups=[
    {id:"system",label:"系统",tools:["system"]},
    {id:"nodes",label:"通用节点读取",tools:["tool_search_tree_nodes","tool_search_passive_nodes","tool_read_tree_nodes","tool_read_passive_nodes"]},
    {id:"build",label:"当前 Build 查看",tools:["tool_tree_overview","tool_read_tree_cluster","tool_read_tree_neighborhood","tool_find_tree_path"]},
    {id:"write",label:"Build 修改",tools:["tool_allocate_tree_node","tool_deallocate_tree_node"]},
    {id:"memory",label:"会话记忆",tools:["tool_search_memory","tool_search_memory_semantic","tool_read_memory","tool_update_notebook"]}
  ];
  let busy=false,loaded=false,page="system",dirty=false,pages=[],searchOpen=null;
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
      if(active)button.closest("details").open=true;
    }
    for(const section of $("promptEditorBlocks").children)section.hidden=section.dataset.page!==next;
    $("promptPageTitle").textContent=pages.find(item=>item.id===next)?.label||"系统提示词";
    dialog.querySelector(".prompt-page-content").scrollTop=0;
    $("promptCategoryHelp").textContent=next==="system"
      ?"全部非工具的固定提示文本，包括记忆上下文前缀。原文完整显示，换行和空格原样保存；动态历史、笔记和检索结果是数据，不是提示词模板。"
      :"短用途帮助模型选择工具，详细提示词说明调用规则；Before hook 属于当前工具。分组仅按主要用途，节点读取结果仍可能包含当前 Build 的分配或距离。修改文字不会改变参数或权限。";
  }
  function filterNavigation(){
    const terms=$("promptPageSearch").value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const details=[...$("promptPageNav").querySelectorAll("details")];
    if(terms.length&&!searchOpen)searchOpen=new Map(details.map(group=>[group.dataset.group,group.open]));
    let count=0;
    for(const item of pages){
      const sections=[...$("promptEditorBlocks").children].filter(section=>section.dataset.page===item.id);
      const haystack=[item.id,item.label,item.groupLabel,...sections.flatMap(section=>[section.textContent,section.querySelector("textarea").value])].join("\n").toLocaleLowerCase();
      const match=terms.every(term=>haystack.includes(term));
      item.button.hidden=!match;
      for(const link of item.hookLinks)link.hidden=!match;
      if(match)count++;
    }
    for(const group of details){
      group.hidden=![...group.querySelectorAll("button[data-page]")].some(button=>!button.hidden);
      if(terms.length)group.open=true;
      else if(searchOpen)group.open=searchOpen.get(group.dataset.group)??true;
    }
    if(!terms.length&&searchOpen){
      // A page selected from search stays discoverable after restoring the groups.
      const current=pages.find(item=>item.id===page);
      if(current)current.button.closest("details").open=true;
      searchOpen=null;
    }
    $("clearPromptSearch").disabled=!$("promptPageSearch").value;
    $("promptSearchStatus").textContent=terms.length
      ?(count?`找到 ${count} 个页面 · 右侧保留当前草稿` : "没有匹配页面 · 右侧草稿保留")
      :`${pages.length} 个页面 · 按主要用途分组`;
  }
  function renderNavigation(prompt){
    const expanded=searchOpen||new Map([...$("promptPageNav").querySelectorAll("details")].map(group=>[group.dataset.group,group.open]));
    searchOpen=null;
    // Unknown future tools remain reachable, rather than disappearing silently.
    const assigned=new Set(groups.flatMap(group=>group.tools));
    const navigation=[...groups,{id:"other",label:"其他工具",tools:pages.filter(item=>!assigned.has(item.id)).map(item=>item.id)}];
    $("promptPageNav").replaceChildren(...navigation.filter(group=>pages.some(item=>group.tools.includes(item.id))).map(group=>{
      const details=document.createElement("details"),summary=document.createElement("summary"),children=document.createElement("div");
      details.dataset.group=group.id;details.open=expanded.get(group.id)??group.tools.includes(page);
      summary.textContent=group.label;children.className="prompt-group-pages";
      for(const id of group.tools){
        const item=pages.find(candidate=>candidate.id===id);if(!item)continue;
        const button=document.createElement("button");button.type="button";button.dataset.page=id;button.textContent=item.label;
        const hint=document.createElement("small");hint.textContent=id==="system"?"固定规则与上下文模板":id.slice(5);button.append(hint);
        button.addEventListener("click",()=>selectPage(id));children.append(button);
        item.button=button;item.groupLabel=group.label;item.hookLinks=[];
        for(const block of prompt.blocks.filter(block=>block.id.startsWith("hook_")&&block.page===id)){
          const link=document.createElement("a");link.href=`#prompt-block-${block.id}`;link.textContent=`↳ ${block.label}`;
          link.dataset.hook=block.id;link.className="prompt-hook-link";link.title=block.label;
          link.addEventListener("click",event=>{event.preventDefault();selectPage(id);const field=$(`prompt-block-${block.id}`);field.scrollIntoView({block:"center"});field.focus({preventScroll:true});});
          children.append(link);item.hookLinks.push(link);
        }
      }
      details.append(summary,children);return details;
    }));
  }
  function render(prompt){
    if(!Array.isArray(prompt?.blocks)||!prompt.blocks.length||prompt.blocks.some(b=>!b||!["system","tool"].includes(b.category)||typeof b.text!=="string"))throw Error("提示词块读取失败");
    const enabled=new Set(prompt.sections.map(block=>block.id));
    pages=[{id:"system",label:"系统提示词"},...prompt.blocks.filter(block=>block.category==="tool"&&!block.page).map(block=>({id:block.id,label:block.label}))];
    const byId=new Map(prompt.blocks.map(block=>[block.id,block]));
    const ordered=prompt.blocks.filter(block=>!block.id.startsWith("purpose_")).flatMap(block=>
      block.id.startsWith("tool_")?[byId.get(`purpose_${block.id.slice(5)}`),block].filter(Boolean):[block]);
    $("promptEditorBlocks").replaceChildren(...ordered.map(block=>{
      const section=document.createElement("section"),label=document.createElement("label"),field=document.createElement("textarea"),help=document.createElement("p");
      section.dataset.page=block.category==="system"?"system":(block.page||block.id);
      field.id=`prompt-block-${block.id}`;field.dataset.block=block.id;field.value=block.text;field.rows=block.id.startsWith("purpose_")?2:6;field.spellcheck=false;
      field.addEventListener("input",()=>{dirty=true;status.textContent="有未保存修改；搜索、折叠与切换页面会保留草稿，请点击保存全部修改。";if($("promptPageSearch").value)filterNavigation();});
      if(block.id.startsWith("hook_"))section.className="prompt-hook-block";
      label.htmlFor=field.id;label.textContent=`${block.label} · ${block.id}${block.category==="system"&&block.id!=="memory_prefix"?` · ${enabled.has(block.id)?"当前启用":"当前未启用"}`:""}${block.custom?" · 已自定义":" · 默认"}`;
      help.className="agent-help";help.textContent=block.usage+(block.id.startsWith("purpose_")?"。最多 120 字符。":"。每块最多 4000 字符。");
      section.append(label,help,field);return section;
    }));
    renderNavigation(prompt);loaded=true;dirty=false;selectPage(page);filterNavigation();
    status.textContent=prompt.storageError||`${prompt.version} · 系统 ${prompt.blocks.filter(b=>b.category==="system").length} 块 / 工具 ${prompt.blocks.filter(b=>b.id.startsWith("tool_")).length} 个（各有简短说明与详细提示词）。保存后用于后续请求。`;
  }
  async function perform(action,success=""){
    if(busy)return;busy=true;controls();
    try{const result=await action();if(!result?.ok)throw Error(result?.error?.message||"操作失败，请重试");render(result.prompt);if(success)status.textContent+=" "+success;}
    catch(error){status.textContent=error.message;}
    finally{busy=false;controls();}
  }
  $("openPromptEditor").addEventListener("click",()=>{
    loaded=false;dirty=false;page="system";pages=[];searchOpen=null;$("promptPageSearch").value="";$("promptSearchStatus").textContent="";$("clearPromptSearch").disabled=true;$("promptEditorBlocks").replaceChildren();$("promptPageNav").replaceChildren();status.textContent="正在读取全部提示词…";dialog.showModal();dialog.querySelector(".prompt-page-content").scrollTop=0;
    perform(()=>window.desktopAPI?.agent?.inspectPrompt());
  });
  $("promptPageSearch").addEventListener("input",filterNavigation);
  function clearSearch(){ $("promptPageSearch").value="";filterNavigation();$("promptPageSearch").focus(); }
  $("clearPromptSearch").addEventListener("click",clearSearch);
  $("promptPageSearch").addEventListener("keydown",event=>{if(event.key==="Escape"&&$("promptPageSearch").value){event.preventDefault();event.stopPropagation();clearSearch();}});
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
