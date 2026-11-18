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
  const LOOSE = Uint8Array.from(LIGHT.flatMap((l) => [255, 42, 42].map((c) => Math.round(c * l)))); // loose dirt (0xff2a2a) per light slot
  // Border layer of neighbour k: first cell and strides over the two border axes (key = a * 16 + b).
  const NB_BASE = [15, 0, 3840, 0, 240, 0], NB_A = [256, 256, 16, 16, 256, 256], NB_B = [16, 16, 1, 1, 1, 1];
  // Upper bound of faces in any section: 11520 inner cell pairs + 1536 border faces (the 3D checkerboard gives 12288); 4 vertices each stay under 65536.
  const MAXF = 13056;
  const POS = new Uint8Array(MAXF * 12), COL = new Uint8Array(MAXF * 12), IDX = new Uint16Array(MAXF * 6), SOLID = new Uint8Array(4096), HID = new Uint8Array(6);

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
  // lid: this section holds the cut's top layer although capY is 16. loose: colour loose dirt red (it is counted either way).
  function meshSection(sec, nb, capY = 16, {lid = false, loose = true} = {}) {
    const pal = sec.palette, idx = sec.idx;
    const dr = new Uint8Array(pal.length), shade = new Uint8Array(pal.length * 12), dirt = new Uint8Array(pal.length);
    let any = false;
    for (let p = 0; p < pal.length; p++) {
      const name = blocks.nameOf(pal[p]);
      if (!blocks.drawn(name)) continue;
      any = dr[p] = 1;
      dirt[p] = name === 'dirt' ? 1 : 0;
      const c = blocks.rgb(name);
      for (let s = 0; s < 4; s++) for (let j = 0; j < 3; j++) shade[p * 12 + s * 3 + j] = Math.round(c[j] * LIGHT[s]);
    }
    const lim = Math.max(0, Math.min(16, capY)) << 8;
    if (!any || !lim) return null;
    SOLID.fill(0);
    for (let i = 0; i < lim; i++) SOLID[i] = dr[idx ? idx[i] : 0];
    const L = [0, 1, 2, 3, 4, 5].map((k) => layer(nb[k], k, capY));
    // The top face of the cut layer is always drawn (the lid); lidY is -1 when nothing is cut.
    const lidY = capY < 16 || lid ? (lim >> 8) - 1 : -1;
    let n = 0, looseN = 0;
    for (let i = 0; i < lim; i++) {
      if (!SOLID[i]) continue;
      const x = i & 15, z = (i >> 4) & 15, y = i >> 8, p = idx ? idx[i] : 0;
      HID[0] = x ? SOLID[i - 1] : L[0][(y << 4) | z];
      HID[1] = x < 15 ? SOLID[i + 1] : L[1][(y << 4) | z];
      HID[2] = y ? SOLID[i - 256] : L[2][(z << 4) | x];
      HID[3] = y === lidY ? 0 : y < 15 ? SOLID[i + 256] : L[3][(z << 4) | x];
      HID[4] = z ? SOLID[i - 16] : L[4][(y << 4) | x];
      HID[5] = z < 15 ? SOLID[i + 16] : L[5][(y << 4) | x];
      const isLoose = dirt[p] && HID[0] + HID[1] + HID[4] + HID[5] <= 1;
      if (isLoose) looseN++;
      const red = isLoose && loose, src = red ? LOOSE : shade;
      for (let d = 0; d < 6; d++) {
        if (HID[d]) continue;
        // lid over a real drawn block: darker, so rock that was cut away reads as cut
        const dim = d === 3 && y === lidY && (y < 15 ? dr[idx ? idx[i + 256] : 0] : L[3][(z << 4) | x]) ? 0.3 : 1;
        const v = n * 4, o = v * 3, s = red ? SHADE[d] * 3 : p * 12 + SHADE[d] * 3;
        for (let q = 0; q < 4; q++) for (let j = 0; j < 3; j++) {
          POS[o + q * 3 + j] = CORNERS[d * 12 + q * 3 + j] + (j === 0 ? x : j === 1 ? y : z);
          COL[o + q * 3 + j] = dim === 1 ? src[s + j] : Math.round(src[s + j] * dim);
        }
        const t = n * 6;
        IDX[t] = v; IDX[t + 1] = v + 1; IDX[t + 2] = v + 2; IDX[t + 3] = v; IDX[t + 4] = v + 2; IDX[t + 5] = v + 3;
        n++;
      }
    }
    return n ? {pos: POS.slice(0, n * 12), col: COL.slice(0, n * 12), idx: IDX.slice(0, n * 6), loose: looseN} : null;
  }
  return {meshSection};
});
