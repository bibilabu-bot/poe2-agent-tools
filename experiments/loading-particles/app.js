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
  const captureStage = params.get("stage");
  const captureTimes = { black: 0, void: 1450, ignition: 2800, convergence: 6500, revelation: 10600, complete: 11600 };
  const captureMode = params.get("capture") === "1" || Object.hasOwn(captureTimes, captureStage);
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
    hiddenFrameCount: 0, renderedFrameCount: 0, animationFrameId: null, completeAt: 0,
    pausedDuration: 0, timelineOffset: 0, frozenTimeline: motionMode === "reduced" ? 10600 : 0,
    freezeStartedAt: motionMode === "reduced" ? performance.now() : 0, pendingComplete: false,
    catchUpStartedAt: 0, catchUpDuration: 0, catchUpBoost: 0
  };

  const steps = [
    { at: 4, label: "Reading game data" },
    { at: 24, label: "Validating local cache" },
    { at: 43, label: "Downloading atlas fragments" },
    { at: 66, label: "Parsing passive tree" },
    { at: 88, label: "Preparing renderer" }
  ];
  const palette = ["#dce8f4", "#a9c7e7", "#8e86bd", "#e7d6b0", "#b58a4a"];

  function randomBetween(rng, min, max) { return min + rng() * (max - min); }

  function smoothstep(min, max, value) {
    const ratio = Math.min(1, Math.max(0, (value - min) / (max - min)));
    return ratio * ratio * (3 - 2 * ratio);
  }

  function timelineTime(time) {
    if (captureMode && captureStage) return captureTimes[captureStage];
    if (state.paused || state.hidden) return state.frozenTimeline;
    const effectiveNow = time - state.pausedDuration;
    let elapsed = Math.max(0, effectiveNow - state.enteredAt + state.timelineOffset);
    if (state.catchUpStartedAt && effectiveNow > state.catchUpStartedAt) {
      const catchUpProgress = smoothstep(state.catchUpStartedAt, state.catchUpStartedAt + state.catchUpDuration, effectiveNow);
      elapsed += state.catchUpBoost * catchUpProgress;
    }
    return elapsed;
  }

  function freezeTimeline(now) {
    if (state.paused || state.hidden) return;
    state.frozenTimeline = timelineTime(now);
    state.freezeStartedAt = now;
  }

  function resumeTimeline(now) {
    if (!state.freezeStartedAt) return;
    state.pausedDuration += now - state.freezeStartedAt;
    state.freezeStartedAt = 0;
  }

  function makeParticle(target, index, rng) {
    const type = index % 127 === 0 ? "guide" : index % 19 === 0 ? "ember" : "stardust";
    const fromWave = rng() < .68;
    const startX = fromWave ? randomBetween(rng, state.width * .08, state.width * .92) : (rng() < .5 ? -30 : state.width + 30);
    const startY = fromWave ? randomBetween(rng, state.height * .76, state.height * .97) : randomBetween(rng, state.height * .12, state.height * .72);
    const bornBase = type === "ember" ? 820 : type === "guide" ? 1250 : 1750;
    const bornSpan = type === "ember" ? 2600 : type === "guide" ? 4100 : 5200;
    const bornAt = Math.max(target.role === "subtitle" ? 7200 : 0, bornBase + Math.pow(rng(), .68) * bornSpan);
    const size = type === "guide" ? randomBetween(rng, 1.7, 2.55)
      : type === "ember" ? randomBetween(rng, 1.05, 1.72)
      : randomBetween(rng, .52, qualityName === "cinematic" ? 1.02 : .88);
    return {
      x: startX, y: startY, previousX: startX, previousY: startY,
      targetX: target.x, targetY: target.y, velocityX: randomBetween(rng, -1.4, 1.4), velocityY: randomBetween(rng, -1.4, 1.4),
      damping: randomBetween(rng, .9, .946), color: type === "ember" ? palette[3 + (index % 2)] : palette[index % 3],
      alpha: type === "guide" ? randomBetween(rng, .92, 1) : randomBetween(rng, .74, 1), size,
      life: randomBetween(rng, 0, Math.PI * 2), drift: randomBetween(rng, .08, .38),
      scattered: index % 37 === 0, type, role: target.role, bornAt, swirl: rng() < .5 ? -1 : 1, depth: randomBetween(rng, .45, 1)
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
    function sampleLine(text, font, y, limit, role, step) {
      off.clearRect(0, 0, sampleWidth, sampleHeight);
      off.fillStyle = "#fff";
      off.textAlign = "center";
      off.textBaseline = "middle";
      off.font = font;
      off.fillText(text, sampleWidth / 2, y);
      const pixels = off.getImageData(0, 0, sampleWidth, sampleHeight).data;
      const alpha = new Uint8ClampedArray(sampleWidth * sampleHeight);
      for (let source = 3, target = 0; source < pixels.length; source += 4, target += 1) alpha[target] = pixels[source];
      const selected = L.selectTargetPoints(alpha, sampleWidth, sampleHeight, step, limit, rng);
      for (let i = 0; i < selected.length; i += 1) selected[i].role = role;
      return selected;
    }
    const main = sampleLine("Path Of Exile 2", `600 ${Math.floor(sampleHeight * .31)}px Georgia, serif`, sampleHeight * .42, Math.floor(preset.titleMax * .84), "title", preset.sampleStep);
    const subtitle = sampleLine("OPEN-SOURCE INTELLIGENCE FOR THE COMMUNITY", `500 ${Math.floor(sampleHeight * .068)}px Arial, sans-serif`, sampleHeight * .69, preset.titleMax - main.length, "subtitle", Math.max(1, preset.sampleStep - 1));
    const points = main.concat(subtitle);
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
        baseX: (i / Math.max(1, desiredWaves - 1)) * state.width, phase: randomBetween(rng, 0, Math.PI * 2), bornAt: randomBetween(rng, 1200, 5700),
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
    const elapsed = timelineTime(time);
    const ignition = smoothstep(900, 3300, elapsed);
    const progressEnergy = .7 + state.progress / 330;
    const horizon = state.height * .79;
    context.save();
    context.globalCompositeOperation = "lighter";
    for (let i = 0; i < state.waveParticles.length; i += 1) {
      const point = state.waveParticles[i];
      if (elapsed < point.bornAt) continue;
      const birth = smoothstep(point.bornAt, point.bornAt + 650, elapsed);
      const normalizedX = point.baseX / state.width;
      const perspective = .24 + point.depth * .76;
      const wave = Math.sin(normalizedX * 9 + elapsed * .00042 + point.phase) * 18 * perspective
        + Math.sin(normalizedX * 23 - elapsed * .00017) * 6;
      const y = horizon + point.depth * state.height * .18 + wave * progressEnergy;
      context.globalAlpha = point.alpha * birth * ignition * (1 - point.depth * .42);
      context.fillStyle = point.color;
      context.fillRect(point.baseX + Math.sin(elapsed * .00018 + point.phase) * 5, y, point.size * perspective, point.size * perspective);
      if (preset.glow > .55 && i % 17 === 0) context.fillRect(point.baseX - .5, y - .5, point.size * 1.45, point.size * 1.45);
    }
    context.restore();
  }

  function drawTitle(time, staticFrame) {
    const elapsed = timelineTime(time);
    const convergence = smoothstep(3200, 9900, elapsed);
    const revelation = smoothstep(7600, 10300, elapsed);
    const parallaxX = motionMode === "reduced" ? 0 : state.pointerX * 4;
    const parallaxY = motionMode === "reduced" ? 0 : state.pointerY * 3;
    context.save();
    context.globalCompositeOperation = "lighter";
    for (let i = 0; i < state.titleParticles.length; i += 1) {
      const particle = state.titleParticles[i];
      if (elapsed < particle.bornAt) continue;
      const birth = smoothstep(particle.bornAt, particle.bornAt + 480, elapsed);
      const roleReveal = particle.role === "subtitle" ? smoothstep(8750, 10600, elapsed) : revelation;
      if (!staticFrame && motionMode !== "reduced") {
        particle.previousX = particle.x;
        particle.previousY = particle.y;
        const dx = particle.targetX - particle.x;
        const dy = particle.targetY - particle.y;
        const distance = Math.max(24, Math.hypot(dx, dy));
        const attraction = .0015 + convergence * .026;
        const curl = (1 - convergence) * particle.swirl * (.12 + particle.depth * .12) * Math.sin(distance * .009 + elapsed * .0007 + particle.life);
        const flowX = -dy / distance * curl + Math.sin(particle.y * .012 + elapsed * .00034) * .035;
        const flowY = dx / distance * curl - (1 - convergence) * .018 * particle.depth;
        const edgeScatter = particle.scattered && state.mode !== "complete" ? Math.sin(elapsed * .0009 + particle.life) * (1 - convergence) * 5 : 0;
        const driftX = Math.sin(elapsed * .00042 + particle.life) * particle.drift + edgeScatter;
        const driftY = Math.cos(elapsed * .00038 + particle.life) * particle.drift;
        particle.velocityX += dx * attraction + flowX + driftX * .008;
        particle.velocityY += dy * attraction + flowY + driftY * .008;
        particle.velocityX *= particle.damping;
        particle.velocityY *= particle.damping;
        particle.x += particle.velocityX;
        particle.y += particle.velocityY;
      } else if (motionMode === "reduced" || captureMode) {
        const curve = convergence * convergence;
        const orbit = Math.sin(particle.life + convergence * Math.PI * 2) * (1 - convergence) * 90;
        particle.x = particle.x + (particle.targetX - particle.x) * curve + orbit * particle.swirl;
        particle.y = particle.y + (particle.targetY - particle.y) * curve - Math.cos(particle.life) * (1 - convergence) * 36;
      }
      if (motionMode === "reduced" && !captureStage) {
        particle.x = particle.targetX;
        particle.y = particle.targetY;
      }
      const twinkle = motionMode === "reduced" ? .94 : .84 + Math.sin(elapsed * .0017 + particle.life) * .16;
      const isBeacon = particle.type === "ember" || particle.type === "guide";
      const ignitionPresence = isBeacon ? birth : birth * (.48 + convergence * .52);
      const revealFactor = isBeacon ? 1 : .52 + roleReveal * .48;
      let completionBoost = 0;
      if (state.completeAt) {
        const sweepAge = time - state.completeAt;
        if (sweepAge >= 0 && sweepAge <= 1500) {
          const sweepX = (sweepAge / 1500 * 1.4 - .2) * state.width;
          completionBoost = Math.max(0, 1 - Math.abs(particle.targetX - sweepX) / 130);
        }
      }
      context.globalAlpha = Math.min(1, particle.alpha * twinkle * ignitionPresence * revealFactor * (1 + completionBoost));
      context.fillStyle = particle.color;
      const size = particle.size * (.76 + roleReveal * .24 + completionBoost * .35);
      if ((particle.type === "ember" || particle.type === "guide") && convergence < .92) {
        context.globalAlpha *= .25;
        context.fillRect(particle.x - particle.velocityX * 2.4 + parallaxX, particle.y - particle.velocityY * 2.4 + parallaxY, size * .7, size * .7);
        context.globalAlpha *= 4;
      }
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
    if (state.pendingComplete && timelineTime(time) >= 10300) finalizeComplete();
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
    const now = performance.now();
    if (paused && !state.paused) freezeTimeline(now);
    state.paused = paused;
    if (paused && fromMotionPreference && motionMode === "reduced") state.frozenTimeline = 10600;
    if (!paused && !state.hidden) resumeTimeline(now);
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
    if (next === "complete") {
      state.completeAt = performance.now();
    } else if (next === "enter") {
      state.completeAt = 0;
    }
    document.body.dataset.state = next;
    stateLabel.textContent = next === "enter" ? "Awakening the atlas" : next === "loading" ? "Loading atlas intelligence" : next === "complete" ? "Complete" : "Loading interrupted";
    completionText.hidden = next !== "complete";
    errorText.hidden = next !== "error";
  }

  function finalizeComplete() {
    if (!state.pendingComplete || state.destroyed || state.mode === "complete" || state.mode === "error") return;
    state.pendingComplete = false;
    updateProgress(100);
    if (state.mode === "enter") setMode("loading");
    if (state.mode === "loading") setMode("complete");
    state.completionTimer = setTimeout(function holdCompletedScene() { completionText.hidden = false; }, 900);
    exposeMetrics();
  }

  function requestComplete() {
    if (state.destroyed || state.mode === "complete" || state.mode === "error" || state.pendingComplete) return;
    clearInterval(state.loadingTimer);
    state.loadingTimer = null;
    state.pendingComplete = true;
    if (state.mode === "enter") setMode("loading");
    updateProgress(99);
    stepText.textContent = "Data ready — revealing the atlas";
    const now = performance.now();
    const current = timelineTime(now);
    if (current < 7200) {
      const minimumVoidRemaining = Math.max(0, 1000 - current);
      state.catchUpDuration = 2400;
      state.catchUpStartedAt = now - state.pausedDuration + minimumVoidRemaining;
      state.catchUpBoost = Math.max(0, 7200 - current - minimumVoidRemaining - state.catchUpDuration);
    }
    if (timelineTime(now) >= 10300) finalizeComplete();
    exposeMetrics();
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
      requestComplete();
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
    state.pausedDuration = 0;
    state.timelineOffset = 0;
    state.catchUpStartedAt = 0;
    state.catchUpDuration = 0;
    state.catchUpBoost = 0;
    state.frozenTimeline = motionMode === "reduced" ? 10600 : 0;
    state.freezeStartedAt = state.paused ? performance.now() : 0;
    state.pendingComplete = false;
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
      const stageProgress = { black: 0, void: 0, ignition: 14, convergence: 56, revelation: 92, complete: 100 };
      const heldProgress = captureStage ? stageProgress[captureStage] : 72;
      if (captureStage !== "void" && captureStage !== "black") setMode("loading");
      updateProgress(heldProgress);
      if (captureStage === "complete") {
        setMode("complete");
        state.completeAt = performance.now() - 750;
      }
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
    const now = performance.now();
    if (document.hidden && !state.hidden) freezeTimeline(now);
    state.hidden = document.hidden;
    if (state.hidden) stopAnimation();
    else {
      if (!state.paused) resumeTimeline(now);
      startAnimation();
    }
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
      visualElapsedMs: timelineTime(performance.now()), visualPhase: L.getVisualPhase(timelineTime(performance.now())),
      titleParticles: state.titleParticles.length, waveParticles: state.waveParticles.length,
      totalParticles: state.titleParticles.length + state.waveParticles.length, particleCountPeak: state.particleCountPeak,
      targetGenerationMs: state.targetGenerationMs, lastResizeMs: state.lastResizeMs,
      frame: sampleStats(), autoDegraded: state.autoDegraded, renderedFrameCount: state.renderedFrameCount,
      hiddenFrameCount: state.hiddenFrameCount, animationScheduled: state.animationFrameId != null
    };
    document.body.dataset.metrics = JSON.stringify(snapshot);
    window.__loadingPrototype = {
      getMetrics() {
        const visualElapsedMs = timelineTime(performance.now());
        return { ...snapshot, state: state.mode, progress: state.progress, visualElapsedMs, visualPhase: L.getVisualPhase(visualElapsedMs) };
      },
      setProgress(value) { if (!state.destroyed) updateProgress(value); },
      complete: requestComplete,
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
    if (state.paused && motionMode === "reduced") {
      motionMode = "animated";
      userMotionOverride = "animate";
    }
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
