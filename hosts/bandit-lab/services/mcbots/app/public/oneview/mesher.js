'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./blocks.js'));
  else (root.OV = root.OV || {}).mesher = factory(root.OV.blocks);
})(typeof self !== 'undefined' ? self : globalThis, function (blocks) {
  // Face corners per direction (-x, +x, -y, +y, -z, +z), counter-clockwise seen from outside.
  const CORNERS = Uint8Array.from([
    [0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0], [1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1],
    [0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1], [0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0],
    [1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
  ].flat());
  const SHADE = [2, 2, 1, 0, 3, 3]; // direction -> slot in a block's colours: top, bottom, +-x, +-z
  const LIGHT = [1, 0.5, 0.8, 0.65];
  // Border layer of neighbour k: first cell and strides over the two border axes (key = a * 16 + b).
  const NB_BASE = [15, 0, 3840, 0, 240, 0], NB_A = [256, 256, 16, 16, 256, 256], NB_B = [16, 16, 1, 1, 1, 1];
  // Upper bound of faces in any section: 11520 inner cell pairs + 1536 border faces (the 3D checkerboard gives 12288); 4 vertices each stay under 65536.
  const MAXF = 13056;
  const POS = new Uint8Array(MAXF * 12), COL = new Uint8Array(MAXF * 12), IDX = new Uint16Array(MAXF * 6), SOLID = new Uint8Array(4096);

  // Is the neighbour's border cell solid? null = not loaded: a wall everywhere but above.
  function layer(n, k, capY) {
    const out = new Uint8Array(256);
    if (!n) return k === 3 ? out : out.fill(1);
    const dr = n.palette.map((s) => (blocks.drawn(blocks.nameOf(s)) ? 1 : 0));
    const side = k !== 2 && k !== 3;
    for (let a = 0; a < 16; a++) {
      if (side && a >= capY) continue; // side neighbours are cut at the same height as the section
      for (let b = 0; b < 16; b++) out[(a << 4) | b] = dr[n.idx ? n.idx[NB_BASE[k] + a * NB_A[k] + b * NB_B[k]] : 0];
    }
    return out;
  }

  // shortcut: every drawn block is an opaque full cube (water, glass, stairs); upgrade with a second translucent mesh if the owner misses seeing through windows.
  function meshSection(sec, nb, capY = 16) {
    const pal = sec.palette, idx = sec.idx;
    const dr = new Uint8Array(pal.length), shade = new Uint8Array(pal.length * 12);
    let any = false;
    for (let p = 0; p < pal.length; p++) {
      const name = blocks.nameOf(pal[p]);
      if (!blocks.drawn(name)) continue;
      any = dr[p] = 1;
      const c = blocks.rgb(name);
      for (let s = 0; s < 4; s++) for (let j = 0; j < 3; j++) shade[p * 12 + s * 3 + j] = Math.round(c[j] * LIGHT[s]);
    }
    const lim = Math.max(0, Math.min(16, capY)) << 8;
    if (!any || !lim) return null;
    SOLID.fill(0);
    for (let i = 0; i < lim; i++) SOLID[i] = dr[idx ? idx[i] : 0];
    const L = [0, 1, 2, 3, 4, 5].map((k) => layer(nb[k], k, capY));
    let n = 0;
    for (let i = 0; i < lim; i++) {
      if (!SOLID[i]) continue;
      const x = i & 15, z = (i >> 4) & 15, y = i >> 8, p = idx ? idx[i] : 0;
      for (let d = 0; d < 6; d++) {
        let hidden;
        switch (d) {
          case 0: hidden = x ? SOLID[i - 1] : L[0][(y << 4) | z]; break;
          case 1: hidden = x < 15 ? SOLID[i + 1] : L[1][(y << 4) | z]; break;
          case 2: hidden = y ? SOLID[i - 256] : L[2][(z << 4) | x]; break;
          case 3: hidden = y < 15 ? SOLID[i + 256] : L[3][(z << 4) | x]; break;
          case 4: hidden = z ? SOLID[i - 16] : L[4][(y << 4) | x]; break;
          default: hidden = z < 15 ? SOLID[i + 16] : L[5][(y << 4) | x];
        }
        if (hidden) continue;
        const v = n * 4, o = v * 3, s = p * 12 + SHADE[d] * 3;
        for (let q = 0; q < 4; q++) for (let j = 0; j < 3; j++) {
          POS[o + q * 3 + j] = CORNERS[d * 12 + q * 3 + j] + (j === 0 ? x : j === 1 ? y : z);
          COL[o + q * 3 + j] = shade[s + j];
        }
        const t = n * 6;
        IDX[t] = v; IDX[t + 1] = v + 1; IDX[t + 2] = v + 2; IDX[t + 3] = v; IDX[t + 4] = v + 2; IDX[t + 5] = v + 3;
        n++;
      }
    }
    return n ? {pos: POS.slice(0, n * 12), col: COL.slice(0, n * 12), idx: IDX.slice(0, n * 6)} : null;
  }
  return {meshSection};
});
