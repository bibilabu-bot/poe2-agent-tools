"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { editMenuTemplate, installEditContextMenu } = require("../electron/edit-context-menu.cjs");
test("editable fields get native paste; password copy and cut stay disabled", () => {
  const flags = { canPaste:true, canCopy:true, canCut:true, canSelectAll:true };
  const menu = editMenuTemplate({ isEditable:true, inputFieldType:"password", editFlags:flags });
  assert.equal(menu.find(i=>i.role === "paste").enabled,true);
  assert.equal(menu.find(i=>i.role === "copy").enabled,false);
  assert.equal(menu.find(i=>i.role === "cut").enabled,false);
  assert.deepEqual(editMenuTemplate({isEditable:false}),[]);
  assert.equal(editMenuTemplate({isEditable:true}).find(i=>i.role === "paste").enabled,false);
});
test("context menu targets the originating window and uses native roles", () => {
  let handler, shown = 0;
  const window = { webContents:{on:(name,fn)=>{assert.equal(name,"context-menu");handler=fn;}} };
  installEditContextMenu(window,{buildFromTemplate:items=>{
    assert.ok(items.some(i=>i.role === "paste"));
    assert.ok(items.every(i=>!i.click));
    return {popup:options=>{assert.equal(options.window,window);shown++;}};
  }});
  handler(null,{isEditable:false}); assert.equal(shown,0);
  handler(null,{isEditable:true,editFlags:{canPaste:true}}); assert.equal(shown,1);
});
