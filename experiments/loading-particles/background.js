(function exposeBackground(root) {
  "use strict";
  // Independent seed, fixed population and clock; no glyph targets or loading progress.
  function create(count, random) {
    return Array.from({ length: count }, (_, index) => ({
      u: random(), depth: random(), phase: random() * Math.PI * 2,
      band: index % 5, speed: .008 + random() * .009,
      size: .65 + random() * .7, alpha: .3 + random() * .45,
      color: index % 17 === 0 ? "#c8aa72" : index % 3 === 0 ? "#a5a0ce" : "#a8c7e5"
    }));
  }

  function position(out, particle, seconds, width, height) {
    const u = (particle.u + seconds * particle.speed) % 1;
    out.x = u * width;
    if (particle.band === 4) {
      out.y = height * (.09 + particle.depth * .59) + Math.sin(seconds * .12 + particle.phase) * 8;
    } else {
      const direction = particle.band < 2 ? 1 : -1;
      out.y = height * (.57 + Math.sin(u * 5.4 + direction * seconds * .1 + particle.band * .45) * .105)
        + (particle.depth - .5) * height * .09;
    }
    // Fade wrap seams and preserve negative space behind title and functional controls.
    const edge = Math.min(1, u * 12, (1 - u) * 12);
    const center = Math.max(0, 1 - Math.abs(out.x / width - .5) / .3);
    const titleZone = Math.max(0, 1 - Math.abs(out.y / height - .33) / .16);
    const controls = out.y > height * .73 ? center : 0;
    out.alpha = edge * (1 - center * titleZone * .85) * (1 - controls * .9);
    return out;
  }
  const api = { create, position };
  root.LoadingParticleBackground = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
