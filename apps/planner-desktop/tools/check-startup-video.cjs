'use strict';
// Run with Electron, not production main: isolated userData/session, synthetic
// public-data fixtures, and no preload, credentials, provider or network calls.
const { app, BrowserWindow, protocol } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'poe2-startup-test-'));
app.setPath('userData', profile);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
protocol.registerSchemesAsPrivileged([{ scheme: 'poe2', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
app.on('window-all-closed', () => {});
const renderer = path.resolve(__dirname, '../renderer');
const wait = ms => new Promise(r => setTimeout(r, ms));
const localMedia = process.argv.includes('--local-media');
const fixture = path.join(profile, 'fixture.webm');

async function makeFixture() {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  try {
    await win.loadURL('data:text/html,<canvas width="160" height="90"></canvas>');
    const bytes = await win.webContents.executeJavaScript(`new Promise(resolve => {
      const canvas=document.querySelector('canvas'), context=canvas.getContext('2d');
      const stream=canvas.captureStream(15), audio=new AudioContext(), oscillator=audio.createOscillator();
      const gain=audio.createGain(), destination=audio.createMediaStreamDestination();
      gain.gain.value=0.02; oscillator.connect(gain).connect(destination); oscillator.start();
      stream.addTrack(destination.stream.getAudioTracks()[0]);
      const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8,opus'}), chunks=[];
      recorder.ondataavailable=e=>chunks.push(e.data);
      let i=0; const timer=setInterval(()=>{context.fillStyle=i++%2?'#304050':'#503040';context.fillRect(0,0,160,90);},60);
      recorder.onstop=async()=>{clearInterval(timer);stream.getTracks().forEach(t=>t.stop());await audio.close();resolve(Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())));};
      audio.resume();recorder.start();setTimeout(()=>recorder.stop(),6000);
    })`);
    fs.writeFileSync(fixture, Buffer.from(bytes));
  } finally { win.destroy(); }
}

async function run(mode) {
  const win = new BrowserWindow({ show: false, width: 1100, height: 700,
    webPreferences: { partition: 'startup-' + mode, sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  const session = win.webContents.session;
  win.webContents.on('console-message', event => {
    if (event.level === 'error') console.error(mode + ': ' + event.message);
  });
  session.webRequest.onBeforeRequest((details, done) => {
    if (!/^(file|poe2):/.test(details.url)) return done({ cancel: true });
    if (details.url.endsWith('/local-startup/intro.mp4')) {
      if (mode === 'missing') return done({ redirectURL: pathToFileURL(path.join(profile, 'missing.mp4')).href });
      if (mode === 'corrupt') return done({ redirectURL: pathToFileURL(path.join(profile, 'corrupt.mp4')).href });
      if (!localMedia) return done({ redirectURL: pathToFileURL(fixture).href });
    }
    done({});
  });
  let release, attempts = 0;
  const gate = new Promise(r => { release = r; });
  session.protocol.handle('poe2', async request => {
    const name = new URL(request.url).pathname.split('/').pop();
    if (name === 'tree-pre.json') {
      attempts++;
      if (mode === 'retry' && attempts === 1) return new Response('fixture failure', { status: 503 });
      return Response.json({ nodes: { '1': { name: 'Fixture', x: 0, y: 0, stats: [] } }, edges: [], atlas: { skills: { icons: {} }, frames: { frames: {} } } });
    }
    if (name === 'tree-jump.json') return Response.json({ classes: [], ascendancies: [] });
    if (name === 'official-data.json') {
      if (['slow', 'skip', 'escape', 'missing', 'corrupt', 'autoplay', 'stalled', 'cleanup'].includes(mode)) await gate;
      return Response.json({ nodes: {}, groups: {}, constants: {} });
    }
    return new Response('optional fixture unavailable', { status: 404 });
  });
  const evaluate = code => win.webContents.executeJavaScript(code);
  async function until(code, timeout = 12000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (await evaluate(code)) return; await wait(40); }
    throw Error(mode + ' timed out: ' + code + ' / ' + await evaluate('JSON.stringify(window.plannerStartup?.state)'));
  }
  try {
    // Keep production HTML/scripts/hooks; inject only the explicitly simulated
    // browser play failure before scripts run. Native file playback is essential.
    const override = ['autoplay', 'stalled'].includes(mode) ? '<script>HTMLMediaElement.prototype.play=function(){return ' +
      (mode === 'autoplay' ? "Promise.reject(new DOMException('blocked','NotAllowedError'))" : 'Promise.resolve()') + ';};</script>' : '';
    const html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8').replace('<head>',
      '<head><base href="' + pathToFileURL(renderer + path.sep).href + '">' + override);
    const page = path.join(profile, mode + '.html');
    fs.writeFileSync(page, html);
    const started = Date.now();
    await win.loadFile(page);
    await until('!!window.plannerStartup');
    if (mode === 'retry') {
      await until("window.plannerStartup.state.data === 'error'");
      assert.ok(await evaluate("document.querySelector('[data-startup-retry]').getBoundingClientRect().width > 0"));
      assert.ok(await evaluate("document.querySelector('video').paused && !document.querySelector('video').getAttribute('src')"));
      await evaluate("document.querySelector('[data-startup-retry]').click()");
      await until('window.plannerStartup.state.entered');
      assert.equal(attempts, 2);
      assert.equal(await evaluate("getComputedStyle(document.querySelector('#error')).display"), 'none');
    } else if (['missing', 'corrupt', 'autoplay', 'stalled'].includes(mode)) {
      await until("window.plannerStartup.state.media === 'done'");
      if (mode === 'stalled') assert.ok(Date.now() - started >= 7800, 'watchdog, not decode error, must release stalled playback');
      assert.equal(await evaluate('window.plannerStartup.state.entered'), false);
      release();
      await until('window.plannerStartup.state.entered');
    } else {
      await until("document.querySelector('video')?.currentTime > 0");
      await evaluate("window.testVideo = document.querySelector('video'); document.querySelector('[data-startup-mute]').click()");
      assert.equal(await evaluate('testVideo.muted'), true);
      await evaluate("document.querySelector('[data-startup-mute]').click()");
      assert.equal(await evaluate('testVideo.muted'), false);
      if (mode === 'cleanup') {
        await evaluate("window.dispatchEvent(new Event('pagehide'))");
        assert.ok(await evaluate("testVideo.paused && !testVideo.getAttribute('src') && !document.querySelector('.startup-video')"));
        return;
      }
      if (mode === 'fast') {
        await until("window.plannerStartup.state.data === 'ready'");
        assert.equal(await evaluate('window.plannerStartup.state.entered'), false);
      }
      if (mode === 'escape') {
        const before = await evaluate("document.querySelector('.content').className");
        await evaluate("document.querySelector('[data-startup-skip]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))");
        assert.equal(await evaluate("document.querySelector('.content').className"), before);
        await evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))");
        assert.equal(await evaluate("document.querySelector('.content').className"), before);
      }
      else if (mode === 'skip') await evaluate("document.querySelector('[data-startup-skip]').click()");
      else await evaluate('if(Number.isFinite(testVideo.duration)) testVideo.currentTime = testVideo.duration - 0.15; else testVideo.playbackRate=8;');
      await until("window.plannerStartup.state.media === 'done'");
      if (mode !== 'fast') {
        assert.equal(await evaluate('window.plannerStartup.state.entered'), false);
        assert.match(await evaluate("document.querySelector('.startup-video [role=status]').textContent"), /校验官方节点/);
        release();
      }
      await until('window.plannerStartup.state.entered');
      assert.ok(await evaluate("testVideo.paused && !testVideo.getAttribute('src')"));
    }
    assert.ok(await evaluate("!document.querySelector('.startup-video') && !document.querySelector('.content').inert"));
    assert.ok(await evaluate("document.querySelector('#meta').textContent.includes('1 nodes')"));
  } finally { release(); win.destroy(); }
}
app.whenReady().then(async () => {
  if (localMedia) {
    const bytes = fs.readFileSync(path.join(renderer, 'local-startup/intro.mp4'));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), '632defeeff94db4f27861b38f6f93f0e8b8c66cc151a4181271edc5aa497719b');
  } else await makeFixture();
  fs.writeFileSync(path.join(profile, 'corrupt.mp4'), 'not a video');
  for (const mode of ['fast', 'slow', 'skip', 'escape', 'retry', 'missing', 'corrupt', 'autoplay', 'stalled', 'cleanup']) {
    await run(mode); console.log('PASS startup ' + mode);
  }
}).then(() => app.exit(0), error => { console.error(error.stack); app.exit(1); });
