"use strict";

function editMenuTemplate(params) {
  if (!params.isEditable) return [];
  const flags = params.editFlags || {};
  const password = params.inputFieldType === "password";
  return [
    { label: "撤销", role: "undo", enabled: Boolean(flags.canUndo) },
    { label: "重做", role: "redo", enabled: Boolean(flags.canRedo) },
    { type: "separator" },
    { label: "剪切", role: "cut", enabled: !password && Boolean(flags.canCut) },
    { label: "复制", role: "copy", enabled: !password && Boolean(flags.canCopy) },
    { label: "粘贴", role: "paste", enabled: Boolean(flags.canPaste) },
    { type: "separator" },
    { label: "全选", role: "selectAll", enabled: Boolean(flags.canSelectAll) }
  ];
}

function installEditContextMenu(window, Menu) {
  window.webContents.on("context-menu", (_event, params) => {
    const template = editMenuTemplate(params);
    if (template.length) Menu.buildFromTemplate(template).popup({ window });
  });
}
module.exports = { editMenuTemplate, installEditContextMenu };
