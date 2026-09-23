const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('allocation honors explicit weapon category without changing UI mode or general nodes',()=>{
  const source=fs.readFileSync(require.resolve('../renderer/planner.js'),'utf8');
  const fn=source.slice(source.indexOf('function allocateNodeById('),source.indexOf('function _allocateAscById('));
  const ctx={byId:new Map([['42',{}],['start',{}]]),isMasteryVisual:()=>false,isInstillExclusiveNode:()=>false,
    isAsc:()=>false,allocated:new Set(['start']),classStartId:'start',weaponMode:'general',
    weaponSet1Allocated:new Set(),weaponSet2Allocated:new Set(),hiddenNodeLocked:()=>false,
    weaponSetEligible:()=>true,weaponSetLabel:m=>m,maxWeaponPoints:24,maxPoints:123,usedPoints:()=>0,
    pathFromActiveSet:()=>['start','42'],pushUndo:()=>{},clearPreviews:()=>{},updatePlannerUI:()=>{}};
  ctx.weaponSetForMode=m=>m==='ws1'?ctx.weaponSet1Allocated:ctx.weaponSet2Allocated;
  ctx.activeIdsForMode=m=>new Set([...ctx.allocated,...ctx.weaponSetForMode(m)]);
  vm.createContext(ctx);vm.runInContext(fn,ctx);
  assert.equal(ctx.allocateNodeById('42','weaponSet1').category,'weaponSet1');
  assert.equal(ctx.weaponSet1Allocated.has('42'),true);
  assert.equal(ctx.weaponSet2Allocated.has('42'),false);
  assert.equal(ctx.allocated.has('42'),false);
  assert.equal(ctx.allocateNodeById('42','weaponSet2').category,'weaponSet2');
  assert.equal(ctx.weaponSet2Allocated.has('42'),true);
  assert.equal(ctx.weaponMode,'general');
  assert.equal(ctx.allocateNodeById('42','invalid').errorCode,'INVALID_CATEGORY');
  assert.equal(ctx.allocateNodeById('42','ascendancy').errorCode,'CATEGORY_MISMATCH');
});
test('overlapping weapon nodes require a category and honor the requested set',()=>{
  const source=fs.readFileSync(require.resolve('../renderer/planner.js'),'utf8');
  const fn=source.slice(source.indexOf('function deallocateNodeById('),source.indexOf('function _deallocateGeneralById('));
  const ctx={byId:new Map([['42',{}]]),isMasteryVisual:()=>false,isInstillExclusiveNode:()=>false,isAsc:()=>false,allocated:new Set(),weaponMode:'ws2',weaponSet1Allocated:new Set(['42']),weaponSet2Allocated:new Set(['42']),_deallocateWeaponById:(id,mode)=>({id,mode})};
  vm.createContext(ctx);vm.runInContext(fn,ctx);
  assert.equal(ctx.deallocateNodeById('42').errorCode,'AMBIGUOUS_CATEGORY');
  assert.equal(ctx.deallocateNodeById('42','weaponSet2').mode,'ws2');
  assert.equal(ctx.deallocateNodeById('42','weaponSet1').mode,'ws1');
});
