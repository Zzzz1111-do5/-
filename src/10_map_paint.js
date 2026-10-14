/* =====================================================================
   Pixel-art world map (16 px per simulation cell)
   ===================================================================== */
const PX = 16, MW = W * PX, MH = H * PX;
const mapCanvas = document.createElement('canvas');
mapCanvas.width = MW; mapCanvas.height = MH;
const mctx = mapCanvas.getContext('2d');
const mapImg = mctx.createImageData(MW, MH);
const M32 = new Uint32Array(mapImg.data.buffer);
const MWATER = new Uint8Array(MW * MH);
const MDIRTY = new Uint8Array(N);
let mdirtyList = [];
let HSEED = 0;
const CROPS = [[214, 186, 92], [118, 162, 62], [168, 142, 84], [190, 198, 88]];
function hash2(x, y) { let h = (Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ HSEED) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; }
function treePixel(px, py, sp, cov) {
  const gx = Math.floor(px / sp), gy = Math.floor(py / sp), hs = hash2(gx * 3 + 1, gy * 5 + 7);
  if ((hs & 255) / 255 >= cov) return 0;
  const ox = gx * sp + 1 + ((hs >>> 8) % (sp - 2)), oy = gy * sp + 1 + ((hs >>> 10) % (sp - 2));
  const dx = px - ox, dy = py - oy;
  if (dx === 0 && dy === -1) return 2;
  if (dy === 0 && dx >= -1 && dx <= 1) return 1;
  if (dy === 1 && (dx === 0 || dx === 1)) return 3;
  return 0;
}
function paintMapCell(ci) {
  const cy = (ci / W) | 0, cx = ci - cy * W;
  const tE = WORLD.tElev, tTT = WORLD.tT, tB = WORLD.tBiome;
  const rise = S.seaRise, tan = S.tanom;
  const f0 = WORLD.forest0[ci], fr = f0 > 0.01 ? clamp(S.forest[ci] / f0, 0, 1) : 1;
  const farm = S.farm[ci], smog = S.smog[ci];
  for (let py = cy * PX; py < cy * PX + PX; py++) {
    const tyf = (py + 0.5) / 4 - 0.5;
    let ty0 = Math.floor(tyf), fy = tyf - ty0, ty1 = ty0 + 1;
    if (ty0 < 0) { ty0 = 0; fy = 0; }
    if (ty1 > TH - 1) ty1 = TH - 1;
    const r0 = ty0 * TW, r1 = ty1 * TW, amp = AMP_TEX[clamp(Math.round(tyf), 0, TH - 1)];
    for (let px = cx * PX; px < cx * PX + PX; px++) {
      const txf = (px + 0.5) / 4 - 0.5;
      const txfl = Math.floor(txf), fx = txf - txfl;
      const tx0 = (txfl + TW) % TW, tx1 = (tx0 + 1) % TW;
      const e00 = tE[r0 + tx0], e10 = tE[r0 + tx1], e01 = tE[r1 + tx0], e11 = tE[r1 + tx1];
      const ea = e00 + (e10 - e00) * fx, eb = e01 + (e11 - e01) * fx;
      const e = ea + (eb - ea) * fy;
      const mi = py * MW + px;
      const hh = hash2(px, py), h = (hh >>> 8) & 255;
      const jx = Math.round(txf + ((h & 3) - 1.5) * 0.62), jy = clamp(Math.round(tyf + (((h >> 2) & 3) - 1.5) * 0.62), 0, TH - 1);
      const tn = jy * TW + ((jx % TW) + TW) % TW;
      const ta = tTT[r0 + tx0] + (tTT[r0 + tx1] - tTT[r0 + tx0]) * fx, tb = tTT[r1 + tx0] + (tTT[r1 + tx1] - tTT[r1 + tx0]) * fx;
      const T = ta + (tb - ta) * fy + tan * amp;
      let r, g, b;
      if (e <= rise) {
        MWATER[mi] = 1;
        const d = rise - e;
        if (T < -7 + ((h >> 4) / 16 - 0.5) * 3) { r = 214; g = 228; b = 240; if (h & 1) { r -= 12; g -= 9; b -= 4; } }
        else {
          if (d < 0.006) { r = 96; g = 182; b = 198; }
          else if (d < 0.03) { r = 58; g = 150; b = 178; }
          else if (d < 0.1) { r = 36; g = 108; b = 158; }
          else if (d < 0.35) { r = 22; g = 68; b = 126; }
          else { r = 13; g = 44; b = 94; }
          if (d >= 0.006 && ((px + (py >> 1) * 3 + (hh & 7)) & 15) === 0 && ((py & 3) === 0)) { r += 16; g += 18; b += 20; }
        }
      } else {
        MWATER[mi] = 0;
        let bio = tB[tn];
        if (bio === B.SHALLOW || bio === B.DEEP) bio = B.GRASS;
        if (bio === B.ICE && T > -9.5 + ((h >> 4) / 16 - 0.5) * 2.5) bio = B.TUNDRA;
        const c0 = CLR[bio], c1 = FOR[bio];
        r = c0[0]; g = c0[1]; b = c0[2];
        if (e - rise < 0.005 && bio !== B.ICE && bio !== B.MOUNTAIN && T > -2) { r = 224; g = 208; b = 154; if (h & 1) { r -= 8; g -= 8; b -= 6; } }
        else {
          let snow = false;
          if ((bio === B.MOUNTAIN || bio === B.TUNDRA || bio === B.TAIGA) && T < -4 + ((h >> 4) / 16 - 0.5) * 5) { r = 230; g = 236; b = 242; snow = true; }
          const dex = (e10 - e00) * (1 - fy) + (e11 - e01) * fy, dey = eb - ea;
          let s = clamp(1 + (dex + dey) * (bio === B.MOUNTAIN ? 16 : 7), 0.68, 1.36) * (0.94 + (h & 15) / 15 * 0.1);
          let field = false;
          if (!snow && farm > 0.04 && FARMABLE[bio]) {
            const hp = hash2(px >> 3, (py >> 3) + 9001);
            if ((hp & 255) / 255 < farm * 0.85) {
              field = true;
              const lx = px & 7, ly = py & 7, kind = (hp >>> 8) & 3;
              if (lx === 0 || ly === 0) { r = 136; g = 118; b = 80; }
              else { const cc = CROPS[kind], row = ((kind & 1) ? lx : ly) & 1, k = row ? 1 : 0.84; r = cc[0] * k; g = cc[1] * k; b = cc[2] * k; }
              s = 1;
            }
          }
          if (!field && !snow && BIOME_FOREST[bio] > 0.05) {
            const cov = fr * (bio === B.SAVANNA ? 0.35 : bio === B.GRASS ? 0.12 : 0.95);
            const tp = treePixel(px, py, bio === B.JUNGLE ? 3 : 4, cov);
            if (tp === 1) { r = c1[0] * 0.8; g = c1[1] * 0.8; b = c1[2] * 0.8; s = 1; }
            else if (tp === 2) { r = c1[0] * 1.2 + 12; g = c1[1] * 1.2 + 14; b = c1[2] * 1.1 + 6; s = 1; }
            else if (tp === 3) { r = c1[0] * 0.45; g = c1[1] * 0.45; b = c1[2] * 0.42; s = 1; }
            else if (fr > 0.3 && BIOME_FOREST[bio] > 0.5) { r = (c0[0] + c1[0]) / 2; g = (c0[1] + c1[1]) / 2; b = (c0[2] + c1[2]) / 2; }
          }
          r *= s; g *= s; b *= s;
          if (smog > 0.15 && (h & 3) === 0) { const k = Math.min(0.5, smog * 0.6); r += (90 - r) * k; g += (82 - g) * k; b += (70 - b) * k; }
        }
      }
      M32[mi] = 0xff000000 | (clamp(b | 0, 0, 255) << 16) | (clamp(g | 0, 0, 255) << 8) | clamp(r | 0, 0, 255);
    }
  }
}
function paintMapAll() { MDIRTY.fill(0); mdirtyList = []; for (let i = 0; i < N; i++) paintMapCell(i); mctx.putImageData(mapImg, 0, 0); }
function flushMapDirty() {
  const list = mdirtyList; mdirtyList = [];
  for (const i of list) { MDIRTY[i] = 0; paintMapCell(i); }
  if (list.length > 500) { mctx.putImageData(mapImg, 0, 0); return; }
  for (const i of list) { const cy = (i / W) | 0, cx = i - cy * W; mctx.putImageData(mapImg, 0, 0, cx * PX, cy * PX, PX, PX); }
}

