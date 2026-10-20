"use strict";
// Ordinary Chromium/Edge, isolated context; only canonical public files and sanitized fixtures.
// Install playwright-core outside the checkout and expose it through NODE_PATH.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { chromium } = require("playwright-core");
const { createPlannerServer } = require("../../planner-browser/server.cjs");

async function main() {
  const cache = process.env.P2AT_GAME_CACHE;
  assert.ok(cache, "Set P2AT_GAME_CACHE to isolated canonical public game-data directory");
  const core = path.join(cache, "core");
  const output = process.env.P2AT_BROWSER_EVIDENCE || fs.mkdtempSync(path.join(os.tmpdir(), "p2at-browser-evidence-"));
  fs.mkdirSync(output, { recursive: true });
  const token = crypto.randomBytes(32).toString("hex");
  const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../fixtures/wegame-share/public-share.sanitized.json")));
  Object.assign(fixture.roleInfo.role, { openid: "synthetic-open", role_id: "synthetic-role" });
  fixture.talentTree.talent_tree.hashes.push(14265);
  let upstreamFails = false;
  const app = await createPlannerServer({
    port: 0, token, officialTreePath: path.join(core, "official-data.json"),
    fetch: async url => {
      if (upstreamFails) throw new Error("SYNTHETIC_PRIVATE_FAILURE");
      assert.match(url, /^https:\/\/www\.wegame\.com\.cn\/api\/v1\/wegame\.pallas\.poe2\.Profile\/(GetRoleInfo|GetTalentTree)$/);
      return new Response(JSON.stringify(url.endsWith("GetRoleInfo") ? fixture.roleInfo : fixture.talentTree),
        { headers: { "content-type": "application/json" } });
    },
  });
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.P2AT_BROWSER_EXECUTABLE, channel: process.env.P2AT_BROWSER_EXECUTABLE ? undefined : "msedge", headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
    const page = await context.newPage();
    const pageErrors = [];
    const requests = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    page.on("request", request => requests.push({ url: request.url(), method: request.method() }));
    await page.route("**/*", route => {
      const url = route.request().url();
      return url.startsWith(app.origin + "/") || url.startsWith("blob:") ? route.continue() : route.abort();
    });
    await page.goto(app.origin);
    await page.locator("#browserResourceFiles").waitFor();
    await page.waitForFunction(() => !document.querySelector("#browserResourceFiles").disabled);
    await page.screenshot({ path: path.join(output, "01-resource-selection.png") });
    const names = fs.readdirSync(core);
    const resources = names.map(name => path.join(core, name));
    await page.locator("#browserResourceFiles").setInputFiles(resources.filter(file => !file.endsWith("official-data.json")));
    await page.waitForFunction(() => document.querySelector("#browserResourceStatus").textContent.includes("缺少资源"));
    assert.equal(await page.evaluate(() => plannerDataReady), false);
    // Same-size corruption exercises hash rejection rather than just byte-count rejection.
    const corrupt = resources.map(file => ({ name: path.basename(file), mimeType: "application/octet-stream", buffer: fs.readFileSync(file) }));
    corrupt.find(file => file.name === "tree-jump.json").buffer[0] ^= 1;
    await page.locator("#browserResourceFiles").setInputFiles(corrupt);
    await page.waitForFunction(() => document.querySelector("#browserResourceStatus").textContent.includes("哈希错误"));
    assert.equal(await page.evaluate(() => plannerDataReady), false);
    await page.locator("#browserResourceFiles").setInputFiles(resources);
    await page.waitForFunction(() => plannerDataReady, null, { timeout: 30000 });
    assert.equal(await page.evaluate(() => typeof window.require), "undefined");
    assert.equal(await page.locator("#switchToAgent").isDisabled(), true);
    if (!(await page.locator("#classSelect").isVisible())) await page.locator("#tool-trigger-class").click();
    await page.locator("#classSelect").selectOption("Mercenary");
    // Find a reachable node, use actual canvas pointer events for allocation/refund.
    const target = await page.evaluate(() => {
      const n = nodes.find(node => {
        if (allocated.has(idOf(node)) || isAsc(node) || !canTraverse(node) || isHiddenConditional(node)) return false;
        const route = pathFromActiveSet(idOf(node), "general");
        return route.length === 2;
      });
      if (!n) throw new Error("No reachable normal node");
      return idOf(n);
    });
    await page.locator("#tool-trigger-search").click();
    await page.waitForTimeout(250); // Allow the existing sidebar CSS transition and ResizeObserver to settle.
    await page.locator("#searchMode").selectOption("id");
    await page.locator("#search").fill(target);
    await page.locator("#find").click();
    assert.equal(await page.evaluate(id => searchMatches.some(n => idOf(n) === id), target), true);
    await page.locator("#tool-trigger-search").click();
    await page.waitForTimeout(300);
    await page.evaluate(id => focusNode(byId.get(id), 0.7), target);
    await page.waitForFunction(() => !rafPending);
    const point = await page.evaluate(() => { const rect = canvas.getBoundingClientRect(); return { x: rect.left + W / 2, y: rect.top + H / 2 }; });
    await page.mouse.move(point.x, point.y);
    await page.mouse.click(point.x, point.y);
    assert.equal(await page.evaluate(id => allocated.has(id), target), true, JSON.stringify(await page.evaluate(({id,point}) => ({target:id,near:idOf(nearestNode(W/2,H/2)), element:document.elementFromPoint(point.x,point.y)?.id, W,H,rect:canvas.getBoundingClientRect().toJSON(), message:document.querySelector("#plannerMsg").textContent, alloc:[...allocated]}),{id:target,point})));
    await page.mouse.click(point.x, point.y);
    assert.equal(await page.evaluate(id => allocated.has(id), target), false);
    await page.mouse.click(point.x, point.y);
    await page.screenshot({ path: path.join(output, "02-tree-allocation.png") });
    await page.locator("#tool-trigger-class").click();
    const beforeSave = await page.evaluate(() => buildCodec.serializeBuildDocument(buildStateAdapter.extractBuildValue(currentBuildRuntimeState()), buildPreservation));
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#saveBuild").click();
    const download = await downloadPromise;
    const buildPath = path.join(output, "synthetic-roundtrip.build");
    await download.saveAs(buildPath);
    assert.equal(fs.readFileSync(buildPath, "utf8"), beforeSave);
    await page.locator("#classSelect").selectOption("Witch");
    const chooserPromise = page.waitForEvent("filechooser");
    await page.locator("#openBuild").click();
    await (await chooserPromise).setFiles(buildPath);
    await page.waitForFunction(() => document.querySelector("#buildFeedbackSummary").textContent.includes("Build 已成功打开"));
    const restored = await page.evaluate(() => buildCodec.serializeBuildDocument(buildStateAdapter.extractBuildValue(currentBuildRuntimeState()), buildPreservation));
    assert.deepEqual(JSON.parse(restored), JSON.parse(beforeSave));
    assert.equal(requests.filter(request => request.method === "POST").length, 0, "Local resource and Build bytes must not be uploaded");
    await page.locator("#browserLogin").click();
    await page.locator("#browserLoginDialog input").fill(token);
    await page.locator("#browserLoginDialog button[type=submit]").click();
    await page.waitForFunction(() => !document.querySelector("#browserLoginDialog").open);
    await page.locator("#importWeGame").click();
    await page.locator("#weGameUrl").fill("https://www.wegame.com.cn/helper/poe2/#/share/Synthetic123");
    await page.locator("#weGameRead").click();
    await page.waitForFunction(() => !document.querySelector("#weGamePreview").hidden);
    assert.match(await page.locator("#weGameOmissionList").textContent(), /14265/);
    assert.match(await page.locator("#weGameSemanticPreview").textContent(), /簇/);
    const state = () => page.evaluate(() => JSON.stringify(captureBuildTransactionState(), (_key, value) => value instanceof Set ? [...value] : value));
    const beforeImport = await state();
    for (const [id, message] of [["weGameReplaceAck", "请明确确认覆盖"], ["weGamePartialAck", "请勾选实验性部分导入"], ["weGameOmissionAck", "存在将被省略"]]) {
      await page.locator("#weGameApply").click();
      await page.waitForFunction(() => !weGameApplyBusy);
      assert.match(await page.locator("#weGameActionStatus").textContent(), new RegExp(message));
      assert.equal(await state(), beforeImport);
      await page.locator("#" + id).check();
    }
    await page.screenshot({ path: path.join(output, "03-wegame-confirmation.png") });
    await page.locator("#weGameApply").click();
    await page.waitForFunction(() => !document.querySelector("#weGameDialog").open);
    assert.equal(await page.evaluate(() => allocated.has("14265")), false);
    const afterImport = await state();
    assert.notEqual(afterImport, beforeImport);
    upstreamFails = true;
    await page.locator("#importWeGame").click();
    await page.locator("#weGameRead").click();
    await page.waitForFunction(() => document.querySelector("#weGameStatus").textContent.includes("WeGame could not be reached"));
    assert.equal(await state(), afterImport);
    assert.equal((await page.locator("body").textContent()).includes("SYNTHETIC_PRIVATE_FAILURE"), false);
    await page.locator("#weGameCancel").click();
    await page.locator("#tool-trigger-display").click();
    await page.locator("#fit").click();
    await page.locator("#tool-trigger-display").click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(output, "04-browser-overview.png") });
    await page.setViewportSize({ width: 900, height: 768 });
    await page.waitForTimeout(300);
    const navFits = await page.locator("#switchToAgent").evaluate(button => button.scrollWidth <= button.clientWidth && button.getBoundingClientRect().right <= innerWidth);
    assert.equal(navFits, true, "Unavailable navigation labels must remain readable");
    await page.screenshot({ path: path.join(output, "05-browser-narrow.png") });
    assert.deepEqual(pageErrors, []);
    console.log("PASS ordinary browser: resource rejection/retry, tree/search/path/canvas allocation/refund, local Build roundtrip, WeGame authentication/preview/clusters/omission gates/import/failure preservation.");
    console.log("Evidence directory:", output);
  } finally {
    if (browser) await browser.close();
    await app.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
