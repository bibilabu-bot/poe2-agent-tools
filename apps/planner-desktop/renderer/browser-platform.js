(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (!root.desktopAPI && /^https?:$/.test(root.location.protocol)) api.mount(root);
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const MAX_BUILD_BYTES = 5 * 1024 * 1024;
  function validateManifest(manifest) {
    if (!Array.isArray(manifest?.resources) || !manifest.resources.length) throw new Error('资源清单为空。');
    const keys = new Set();
    return manifest.resources.map(item => {
      if (!['data', 'portrait', 'localization'].includes(item.kind) || !/^[a-zA-Z0-9_.-]+$/.test(item.name)
        || !Number.isSafeInteger(item.bytes) || item.bytes <= 0 || item.bytes > 64 * 1024 * 1024
        || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('资源清单格式无效。');
      const key = `poe2://${item.kind}/${item.name}`;
      if (keys.has(key)) throw new Error('资源清单包含重复项。');
      keys.add(key);
      return { ...item, key, required: item.kind === 'data' };
    });
  }
  async function verifyFiles(files, descriptors, crypto) {
    const verified = new Map();
    for (const descriptor of descriptors) {
      const matches = Array.from(files).filter(file => file.name === descriptor.name);
      if (matches.length > 1) throw new Error(`存在同名文件，请仅选择一个：${descriptor.name}`);
      const file = matches[0];
      if (!file) {
        if (descriptor.required) throw new Error(`缺少资源：${descriptor.name}。请选择包含全部核心文件的目录。`);
        continue;
      }
      if (file.size !== descriptor.bytes) throw new Error(`资源大小不符：${descriptor.name}`);
      const bytes = await file.arrayBuffer();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
      if (hash !== descriptor.sha256) throw new Error(`资源哈希错误：${descriptor.name}`);
      // Preserve the verified bytes, never reread a file after checking it.
      verified.set(descriptor.key, new Blob([bytes], { type: descriptor.name.endsWith('.webp') ? 'image/webp' : 'application/octet-stream' }));
    }
    return verified;
  }
  async function readBuildFile(file) {
    if (file.size > MAX_BUILD_BYTES) throw new Error('Build 文件超过 5 MiB 限制。');
    return new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
  }
  function buildFilename(name) {
    return (String(name || 'PoE2-Build').replace(/\.(json|build)$/i, '').replace(/[^\p{L}\p{N}_. -]/gu, '_').slice(0, 100) || 'PoE2-Build') + '.build';
  }
  function serviceErrorMessage(status, result, path) {
    if (status === 401) return path === '/api/login' ? '访问令牌无效，请核对本地服务的启动配置。' : '请先点击“连接 WeGame 服务”并输入本地服务的访问令牌。';
    if (status === 503 && path === '/api/wegame' && result?.error?.code === 'RESOURCE_NOT_FOUND') {
      return 'WeGame 导入尚缺官方节点映射。请将本地服务启动配置 PLANNER_OFFICIAL_TREE 指向已校验的 official-data.json 完整路径，再重新启动本地网页服务；仅在浏览器选择资源不会提供服务器映射。当前 Build 未改变。';
    }
    return '本地服务拒绝请求，请检查服务配置或稍后重试。';
  }
  function disableUnsupportedControls(doc) {
    doc.querySelectorAll('#switchToAgent, [data-page="agent"], [data-page="settings"]').forEach(button => {
      button.disabled = true;
      button.textContent = button.id === 'switchToAgent' || button.dataset.page === 'agent' ? '智能体\n暂未启用' : '模型设置\n暂未启用';
      button.style.cssText = 'white-space:pre-line;height:44px;min-height:44px;padding:4px;line-height:16px;opacity:1;color:#94918b;cursor:not-allowed';
      button.title = '浏览器第一阶段尚未启用智能体和模型设置。';
    });
    doc.querySelectorAll('#agentView button, #agentView input, #agentView select, #agentView textarea, #settingsView button, #settingsView input, #settingsView select, #promptEditor button, #promptEditor input, #promptEditor textarea').forEach(control => { control.disabled = true; });
  }
  function mount(win) {
    const doc = win.document, urls = new Map();
    let resolveReady;
    const ready = new Promise(resolve => { resolveReady = resolve; });
    const resourceURL = key => {
      if (!urls.has(key)) throw new Error(`未选择已验证资源：${key.split('/').pop()}`);
      return urls.get(key);
    };
    const disableUnsupported = () => disableUnsupportedControls(doc);
    win.browserPlatform = Object.freeze({ ready, resourceURL, fetchResource: async (key, options) => win.fetch(resourceURL(key), options), disableUnsupported });
    function pickBuild() {
      return new Promise(resolve => {
        const input = doc.createElement('input'); input.type = 'file'; input.accept = '.build,.json'; input.hidden = true;
        const finish = result => { input.remove(); resolve(result); };
        input.addEventListener('cancel', () => finish({ canceled: true }), { once: true });
        input.addEventListener('change', async () => {
          if (!input.files[0]) return finish({ canceled: true });
          try { finish({ ok: true, text: await readBuildFile(input.files[0]) }); }
          catch (error) { finish({ ok: false, error: { message: error.message } }); }
        }, { once: true });
        doc.body.append(input); input.click();
      });
    }
    async function apiPost(path, body) {
      const response = await win.fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) {
        // Only known status/code pairs select locally authored instructions.
        // Never display an arbitrary server exception or response body.
        let result = null;
        if (response.status === 503 && path === '/api/wegame') {
          try { result = await response.json(); } catch { /* Generic safe error below. */ }
        }
        throw new Error(serviceErrorMessage(response.status, result, path));
      }
      return response.json();
    }
    win.desktopAPI = Object.freeze({
      openBuildJson: pickBuild,
      saveBuildJson: async ({ text, suggestedName }) => {
        if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_BUILD_BYTES) throw new Error('Build 文件无效或超过 5 MiB 限制。');
        const blobURL = win.URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const anchor = doc.createElement('a'); anchor.href = blobURL; anchor.download = buildFilename(suggestedName);
        doc.body.append(anchor); anchor.click(); anchor.remove(); win.setTimeout(() => win.URL.revokeObjectURL(blobURL), 60000);
        return { ok: true, downloaded: true, filePath: anchor.download };
      },
      importWeGamePassives: async url => {
        try { return await apiPost('/api/wegame', { url }); }
        catch (error) { return { ok: false, error: { message: error.message } }; }
      },
    });
    const panel = doc.createElement('dialog'); panel.id = 'browserResources';
    panel.innerHTML = '<h2>选择本地天赋树资源</h2><p>首次打开请选择已有 game-data/core 目录（也可选择上级目录或多个文件）。核心文件须与固定版本一致，校验通过后仅在本页内存中使用，不上传服务器。</p><p>职业背景图为可选资源；未选择时使用基础背景。刷新页面后需重新选择。智能体和模型设置暂未启用。</p><label>选择目录 <input id="browserResourceDirectory" type="file" webkitdirectory multiple></label><br><label>选择文件 <input id="browserResourceFiles" type="file" multiple></label><p id="browserResourceStatus" role="status">正在读取资源清单…</p><details><summary>所需文件与版本校验信息</summary><pre id="browserResourceList"></pre></details>';
    panel.style.cssText = 'color:#eee9df;background:#17191d;border:1px solid #e0b768;border-radius:12px;max-width:700px;max-height:85vh;overflow:auto;padding:24px;line-height:1.7';
    panel.addEventListener('cancel', event => event.preventDefault());
    doc.body.append(panel); panel.showModal();
    const status = panel.querySelector('#browserResourceStatus');
    const inputs = Array.from(panel.querySelectorAll('input')); inputs.forEach(input => { input.disabled = true; });
    win.fetch('/api/resource-manifest', { credentials: 'same-origin' }).then(response => {
      if (!response.ok) throw new Error('无法读取本地资源清单，请检查服务并刷新页面。');
      return response.json();
    }).then(validateManifest).then(descriptors => {
      panel.querySelector('#browserResourceList').textContent = descriptors.map(d => `${d.required ? '必需' : '可选'} ${d.name} (${d.bytes} bytes)\nSHA-256 ${d.sha256}`).join('\n');
      status.textContent = '请选择本地文件；缺失或哈希错误会拒绝加载。';
      inputs.forEach(input => {
        input.disabled = false;
        input.addEventListener('change', async () => {
          if (!input.files.length) return;
          inputs.forEach(item => { item.disabled = true; }); status.textContent = '正在校验文件…';
          const pending = [];
          try {
            const files = await verifyFiles(input.files, descriptors, win.crypto);
            for (const [key, blob] of files) pending.push([key, win.URL.createObjectURL(blob)]);
            for (const [key, url] of pending) urls.set(key, url);
            panel.close(); panel.remove(); resolveReady();
          } catch (error) {
            for (const [, url] of pending) win.URL.revokeObjectURL(url);
            status.textContent = error.message; inputs.forEach(item => { item.disabled = false; item.value = ''; });
          }
        });
      });
    }).catch(error => { status.textContent = error.message; });
    win.addEventListener('pagehide', () => { for (const url of urls.values()) win.URL.revokeObjectURL(url); });
    const badge = doc.getElementById('desktopBridgeStatus');
    if (badge) {
      badge.textContent = '浏览器 · Build 文件仅在本地处理';
      const login = doc.createElement('button'); login.type = 'button'; login.id = 'browserLogin'; login.textContent = '连接 WeGame 服务';
      login.style.cssText = 'position:fixed;right:10px;bottom:42px;z-index:99999';
      badge.after(login);
      const dialog = doc.createElement('dialog'); dialog.id = 'browserLoginDialog';
      dialog.innerHTML = '<form><h2>连接本地 WeGame 服务</h2><p>输入启动服务时设置的访问令牌；仅用于本地服务身份验证。</p><input type="password" autocomplete="off" aria-label="访问令牌" required><button type="submit">连接</button><button type="button" data-cancel>取消</button><p role="status"></p></form>';
      doc.body.append(dialog); login.addEventListener('click', () => dialog.showModal());
      const token = dialog.querySelector('input'), output = dialog.querySelector('[role="status"]');
      dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close());
      dialog.addEventListener('close', () => { token.value = ''; output.textContent = ''; });
      dialog.querySelector('form').addEventListener('submit', async event => {
        event.preventDefault(); const value = token.value; token.value = '';
        try { const result = await apiPost('/api/login', { token: value }); if (!result.ok) throw new Error('登录失败。'); dialog.close(); login.textContent = 'WeGame 服务已连接（点击重新连接）'; }
        catch (error) { output.textContent = error.message; }
      });
    }
    disableUnsupported();
  }
  return { validateManifest, verifyFiles, readBuildFile, buildFilename, serviceErrorMessage, disableUnsupportedControls, mount };
});
