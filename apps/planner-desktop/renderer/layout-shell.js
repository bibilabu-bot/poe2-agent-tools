(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.plannerLayoutShell = api;
    root.addEventListener("DOMContentLoaded", () => api.mount(root.document));
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  function nextOpenPanel(current, requested) {
    return current === requested ? null : requested;
  }

  function canCloseWithEscape({ dialogOpen = false, editing = false } = {}) {
    return !dialogOpen && !editing;
  }

  const definitions = [
    { id: "class", label: "Build", hint: "Build 与职业", icon: "BD" },
    { id: "allocation", label: "分配", hint: "点数与分配", icon: "点" },
    { id: "search", label: "搜索", hint: "搜索与节点", icon: "搜" },
    { id: "display", label: "显示", hint: "显示与设置", icon: "显" },
    { id: "stats", label: "统计", hint: "属性与详情", icon: "统" },
  ];

  function move(target, nodes) {
    nodes.filter(Boolean).forEach(node => target.appendChild(node));
  }

  function mount(document) {
    const content = document.querySelector(".content");
    const sidebar = document.querySelector(".sidebar");
    const stage = document.querySelector("#stage");
    if (!content || !sidebar || !stage || content.dataset.layoutMounted) return null;
    content.dataset.layoutMounted = "true";

    const originalSections = Array.from(sidebar.querySelectorAll(":scope > .section"));
    const build = originalSections[0];
    const toolbar = document.querySelector(".toolbar");
    const classPanel = document.createElement("section");
    const allocationPanel = document.createElement("section");
    const searchPanel = document.createElement("section");
    const displayPanel = document.createElement("section");
    const statsPanel = document.createElement("section");
    const panels = { class: classPanel, allocation: allocationPanel, search: searchPanel, display: displayPanel, stats: statsPanel };

    Object.entries(panels).forEach(([id, panel]) => {
      panel.id = `tool-panel-${id}`;
      panel.className = "tool-panel";
      panel.dataset.panel = id;
      panel.setAttribute("aria-labelledby", `tool-trigger-${id}`);
      panel.hidden = true;
      const heading = document.createElement("div");
      heading.className = "panel-heading";
      heading.innerHTML = `<strong>${definitions.find(item => item.id === id).hint}</strong><button type="button" class="panel-close" aria-label="收起${definitions.find(item => item.id === id).hint}">×</button>`;
      panel.appendChild(heading);
    });

    const classNodes = [
      build.querySelector(".h"), document.querySelector("#buildFeedback"),
      document.querySelector('label[for="classSelect"]'), document.querySelector("#classSelect"), document.querySelector("#classHint"),
      document.querySelector('label[for="ascendancySelect"]'), document.querySelector("#ascendancySelect")?.parentElement,
      document.querySelector("#ascHint"), document.querySelector("#ascHint")?.nextElementSibling,
    ];
    const buildActions = document.createElement("div");
    buildActions.className = "panel-actions panel-actions-primary";
    move(buildActions, [document.querySelector("#importWeGame"), document.querySelector("#openBuild"), document.querySelector("#saveBuild")]);
    classPanel.appendChild(buildActions);
    move(classPanel, classNodes);
    const historyActions = document.createElement("div");
    historyActions.className = "panel-actions";
    move(historyActions, [document.querySelector("#undo"), document.querySelector("#redo")]);
    allocationPanel.appendChild(historyActions);
    move(allocationPanel, Array.from(build.children));
    move(searchPanel, [originalSections[4]]);
    move(displayPanel, [originalSections[1], originalSections[2], originalSections[3], originalSections[7]]);
    const viewActions = document.createElement("div");
    viewActions.className = "panel-actions";
    move(viewActions, [document.querySelector("#fit"), document.querySelector("#zin"), document.querySelector("#zout")]);
    displayPanel.insertBefore(viewActions, displayPanel.children[1] || null);
    move(statsPanel, [originalSections[5], originalSections[6], originalSections[8]]);

    const rail = document.createElement("nav");
    rail.className = "module-nav";
    rail.setAttribute("aria-label", "规划器工具");
    const buttons = new Map();
    definitions.forEach(item => {
      const button = document.createElement("button");
      button.type = "button";
      button.id = `tool-trigger-${item.id}`;
      button.className = "tool-trigger";
      button.dataset.panelTarget = item.id;
      button.setAttribute("aria-controls", `tool-panel-${item.id}`);
      button.setAttribute("aria-expanded", "false");
      button.innerHTML = `<span class="tool-icon" aria-hidden="true">${item.icon}</span><span>${item.label}</span>`;
      rail.appendChild(button);
      buttons.set(item.id, button);
    });

    sidebar.replaceChildren(...Object.values(panels));
    toolbar.replaceChildren(rail);
    let openPanel = null;
    let lastTrigger = null;
    let resizeTimer = 0;

    function notifyResize() {
      window.dispatchEvent(new Event("resize"));
    }

    content.addEventListener("transitionend", event => {
      if (event.target === content && event.propertyName === "grid-template-columns") notifyResize();
    });

    function setPanel(requested, { restoreFocus = false } = {}) {
      const next = requested && panels[requested] ? requested : null;
      openPanel = next;
      content.classList.toggle("panel-open", Boolean(next));
      Object.entries(panels).forEach(([id, panel]) => {
        const active = id === next;
        panel.hidden = !active;
        buttons.get(id).classList.toggle("active", active);
        buttons.get(id).setAttribute("aria-expanded", String(active));
      });
      clearTimeout(resizeTimer);
      requestAnimationFrame(notifyResize);
      resizeTimer = setTimeout(notifyResize, 190);
      if (restoreFocus && lastTrigger) lastTrigger.focus();
    }

    buttons.forEach((button, id) => button.addEventListener("click", () => {
      lastTrigger = button;
      setPanel(nextOpenPanel(openPanel, id));
    }));
    sidebar.querySelectorAll(".panel-close").forEach(button => button.addEventListener("click", () => setPanel(null, { restoreFocus: true })));
    document.addEventListener("keydown", event => {
      if (event.key !== "Escape" || !openPanel) return;
      const dialogOpen = Boolean(document.querySelector("dialog[open]"));
      const editing = Boolean(event.target?.closest?.("input, select, textarea, [contenteditable='true']"));
      if (!canCloseWithEscape({ dialogOpen, editing })) return;
      event.preventDefault();
      setPanel(null, { restoreFocus: true });
    });

    // A fresh planner has no class yet, so expose the one decision needed to begin.
    setPanel(document.querySelector("#classSelect")?.value && document.querySelector("#classSelect").value !== "加载中…" ? null : "class");
    return { setPanel, getOpenPanel: () => openPanel };
  }

  return { nextOpenPanel, canCloseWithEscape, mount };
});
