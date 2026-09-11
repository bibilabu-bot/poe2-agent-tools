(function exposeBackground(root) {
  "use strict";
  const palette = ["#f7fbff", "#cfe6f7", "#b9b2e2"];
  // Independent seed, fixed population and clock; no glyph targets or loading progress.
  function create(count, random) {
    const rows = count > 4000 ? 32 : 25;
    const columns = Math.ceil(count / rows);
    return Array.from({ length: count }, (_, index) => ({
      u: Math.floor(index / rows) / columns, column: Math.floor(index / rows),
      cross: (index % rows) / (rows - 1) * 2 - 1,
      jitter: (random() - .5) * 1.6, band: index % 5,
      size: .52 + random() * .5, alpha: .68 + random() * .32,
      color: index % 29 === 0 ? "#f1dfb8" : palette[index % 3]
    }));
  }

  function createColumns(count) {
    const rows = count > 4000 ? 32 : 25;
    const columns = Math.ceil(count / rows);
    return Array.from({ length: columns }, (_, index) => ({ base: index / columns }));
  }

  function prepareColumn(out, base, seconds, width, height) {
    const u = (base + seconds * .009) % 1;
    const angle = u * Math.PI * 3.2 - seconds * .24;
    out.x = u * width;
    out.axis = height * (.47 - (u - .5) * .11);
    out.sine = Math.sin(angle); out.cosine = Math.cos(angle);
    out.radius = height * .25;
    out.edge = Math.min(1, u * 12, (1 - u) * 12);
    out.warp = Math.sin(u * 8 + seconds * .18) * 7;
    return out;
  }

  function prepare(columns, seconds, width, height) {
    for (const column of columns) prepareColumn(column, column.base, seconds, width, height);
  }

  function position(out, particle, seconds, width, height, columns) {
    // Every axial slice contains a complete depth profile, creating a twisted surface.
    // The renderer caches trigonometry per column; the pure fallback reuses `out`.
    const column = columns ? columns[particle.column] : prepareColumn(out, particle.u, seconds, width, height);
    const cross = particle.cross;
    const depth = column.cosine * cross;
    const edge = column.edge;
    out.x = column.x;
    out.y = column.axis + column.sine * cross * column.radius + (1 - cross * cross) * column.warp + particle.jitter;
    out.scale = .8 + (depth + 1) * .22;
    // Fade wrap seams and preserve negative space behind title and functional controls.
    const center = Math.max(0, 1 - Math.abs(out.x / width - .5) / .3);
    const titleZone = Math.max(0, 1 - Math.abs(out.y / height - .33) / .16);
    const controls = out.y > height * .73 ? center : 0;
    out.alpha = edge * (.44 + (depth + 1) * .24)
      * (1 - center * titleZone * .72) * (1 - controls * .9);
    return out;
  }
  const api = { create, createColumns, prepare, position };
  root.LoadingParticleBackground = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
