(function exposeParticleLogic(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LoadingParticleLogic = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createParticleLogic() {
  "use strict";

  const QUALITY_PRESETS = Object.freeze({
    balanced: Object.freeze({ titleMax: 2400, waveMax: 520, sampleStep: 3, dprMax: 1.5, glow: 0.48 }),
    cinematic: Object.freeze({ titleMax: 4400, waveMax: 980, sampleStep: 2, dprMax: 2, glow: 0.72 })
  });
  const STATES = Object.freeze(["enter", "loading", "complete", "error"]);
  const TRANSITIONS = Object.freeze({
    enter: new Set(["loading", "error"]),
    loading: new Set(["complete", "error", "enter"]),
    complete: new Set(["enter"]),
    error: new Set(["enter"])
  });

  function createSeededRandom(seed) {
    let value = (Number(seed) || 0) >>> 0;
    return function random() {
      value += 0x6d2b79f5;
      let next = value;
      next = Math.imul(next ^ (next >>> 15), next | 1);
      next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
      return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clampProgress(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.min(100, Math.max(0, numeric));
  }

  function transitionState(current, next) {
    if (!STATES.includes(current) || !STATES.includes(next)) throw new TypeError("Unknown loading state");
    if (!TRANSITIONS[current].has(next)) throw new Error(`Invalid transition: ${current} -> ${next}`);
    return next;
  }

  function selectQuality(requested, constraints) {
    const options = constraints || {};
    if (options.reducedMotion) return "balanced";
    if (requested !== "cinematic") return "balanced";
    return options.deviceMemory != null && options.deviceMemory < 4 || options.cores != null && options.cores < 4
      ? "balanced"
      : "cinematic";
  }

  function shouldDegrade(samples, thresholdMs, minimumSlowFrames) {
    const threshold = thresholdMs == null ? 24 : thresholdMs;
    const minimum = minimumSlowFrames == null ? 45 : minimumSlowFrames;
    if (!Array.isArray(samples) || samples.length < minimum) return false;
    let slow = 0;
    let total = 0;
    const start = Math.max(0, samples.length - minimum);
    for (let i = start; i < samples.length; i += 1) {
      const sample = Number(samples[i]);
      if (!Number.isFinite(sample)) continue;
      total += 1;
      if (sample > threshold) slow += 1;
    }
    return total >= minimum && slow / total >= 0.72;
  }

  function selectTargetPoints(alpha, width, height, step, maxPoints, random) {
    if (!(alpha instanceof Uint8ClampedArray) || alpha.length < width * height) throw new TypeError("alpha must cover width × height");
    const stride = Math.max(1, Math.floor(step || 1));
    const candidates = [];
    for (let y = 0; y < height; y += stride) {
      for (let x = 0; x < width; x += stride) {
        if (alpha[y * width + x] > 110) candidates.push({ x, y });
      }
    }
    const limit = Math.max(0, Math.floor(maxPoints || 0));
    const rng = random || Math.random;
    for (let i = candidates.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      const point = candidates[i];
      candidates[i] = candidates[j];
      candidates[j] = point;
    }
    if (candidates.length > limit) candidates.length = limit;
    return candidates;
  }

  function assignTargets(count, targets, random) {
    const safeCount = Math.max(0, Math.floor(count));
    if (!Array.isArray(targets) || targets.length === 0) return [];
    const rng = random || Math.random;
    const assignments = new Array(Math.min(safeCount, targets.length));
    const offset = Math.floor(rng() * targets.length);
    for (let i = 0; i < assignments.length; i += 1) assignments[i] = targets[(i + offset) % targets.length];
    return assignments;
  }

  function capCounts(titleCount, waveCount, qualityName) {
    const preset = QUALITY_PRESETS[qualityName] || QUALITY_PRESETS.balanced;
    return {
      title: Math.min(preset.titleMax, Math.max(0, Math.floor(titleCount || 0))),
      wave: Math.min(preset.waveMax, Math.max(0, Math.floor(waveCount || 0)))
    };
  }

  function chooseMotionMode(systemReduced, userOverride) {
    if (userOverride === "animate") return "animated";
    if (userOverride === "reduce") return "reduced";
    return systemReduced ? "reduced" : "animated";
  }

  function createLifecycle(scheduler, canceller) {
    let destroyed = false;
    let paused = false;
    let frameId = null;
    function schedule(callback) {
      if (destroyed || paused || frameId != null) return false;
      frameId = scheduler(function scheduledFrame(time) {
        frameId = null;
        if (!destroyed && !paused) callback(time);
      });
      return true;
    }
    return {
      schedule,
      pause() { paused = true; if (frameId != null) canceller(frameId); frameId = null; },
      resume() { if (!destroyed) paused = false; },
      destroy() { destroyed = true; paused = true; if (frameId != null) canceller(frameId); frameId = null; },
      getState() { return { destroyed, paused, scheduled: frameId != null }; }
    };
  }

  return { QUALITY_PRESETS, STATES, createSeededRandom, clampProgress, transitionState, selectQuality, shouldDegrade, selectTargetPoints, assignTargets, capCounts, chooseMotionMode, createLifecycle };
});
