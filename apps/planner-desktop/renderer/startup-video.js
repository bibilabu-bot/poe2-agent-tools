(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.plannerStartupVideo = api;
    root.plannerStartup = api.mount(root.document, {
      source: new URL('local-startup/intro.mp4', root.document.currentScript.src).href,
    });
  }
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';

  function initialState() {
    return { data: 'loading', media: 'playing', phase: '正在准备规划器…', entered: false };
  }
  function transition(state, event) {
    if (state.entered) return state;
    let next = state;
    switch (event.type) {
      case 'phase':
        if (state.data === 'loading') next = { ...state, phase: event.message };
        break;
      case 'ready': next = { ...state, data: 'ready', phase: '天赋树已就绪' }; break;
      case 'media-done': next = { ...state, media: 'done' }; break;
      case 'error': next = { ...state, data: 'error', media: 'done', phase: event.message }; break;
      case 'retry':
        if (state.data === 'error') next = { ...state, data: 'loading', phase: '正在重新加载天赋树…' };
        break;
    }
    return { ...next, entered: next.data === 'ready' && next.media === 'done' };
  }

  function mount(doc, { source, stallMs = 8000 } = {}) {
    const win = doc.defaultView;
    const panel = doc.createElement('section');
    panel.className = 'startup-video';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', '启动加载');
    panel.innerHTML = '<video playsinline preload="auto" aria-hidden="true"></video>' +
      '<div class="startup-video-footer"><p role="status" aria-live="polite"></p>' +
      '<div><button type="button" data-startup-mute aria-pressed="false">静音</button>' +
      '<button type="button" data-startup-skip>跳过视频</button>' +
      '<button type="button" data-startup-retry hidden>重新加载</button></div></div>';
    const video = panel.querySelector('video');
    const status = panel.querySelector('[role="status"]');
    const skip = panel.querySelector('[data-startup-skip]');
    const mute = panel.querySelector('[data-startup-mute]');
    const retry = panel.querySelector('[data-startup-retry]');
    const previousFocus = doc.activeElement;
    const inert = new Map();
    function protect(el) {
      if (el !== panel && !inert.has(el)) { inert.set(el, el.inert); el.inert = true; }
    }
    Array.from(doc.body.children).forEach(protect);
    doc.body.append(panel);
    const observer = new win.MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) protect(node);
    });
    observer.observe(doc.body, { childList: true });
    const listeners = [];
    let state = initialState(), destroyed = false, stopped = false, timer = null, lastTime = -1, onRetry;
    function listen(target, type, callback) {
      target.addEventListener(type, callback);
      listeners.push(() => target.removeEventListener(type, callback));
    }
    function stopMedia() {
      win.clearTimeout(timer);
      if (stopped) return;
      stopped = true;
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    function destroy() {
      if (destroyed) return;
      destroyed = true;
      stopMedia();
      observer.disconnect();
      listeners.splice(0).forEach(remove => remove());
      panel.remove();
      for (const [el, value] of inert) el.inert = value;
      if (previousFocus?.isConnected && previousFocus !== doc.body) previousFocus.focus();
      else doc.querySelector('.tool-trigger, #classSelect')?.focus();
    }
    function send(event) {
      if (destroyed) return;
      state = transition(state, event);
      if (state.media === 'done') stopMedia();
      if (state.entered) { destroy(); return; }
      status.textContent = state.phase;
      panel.classList.toggle('startup-video-error', state.data === 'error');
      retry.hidden = state.data !== 'error';
      retry.disabled = state.data !== 'error';
      skip.hidden = mute.hidden = video.hidden = state.media === 'done';
      if (state.data === 'error') retry.focus();
      else if (state.media === 'done') { status.tabIndex = -1; status.focus(); }
    }
    function watchdog() {
      win.clearTimeout(timer);
      if (!stopped) timer = win.setTimeout(() => send({ type: 'media-done' }), stallMs);
    }
    listen(video, 'ended', () => send({ type: 'media-done' }));
    listen(video, 'error', () => send({ type: 'media-done' }));
    listen(video, 'timeupdate', () => {
      if (video.currentTime > lastTime) { lastTime = video.currentTime; watchdog(); }
    });
    listen(skip, 'click', () => send({ type: 'media-done' }));
    listen(mute, 'click', () => {
      video.muted = !video.muted;
      mute.setAttribute('aria-pressed', String(video.muted));
      mute.textContent = video.muted ? '开启声音' : '静音';
    });
    listen(retry, 'click', () => {
      if (state.data !== 'error' || !onRetry) return;
      send({ type: 'retry' });
      Promise.resolve().then(onRetry).catch(() => send({ type: 'error', message: '重新加载失败，请重试。' }));
    });
    listen(panel, 'keydown', event => {
      // Modal keystrokes must not reach the Planner's document shortcuts.
      event.stopPropagation();
      if (event.key === 'Escape' && state.media === 'playing') { event.preventDefault(); send({ type: 'media-done' }); }
      if (event.key === 'Tab') {
        const buttons = Array.from(panel.querySelectorAll('button')).filter(b => !b.hidden && !b.disabled);
        if (!buttons.length) { event.preventDefault(); return; }
        const i = buttons.indexOf(doc.activeElement);
        event.preventDefault();
        const next = i < 0 ? (event.shiftKey ? buttons.length - 1 : 0)
          : (i + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next].focus();
      }
    });
    listen(win, 'pagehide', destroy);
    send({ type: 'phase', message: state.phase });
    skip.focus();
    if (!source || win.matchMedia('(prefers-reduced-motion: reduce)').matches) send({ type: 'media-done' });
    else {
      video.src = source;
      watchdog();
      try { Promise.resolve(video.play()).catch(() => send({ type: 'media-done' })); }
      catch { send({ type: 'media-done' }); }
    }
    return {
      phase: message => send({ type: 'phase', message }),
      ready: () => send({ type: 'ready' }),
      fail: message => send({ type: 'error', message }),
      setRetry: callback => { onRetry = callback; },
      destroy,
      get state() { return { ...state }; },
    };
  }
  return { initialState, transition, mount };
});
