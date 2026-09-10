(function runPrototype() {
  "use strict";

  const L = window.LoadingParticleLogic;
  const canvas = document.getElementById("particle-canvas");
  const context = canvas.getContext("2d", { alpha: true });
  const progress = document.getElementById("loading-progress");
  const progressValue = document.getElementById("progress-value");
  const stepText = document.getElementById("step-text");
  const stateLabel = document.getElementById("state-label");
  const errorText = document.getElementById("error-text");
  const completionText = document.getElementById("completion-text");
  const pauseButton = document.getElementById("pause-button");
  const restartButton = document.getElementById("restart-button");
  const errorButton = document.getElementById("error-button");
  const qualitySelect = document.getElementById("quality-select");
  const motionNote = document.getElementById("motion-note");

  const params = new URLSearchParams(location.search);
  const seed = Number(params.get("seed")) || 20260220;
  const captureMode = params.get("capture") === "1";
  const systemMotionQuery = matchMedia("(prefers-reduced-motion: reduce)");
  const debugReduced = params.get("motion") === "reduced";
  const requestedQuality = params.get("quality") === "cinematic" ? "cinematic" : "balanced";
  let userMotionOverride = debugReduced ? "reduce" : null;
  let motionMode = L.chooseMotionMode(systemMotionQuery.matches || debugReduced, userMotionOverride);
  let qualityName = L.selectQuality(requestedQuality, {
    reducedMotion: motionMode === "reduced",
    deviceMemory: navigator.deviceMemory,
    cores: navigator.hardwareConcurrency
  });
  qualitySelect.value = qualityName;

  const state = {
    mode: "enter", paused: motionMode === "reduced", hidden: document.hidden, destroyed: false,
    width: 0, height: 0, dpr: 1, progress: 0, stepIndex: 0, enteredAt: performance.now(),
    titleParticles: [], waveParticles: [], frameSamples: new Float32Array(90), slowFrameFlags: new Uint8Array(90),
    frameSampleCount: 0, slowFrameCount: 0, frameSampleCursor: 0, lastFrame: 0,
    lastPointerUpdate: 0, pointerX: 0, pointerY: 0,
    layoutTimer: null, loadingTimer: null, completionTimer: null, qualityNoticeTimer: null,
    targetGenerationMs: 0, lastResizeMs: 0, autoDegraded: false, particleCountPeak: 0,
    hiddenFrameCount: 0, renderedFrameCount: 0, animationFrameId: null
  };

  const steps = [
    { at: 4, label: "Reading game data" },
    { at: 24, label: "Validating local cache" },
    { at: 43, label: "Downloading atlas fragments" },
    { at: 66, label: "Parsing passive tree" },
    { at: 88, label: "Preparing renderer" }
  ];
  const palette = ["#f8d78e", "#ffeaba", "#d58b58", "#b17ce8", "#77a6e5"];

  function randomBetween(rng, min, max) { return min + rng() * (max - min); }

  function makeParticle(target, index, rng) {
    const angle = rng() * Math.PI * 2;
    const distance = randomBetween(rng, Math.min(state.width, state.height) * .28, Math.max(state.width, state.height) * .7);
    return {
      x: captureMode ? target.x : state.width / 2 + Math.cos(angle) * distance,
      y: captureMode ? target.y : state.height / 2 + Math.sin(angle) * distance,
      targetX: target.x, targetY: target.y, velocityX: randomBetween(rng, -1.4, 1.4), velocityY: randomBetween(rng, -1.4, 1.4),
      damping: randomBetween(rng, .86, .92), color: palette[index % palette.length], alpha: randomBetween(rng, .82, 1),
      size: randomBetween(rng, 1.08, qualityName === "cinematic" ? 2.3 : 1.92), life: randomBetween(rng, 0, Math.PI * 2),
      drift: randomBetween(rng, .12, .55), scattered: index % 31 === 0
    };
  }

  function buildTextTargets(preset, rng) {
    const started = performance.now();
    const offscreen = document.createElement("canvas");
    const sampleWidth = Math.min(940, Math.max(520, Math.floor(state.width * .72)));
    const sampleHeight = Math.min(330, Math.max(220, Math.floor(state.height * .34)));
    offscreen.width = sampleWidth;
    offscreen.height = sampleHeight;
    const off = offscreen.getContext("2d", { willReadFrequently: true });
    off.clearRect(0, 0, sampleWidth, sampleHeight);
    off.fillStyle = "#fff";
    off.textAlign = "center";
    off.textBaseline = "middle";
    off.font = `600 ${Math.floor(sampleHeight * .34)}px Georgia, serif`;
    off.fillText("POE2", sampleWidth / 2, sampleHeight * .36);
    off.font = `400 ${Math.floor(sampleHeight * .18)}px Georgia, serif`;
    off.fillText("AGENT TOOLS", sampleWidth / 2, sampleHeight * .68);
    const pixels = off.getImageData(0, 0, sampleWidth, sampleHeight).data;
    const alpha = new Uint8ClampedArray(sampleWidth * sampleHeight);
    for (let source = 3, target = 0; source < pixels.length; source += 4, target += 1) alpha[target] = pixels[source];
    const points = L.selectTargetPoints(alpha, sampleWidth, sampleHeight, preset.sampleStep, preset.titleMax, rng);
    const offsetX = (state.width - sampleWidth) / 2;
    const offsetY = Math.max(100, state.height * .18);
    for (let i = 0; i < points.length; i += 1) { points[i].x += offsetX; points[i].y += offsetY; }
    state.targetGenerationMs = performance.now() - started;
    return points;
  }

  function rebuildParticles() {
    const started = performance.now();
    const preset = L.QUALITY_PRESETS[qualityName];
    const rng = L.createSeededRandom(seed + (qualityName === "cinematic" ? 1 : 0));
    const targets = buildTextTargets(preset, rng);
    const assignments = L.assignTargets(targets.length, targets, rng);
    state.titleParticles = new Array(assignments.length);
    for (let i = 0; i < assignments.length; i += 1) state.titleParticles[i] = makeParticle(assignments[i], i, rng);
    const desiredWaves = Math.min(preset.waveMax, Math.floor(state.width / (qualityName === "cinematic" ? 1.7 : 2.8)));
    state.waveParticles = new Array(desiredWaves);
    for (let i = 0; i < desiredWaves; i += 1) {
      state.waveParticles[i] = {
        baseX: (i / Math.max(1, desiredWaves - 1)) * state.width, phase: randomBetween(rng, 0, Math.PI * 2),
        depth: randomBetween(rng, 0, 1), size: randomBetween(rng, .5, 1.45), alpha: randomBetween(rng, .14, .6),
        color: palette[(i + 2) % palette.length]
      };
    }
    state.lastResizeMs = performance.now() - started;
    state.particleCountPeak = Math.max(state.particleCountPeak, state.titleParticles.length + state.waveParticles.length);
    exposeMetrics();
  }

  function resize() {
    const preset = L.QUALITY_PRESETS[qualityName];
    state.width = innerWidth;
    state.height = innerHeight;
    state.dpr = Math.min(devicePixelRatio || 1, preset.dprMax);
    canvas.width = Math.round(state.width * state.dpr);
    canvas.height = Math.round(state.height * state.dpr);
    canvas.style.width = `${state.width}px`;
    canvas.style.height = `${state.height}px`;
    context.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    rebuildParticles();
    draw(performance.now(), true);
  }

  function scheduleResize() {
    clearTimeout(state.layoutTimer);
    state.layoutTimer = setTimeout(resize, 160);
  }

  function drawWave(time, preset) {
    const progressEnergy = .7 + state.progress / 330;
    const horizon = state.height * .77;
    context.save();
    context.globalCompositeOperation = "lighter";
    for (let i = 0; i < state.waveParticles.length; i += 1) {
      const point = state.waveParticles[i];
      const normalizedX = point.baseX / state.width;
      const perspective = .24 + point.depth * .76;
      const wave = Math.sin(normalizedX * 12 + time * .00042 + point.phase) * 22 * perspective
        + Math.sin(normalizedX * 27 - time * .00019) * 8;
      const y = horizon + point.depth * state.height * .18 + wave * progressEnergy;
      context.globalAlpha = point.alpha * (1 - point.depth * .35);
      context.fillStyle = point.color;
      context.fillRect(point.baseX + Math.sin(time * .00018 + point.phase) * 5, y, point.size * perspective, point.size * perspective);
      if (preset.glow > .6 && i % 8 === 0) context.fillRect(point.baseX - 1, y - 1, point.size * 2.2, point.size * 2.2);
    }
    context.restore();
  }

  function drawTitle(time, staticFrame) {
    const settle = motionMode === "reduced" ? 1 : Math.min(1, Math.max(0, (time - state.enteredAt) / 1900));
    const parallaxX = motionMode === "reduced" ? 0 : state.pointerX * 4;
    const parallaxY = motionMode === "reduced" ? 0 : state.pointerY * 3;
    context.save();
    context.globalCompositeOperation = "lighter";
    for (let i = 0; i < state.titleParticles.length; i += 1) {
      const particle = state.titleParticles[i];
      if (!staticFrame && motionMode !== "reduced") {
        const edgeScatter = particle.scattered && state.mode !== "complete" ? Math.sin(time * .0011 + particle.life) * 8 : 0;
        const driftX = Math.sin(time * .00055 + particle.life) * particle.drift + edgeScatter;
        const driftY = Math.cos(time * .00048 + particle.life) * particle.drift;
        particle.velocityX += (particle.targetX + driftX - particle.x) * (.018 + settle * .012);
        particle.velocityY += (particle.targetY + driftY - particle.y) * (.018 + settle * .012);
        particle.velocityX *= particle.damping;
        particle.velocityY *= particle.damping;
        particle.x += particle.velocityX;
        particle.y += particle.velocityY;
      } else if (motionMode === "reduced") {
        particle.x = particle.targetX;
        particle.y = particle.targetY;
      }
      const twinkle = motionMode === "reduced" ? .96 : .88 + Math.sin(time * .002 + particle.life) * .12;
      context.globalAlpha = particle.alpha * twinkle * (motionMode === "reduced" ? 1 : .25 + settle * .75);
      context.fillStyle = particle.color;
      const size = particle.size * (.7 + settle * .3);
      context.fillRect(particle.x + parallaxX, particle.y + parallaxY, size, size);
    }
    context.restore();
  }

  function draw(time, staticFrame) {
    context.clearRect(0, 0, state.width, state.height);
    const preset = L.QUALITY_PRESETS[qualityName];
    if (motionMode !== "reduced" || staticFrame) drawWave(time, preset);
    drawTitle(time, staticFrame);
  }

  function recordFrame(delta) {
    if (state.frameSampleCount === state.frameSamples.length) {
      state.slowFrameCount -= state.slowFrameFlags[state.frameSampleCursor];
    }
    const slow = delta > 24 ? 1 : 0;
    state.frameSamples[state.frameSampleCursor] = delta;
    state.slowFrameFlags[state.frameSampleCursor] = slow;
    state.slowFrameCount += slow;
    state.frameSampleCursor = (state.frameSampleCursor + 1) % state.frameSamples.length;
    state.frameSampleCount = Math.min(state.frameSampleCount + 1, state.frameSamples.length);
    if (qualityName === "cinematic" && !state.autoDegraded && state.frameSampleCount === state.frameSamples.length) {
      if (state.slowFrameCount / state.frameSampleCount >= .72) setQuality("balanced", true);
    }
  }

  function animate(time) {
    state.animationFrameId = null;
    if (state.destroyed || state.paused || state.hidden) return;
    if (state.lastFrame) recordFrame(Math.min(100, time - state.lastFrame));
    state.lastFrame = time;
    draw(time, false);
    state.renderedFrameCount += 1;
    state.animationFrameId = requestAnimationFrame(animate);
    if (state.renderedFrameCount % 60 === 0) exposeMetrics();
  }

  function startAnimation() {
    if (state.destroyed || state.paused || state.hidden || state.animationFrameId != null) return;
    state.lastFrame = 0;
    state.animationFrameId = requestAnimationFrame(animate);
  }

  function stopAnimation() {
    if (state.animationFrameId != null) cancelAnimationFrame(state.animationFrameId);
    state.animationFrameId = null;
  }

  function setPaused(paused, fromMotionPreference) {
    state.paused = paused;
    pauseButton.setAttribute("aria-pressed", String(paused));
    pauseButton.textContent = paused ? "Resume animation" : "Pause animation";
    motionNote.hidden = motionMode !== "reduced";
    if (paused) { stopAnimation(); draw(performance.now(), true); }
    else startAnimation();
    if (!fromMotionPreference) userMotionOverride = paused ? "reduce" : "animate";
    exposeMetrics();
  }

  function setMode(next) {
    state.mode = L.transitionState(state.mode, next);
    document.body.dataset.state = next;
    stateLabel.textContent = next === "enter" ? "Awakening the atlas" : next === "loading" ? "Loading atlas intelligence" : next === "complete" ? "Complete" : "Loading interrupted";
    completionText.hidden = next !== "complete";
    errorText.hidden = next !== "error";
  }

  function updateProgress(value) {
    if (state.destroyed) return;
    state.progress = L.clampProgress(value);
    progress.value = state.progress;
    progress.textContent = `${Math.round(state.progress)}%`;
    progressValue.value = `${Math.round(state.progress)}%`;
    let nextStep = steps[0];
    for (let i = 0; i < steps.length; i += 1) if (state.progress >= steps[i].at) nextStep = steps[i];
    stepText.textContent = nextStep.label;
  }

  function tickLoading() {
    if (state.mode === "error" || state.mode === "complete" || state.destroyed) return;
    if (state.mode === "enter" && (motionMode === "reduced" || performance.now() - state.enteredAt > 1150)) setMode("loading");
    const increment = state.mode === "enter" ? .7 : 1.25 + Math.sin(state.progress * .23) * .45;
    updateProgress(state.progress + increment);
    if (state.progress >= 100) {
      setMode("complete");
      clearInterval(state.loadingTimer);
      state.loadingTimer = null;
      state.completionTimer = setTimeout(function fadeAfterComplete() { canvas.style.opacity = ".22"; }, 900);
    }
    exposeMetrics();
  }

  function restart() {
    if (state.destroyed) return;
    clearInterval(state.loadingTimer);
    clearTimeout(state.completionTimer);
    canvas.style.opacity = "1";
    if (state.mode !== "enter") state.mode = L.transitionState(state.mode, "enter");
    document.body.dataset.state = "enter";
    state.enteredAt = performance.now();
    state.progress = 0;
    state.frameSampleCount = 0;
    state.slowFrameCount = 0;
    state.frameSampleCursor = 0;
    state.slowFrameFlags.fill(0);
    errorText.hidden = true;
    completionText.hidden = true;
    updateProgress(0);
    stateLabel.textContent = "Awakening the atlas";
    rebuildParticles();
    state.loadingTimer = setInterval(tickLoading, motionMode === "reduced" ? 90 : 115);
    if (captureMode) {
      setMode("loading");
      updateProgress(72);
      clearInterval(state.loadingTimer);
      state.loadingTimer = null;
      setPaused(true, true);
      return;
    }
    if (!state.paused) startAnimation(); else draw(performance.now(), true);
  }

  function simulateError() {
    if (state.destroyed) return;
    if (state.mode === "complete" || state.mode === "error") restart();
    if (state.mode === "enter" || state.mode === "loading") {
      setMode("error");
      clearInterval(state.loadingTimer);
      state.loadingTimer = null;
      errorText.textContent = "Could not validate the local cache. Retry the demo or inspect the loading source.";
      stepText.textContent = "Loading stopped — retry is available.";
      exposeMetrics();
    }
  }

  function setQuality(requested, automatic) {
    const selected = L.selectQuality(requested, {
      reducedMotion: false, deviceMemory: navigator.deviceMemory, cores: navigator.hardwareConcurrency
    });
    qualityName = selected;
    qualitySelect.value = selected;
    if (automatic) {
      state.autoDegraded = true;
      stepText.textContent = "Particle quality reduced to maintain a smooth frame rate.";
      clearTimeout(state.qualityNoticeTimer);
      state.qualityNoticeTimer = setTimeout(function restoreStep() { updateProgress(state.progress); }, 2400);
    }
    resize();
  }

  function handleMotionPreference(event) {
    if (userMotionOverride != null) return;
    motionMode = L.chooseMotionMode(event.matches, null);
    setPaused(motionMode === "reduced", true);
  }

  function handlePointer(event) {
    const now = performance.now();
    if (motionMode === "reduced" || now - state.lastPointerUpdate < 48) return;
    state.lastPointerUpdate = now;
    state.pointerX = event.clientX / state.width - .5;
    state.pointerY = event.clientY / state.height - .5;
  }

  function handleVisibility() {
    state.hidden = document.hidden;
    if (state.hidden) stopAnimation(); else startAnimation();
    exposeMetrics();
  }

  function sampleStats() {
    const count = state.frameSampleCount;
    const values = Array.from(state.frameSamples.slice(0, count)).sort((a, b) => a - b);
    const total = values.reduce((sum, value) => sum + value, 0);
    return { averageMs: count ? total / count : 0, p95Ms: count ? values[Math.min(count - 1, Math.floor(count * .95))] : 0, samples: count };
  }

  function exposeMetrics() {
    const snapshot = {
      state: state.mode, quality: qualityName, motionMode, paused: state.paused, hidden: state.hidden,
      titleParticles: state.titleParticles.length, waveParticles: state.waveParticles.length,
      totalParticles: state.titleParticles.length + state.waveParticles.length, particleCountPeak: state.particleCountPeak,
      targetGenerationMs: state.targetGenerationMs, lastResizeMs: state.lastResizeMs,
      frame: sampleStats(), autoDegraded: state.autoDegraded, renderedFrameCount: state.renderedFrameCount,
      hiddenFrameCount: state.hiddenFrameCount, animationScheduled: state.animationFrameId != null
    };
    document.body.dataset.metrics = JSON.stringify(snapshot);
    window.__loadingPrototype = {
      getMetrics() {
        return snapshot;
      },
      setProgress(value) { if (!state.destroyed) updateProgress(value); },
      complete() {
        if (state.destroyed || state.mode === "complete" || state.mode === "error") return;
        clearInterval(state.loadingTimer);
        state.loadingTimer = null;
        updateProgress(100);
        if (state.mode === "enter") setMode("loading");
        if (state.mode === "loading") setMode("complete");
      },
      fail: simulateError,
      restart,
      destroy
    };
  }

  function destroy() {
    if (state.destroyed) return;
    state.destroyed = true;
    stopAnimation();
    clearTimeout(state.layoutTimer);
    clearTimeout(state.completionTimer);
    clearTimeout(state.qualityNoticeTimer);
    clearInterval(state.loadingTimer);
    removeEventListener("resize", scheduleResize);
    removeEventListener("pointermove", handlePointer);
    document.removeEventListener("visibilitychange", handleVisibility);
    systemMotionQuery.removeEventListener("change", handleMotionPreference);
    pauseButton.removeEventListener("click", onPauseClick);
    restartButton.removeEventListener("click", restart);
    errorButton.removeEventListener("click", simulateError);
    qualitySelect.removeEventListener("change", onQualityChange);
    exposeMetrics();
    delete window.__loadingPrototype;
  }

  function onPauseClick() {
    motionMode = state.paused ? "animated" : "reduced";
    setPaused(!state.paused, false);
  }
  function onQualityChange() { setQuality(qualitySelect.value, false); }

  addEventListener("resize", scheduleResize, { passive: true });
  addEventListener("pointermove", handlePointer, { passive: true });
  document.addEventListener("visibilitychange", handleVisibility);
  systemMotionQuery.addEventListener("change", handleMotionPreference);
  pauseButton.addEventListener("click", onPauseClick);
  restartButton.addEventListener("click", restart);
  errorButton.addEventListener("click", simulateError);
  qualitySelect.addEventListener("change", onQualityChange);

  motionNote.hidden = motionMode !== "reduced";
  resize();
  setPaused(motionMode === "reduced", true);
  restart();
})();
