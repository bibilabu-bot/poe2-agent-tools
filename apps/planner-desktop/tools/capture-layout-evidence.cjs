const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const endpoint = process.env.P2AT_CDP || "http://127.0.0.1:9222";
const output = path.resolve(__dirname, "../../../docs/assets/screenshots/p2at-023a");
let serial = 0;
const pending = new Map();

async function main() {
  const pages = await fetch(`${endpoint}/json/list`).then(response => response.json());
  const expectedUrl = pathToFileURL(path.resolve(__dirname, "../renderer/index.html")).href;
  const matches = pages.filter(item => item.type === "page" && item.url === expectedUrl);
  if (matches.length !== 1) throw new Error(`Expected exactly one P2AT-023A Planner page at ${expectedUrl}; found ${matches.length}`);
  const page = matches[0];
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  await fs.mkdir(output, { recursive: true });

  async function resize(width, height) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await wait(350);
  }
  async function shot(name) {
    const result = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, fromSurface: true });
    await fs.writeFile(path.join(output, name), Buffer.from(result.data, "base64"));
  }
  async function click(selector) {
    const ok = await evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el) return false; el.click(); return true; })()`);
    if (!ok) throw new Error(`Missing element: ${selector}`);
    await wait(180);
  }

  await send("Page.enable");
  await send("Page.navigate", { url: `${expectedUrl}?layout-evidence` });
  await wait(1200);
  await evaluate(`new Promise(resolve => {
    const done=()=>resolve({status:document.querySelector('#status')?.textContent});
    if(document.querySelector('#classSelect') && !document.querySelector('#classSelect').disabled) done();
    else setTimeout(done, 8000);
  })`);
  const shell = await evaluate(`(() => {
    const ids=['importWeGame','openBuild','saveBuild','undo','redo','fit','zin','zout','classSelect','budget','search','langSelect','statSummary'];
    return {
      mounted:document.querySelector('.content')?.dataset.layoutMounted,
      modules:[...document.querySelectorAll('[data-panel-target]')].map(el=>el.dataset.panelTarget),
      uniqueControls:ids.every(id=>document.querySelectorAll('#'+id).length===1),
      repeatMount:window.plannerLayoutShell.mount(document)===null
    };
  })()`);
  if (shell.mounted !== "true" || shell.modules.join(",") !== "class,allocation,search,display,stats" || !shell.uniqueControls || !shell.repeatMount) {
    throw new Error(`Layout shell integrity check failed: ${JSON.stringify(shell)}`);
  }

  const checks = [];
  const sizes = (process.env.P2AT_LAYOUT_SIZES || "1366x768,1920x1080").split(",").map(value => value.split("x").map(Number));
  for (const [width, height] of sizes) {
    await resize(width, height);
    await evaluate(`(() => { const content=document.querySelector('.content'); if(content.classList.contains('panel-open')) document.querySelector('.tool-trigger.active')?.click(); return content.className; })()`);
    await wait(500);
    if (await evaluate(`document.querySelector('.content').classList.contains('panel-open')`)) {
      await evaluate(`document.querySelector('.tool-trigger.active')?.click()`);
      await wait(500);
    }
    const collapsed = await evaluate(`(() => {
      window.dispatchEvent(new Event('resize'));
      const content=document.querySelector('.content').getBoundingClientRect();
      const stage=document.querySelector('#stage').getBoundingClientRect();
      const canvas=document.querySelector('#treeCanvas');
      return {viewport:[innerWidth,innerHeight],ratio:stage.width/content.width,css:[canvas.clientWidth,canvas.clientHeight],backing:[canvas.width,canvas.height],dpr:devicePixelRatio};
    })()`);
    checks.push({ size: `${width}x${height}`, collapsed });
    if (collapsed.ratio < .9) throw new Error(`Canvas width ratio ${collapsed.ratio} is below 90% at ${width}x${height}`);
    const backingScaleX = collapsed.backing[0] / collapsed.css[0];
    const backingScaleY = collapsed.backing[1] / collapsed.css[1];
    const expectedScale = Math.min(2, collapsed.dpr);
    if (Math.abs(backingScaleX - expectedScale) > .02 || Math.abs(backingScaleY - expectedScale) > .02) throw new Error(`Canvas backing size does not match DPR: ${JSON.stringify(collapsed)}`);
    await shot(`${width}x${height}-collapsed.png`);
    await click('[data-panel-target="display"]');
    if (!await evaluate(`document.querySelector('.content').classList.contains('panel-open') && document.querySelector('[data-panel="display"]')?.hidden === false`)) {
      await click('[data-panel-target="display"]');
    }
    await wait(400);
    const expanded = await evaluate(`(() => ({
      active:[...document.querySelectorAll('[data-panel-target][aria-expanded="true"]')].map(el=>el.dataset.panelTarget),
      visible:[...document.querySelectorAll('.tool-panel:not([hidden])')].map(el=>el.dataset.panel),
      canvasElementAtCenter:document.elementFromPoint(innerWidth*.7,innerHeight*.55)?.id==='treeCanvas'
    }))()`);
    if (expanded.active.join(",") !== "display" || expanded.visible.join(",") !== "display" || !expanded.canvasElementAtCenter) {
      throw new Error(`Expanded panel state is invalid: ${JSON.stringify(expanded)}`);
    }
    await shot(`${width}x${height}-display-open.png`);
  }

  if (process.env.P2AT_SHOTS_ONLY === "1") {
    socket.close();
    console.log(JSON.stringify({ checks }, null, 2));
    process.exit(0);
  }

  await send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 768, deviceScaleFactor: 2, mobile: false });
  await wait(350);
  await evaluate(`window.dispatchEvent(new Event('resize'))`);
  const hidpi = await evaluate(`(() => {
    const canvas=document.querySelector('#treeCanvas');
    return {dpr:devicePixelRatio,css:[canvas.clientWidth,canvas.clientHeight],backing:[canvas.width,canvas.height]};
  })()`);
  if (hidpi.dpr !== 2 || hidpi.backing[0] !== hidpi.css[0]*2 || hidpi.backing[1] !== hidpi.css[1]*2) throw new Error(`High-DPI backing check failed: ${JSON.stringify(hidpi)}`);

  await evaluate(`(() => {
    const name=window.plannerLayoutEvidence?.firstClassName();
    if(!name) throw new Error('No class available for hit-test evidence');
    const select=document.querySelector('#classSelect');
    select.value=name;
    select.dispatchEvent(new Event('change',{bubbles:true}));
    document.querySelector('#fit').click();
  })()`);
  await wait(350);
  if (await evaluate(`document.querySelector('.content').classList.contains('panel-open')`)) {
    await evaluate(`document.querySelector('.tool-trigger.active')?.click()`);
    await wait(400);
  }
  async function clickNextNode() {
    const point = await evaluate(`window.plannerLayoutEvidence?.nextAllocatablePoint()`);
    if (!point) throw new Error("No visible allocatable node found for hit-test evidence");
    const before = await evaluate(`window.plannerLayoutEvidence.allocationCount()`);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.clientX, y: point.clientY, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.clientX, y: point.clientY, button: "left", clickCount: 1 });
    await wait(250);
    const after = await evaluate(`window.plannerLayoutEvidence.allocationCount()`);
    if (after <= before) throw new Error(`Node hit did not allocate at ${JSON.stringify(point)} (${before} -> ${after})`);
    return { point, before, after };
  }
  const collapsedHit = await clickNextNode();
  await click('[data-panel-target="display"]');
  const expandedHit = await clickNextNode();

  const result = await evaluate(`(() => {
    const trigger=id=>document.querySelector('[data-panel-target="'+id+'"]');
    const pointsBefore=document.querySelector('#pointsUsed').textContent;
    trigger('search').click();
    document.querySelector('#search').value='Projectile';
    trigger('allocation').click();
    trigger('search').click();
    const search=document.querySelector('#search').value;
    trigger('display').click();
    document.querySelector('#zin').click();
    trigger('class').click();
    document.querySelector('#importWeGame').click();
    const dialogOpened=document.querySelector('#weGameDialog').open;
    document.querySelector('#weGameCancel').click();
    return {
      dialogOpened,
      dialogClosed:!document.querySelector('#weGameDialog').open,
      openEnabled:!document.querySelector('#openBuild').disabled,
      saveEnabled:!document.querySelector('#saveBuild').disabled,
      selectedCount:document.querySelector('#count').textContent,
      search,
      pointsPreserved:pointsBefore===document.querySelector('#pointsUsed').textContent,
      oneExpanded:document.querySelectorAll('[data-panel-target][aria-expanded="true"]').length===1
    };
  })()`);
  if (result.search !== "Projectile") throw new Error("Search state was lost while switching panels");
  if (!result.dialogOpened || !result.dialogClosed) throw new Error("WeGame dialog open/cancel interaction failed");
  if (!result.openEnabled || !result.saveEnabled || !result.pointsPreserved || !result.oneExpanded) throw new Error(`Core control/state assertion failed: ${JSON.stringify(result)}`);
  socket.close();
  console.log(JSON.stringify({ checks, hidpi, collapsedHit, expandedHit, ...result }, null, 2));
  process.exit(0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
