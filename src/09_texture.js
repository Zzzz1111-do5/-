/* =====================================================================
   Texture painting
   ===================================================================== */
const COL = new Uint8ClampedArray(TN * 3);
const WATER = new Uint8Array(TN);
const LIGHTS = new Float32Array(TN);
const DIRTY = new Uint8Array(N);
let dirtyList = [];
let layer = 0;
function markDirty(i) { if (!DIRTY[i]) { DIRTY[i] = 1; dirtyList.push(i); } if (!MDIRTY[i]) { MDIRTY[i] = 1; mdirtyList.push(i); } }
function markGlobeDirty(i) { if (!DIRTY[i]) { DIRTY[i] = 1; dirtyList.push(i); } }
function flushDirty() { for (let k = 0; k < dirtyList.length; k++) { const i = dirtyList[k]; DIRTY[i] = 0; recolorCell(i); } dirtyList.length = 0; }
function recolorAll() { DIRTY.fill(0); dirtyList.length = 0; for (let i = 0; i < N; i++) recolorCell(i); }

const POP_RAMP = [[40, 26, 12], [120, 66, 18], [214, 128, 30], [255, 196, 90], [255, 244, 214]];
function popColor(t) { t = clamp(t, 0, 1) * (POP_RAMP.length - 1); const k = Math.min(POP_RAMP.length - 2, t | 0), f = t - k, a = POP_RAMP[k], b = POP_RAMP[k + 1]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; }
function tempColor(T) {
  // diverging: cool blue ← neutral grey (10 °C) → warm red
  const cold = [57, 120, 214], mid = [120, 122, 126], hot = [222, 72, 64];
  if (T < 10) { const f = clamp((10 - T) / 40, 0, 1); return [mid[0] + (cold[0] - mid[0]) * f, mid[1] + (cold[1] - mid[1]) * f, mid[2] + (cold[2] - mid[2]) * f]; }
  const f = clamp((T - 10) / 25, 0, 1); return [mid[0] + (hot[0] - mid[0]) * f, mid[1] + (hot[1] - mid[1]) * f, mid[2] + (hot[2] - mid[2]) * f];
}

const IDEO_RGB = {};
function ideoRgb(n) { const I = ideoOf(n); return IDEO_RGB[I.id] || (IDEO_RGB[I.id] = hexRgb(I.color)); }
function recolorCell(ci) {
  const cy = (ci / W) | 0, cx = ci - cy * W;
  const own = S.owner[ci];
  const L = layer;
  let oL = own, oR = own, oU = own, oD = own;
  if (L === 1 || L === 5) { oL = S.owner[cy * W + (cx + W - 1) % W]; oR = S.owner[cy * W + (cx + 1) % W]; if (cy > 0) oU = S.owner[ci - W]; if (cy < H - 1) oD = S.owner[ci + W]; }
  const f0 = WORLD.forest0[ci];
  const fr = f0 > 0.01 ? clamp(S.forest[ci] / f0, 0, 1) : 1;
  const farm = S.farm[ci];
  const city = S.cityOf[ci] >= 0 ? S.cities[S.cityOf[ci]] : null;
  const nrgb = own >= 0 ? (L === 5 ? ideoRgb(S.nations[own]) : S.nations[own].rgb) : null;
  const rise = S.seaRise, tan = S.tanom;
  const tE = WORLD.tElev, tTT = WORLD.tT, tB = WORLD.tBiome, tH = WORLD.tHash, tH2 = WORLD.tHash2, tSh = WORLD.tShade;
  let density = 0;
  if (L === 3 && city && city.cells > 0) density = clamp((Math.log10(city.pop / city.cells) - 3.8) / 3.4, 0, 1);
  for (let sy = 0; sy < TS; sy++) {
    const ty = cy * TS + sy, amp = AMP_TEX[ty];
    for (let sx = 0; sx < TS; sx++) {
      const ti = ty * TW + cx * TS + sx;
      const e = tE[ti], T = tTT[ti] + tan * amp, h = tH[ti] / 255;
      let r, g, b, water = 0;
      if (e <= rise) {
        water = 1;
        const d = rise - e;
        if (T < -7 + (h - 0.5) * 3) { const s = 0.94 + h * 0.08; r = 214 * s; g = 226 * s; b = 236 * s; water = 2; }
        else {
          const k1 = Math.min(1, d / 0.1), k2 = clamp((d - 0.1) / 0.6, 0, 1);
          r = 54 + (20 - 54) * k1 + (7 - 20) * k2;
          g = 146 + (72 - 146) * k1 + (26 - 72) * k2;
          b = 168 + (124 - 168) * k1 + (66 - 124) * k2;
          if (d < 0.012) { r += 18; g += 20; b += 10; }
          const j = 0.97 + h * 0.06; r *= j; g *= j; b *= j;
        }
      } else {
        let bio = tB[ti];
        if (bio === B.ICE && T > -9.5 + (h - 0.5) * 2.5) bio = B.TUNDRA;
        const c0 = CLR[bio], c1 = FOR[bio];
        if (BIOME_FOREST[bio] > 0.05) { r = c0[0] + (c1[0] - c0[0]) * fr; g = c0[1] + (c1[1] - c0[1]) * fr; b = c0[2] + (c1[2] - c0[2]) * fr; }
        else { r = c0[0]; g = c0[1]; b = c0[2]; }
        if ((bio === B.MOUNTAIN || bio === B.TUNDRA || bio === B.TAIGA) && T < -4 + (h - 0.5) * 5) { r = 224; g = 230; b = 236; }
        if (farm > 0.02 && FARMABLE[bio]) { const k = farm * 0.55, fc = h > 0.55 ? FARM_A : FARM_B; r += (fc[0] - r) * k; g += (fc[1] - g) * k; b += (fc[2] - b) * k; }
        const s = tSh[ti] * (0.93 + h * 0.14); r *= s; g *= s; b *= s;
      }
      if (L !== 0) {
        const lum = 0.3 * r + 0.55 * g + 0.15 * b;
        if (L === 1 || L === 5) {
          if (!water) {
            if (nrgb) {
              r = lum * 0.35 + nrgb[0] * 0.62; g = lum * 0.35 + nrgb[1] * 0.62; b = lum * 0.35 + nrgb[2] * 0.62;
              const edge = (sx === 0 && oL !== own) || (sx === TS - 1 && oR !== own) || (sy === 0 && oU !== own) || (sy === TS - 1 && oD !== own);
              if (edge) { r = r * 0.45 + 255 * 0.55; g = g * 0.45 + 255 * 0.55; b = b * 0.45 + 255 * 0.55; }
            } else { r = lum * 0.55 + 20; g = lum * 0.55 + 22; b = lum * 0.55 + 28; }
          } else { r *= 0.7; g *= 0.75; b *= 0.85; }
        } else if (L === 2) {
          r = lum * 0.42 + 8; g = lum * 0.42 + 12; b = lum * 0.42 + 22;
          const h2 = tH2[ti] / 255;
          if (!water || water === 1) {
            for (let k = 0; k < 5; k++) {
              const rr = RES[k], amt = S.res[rr][ci]; const a0 = WORLD.res0[rr][ci];
              if (a0 <= 0) continue;
              const lo = k * 0.2, frac = amt / a0;
              if (h2 >= lo && h2 < lo + 0.2 * (0.35 + 0.65 * Math.sqrt(frac))) { const c = RES_RGB[rr]; r = c[0]; g = c[1]; b = c[2]; break; }
              if (amt <= 0 && h2 >= lo && h2 < lo + 0.05) { r = 70; g = 70; b = 76; break; }
            }
            if (water === 1 && WORLD.fish[ci] > 0 && h2 > 0.93) { r = 150; g = 200; b = 255; }
          }
        } else if (L === 3) {
          if (!water) { if (city) { const c = popColor(density); r = c[0]; g = c[1]; b = c[2]; } else { r = lum * 0.4 + 6; g = lum * 0.4 + 8; b = lum * 0.4 + 14; } }
          else { r *= 0.5; g *= 0.55; b *= 0.7; }
        } else if (L === 4) {
          const c = tempColor(T); r = c[0] * 0.85 + lum * 0.15; g = c[1] * 0.85 + lum * 0.15; b = c[2] * 0.85 + lum * 0.15;
          const sm = S.smog[ci];
          if (sm > 0.05 && !water && h > 0.35) { const k = Math.min(0.75, sm); r += (96 - r) * k; g += (80 - g) * k; b += (56 - b) * k; }
        }
      }
      const o = ti * 3; COL[o] = r; COL[o + 1] = g; COL[o + 2] = b;
      WATER[ti] = water;
    }
  }
}

function buildLights() {
  LIGHTS.fill(0);
  const tH = WORLD.tHash;
  const cmap = new Map(); for (const c of S.cities) cmap.set(c.id, c);
  for (const c of S.cities) {
    const n = S.nations[c.n];
    const elec = n.mult.light;
    const inten = Math.min(1.3, Math.log10(c.pop / 16000 + 1) * 0.42) * (0.3 + 0.7 * elec);
    const rad = clamp(1.4 + Math.sqrt(c.pop / 8e5) * 1.5, 1.4, 11);
    const tx0 = (c.lon + PI) / TAU * TW, ty0 = (PI / 2 - c.lat) / PI * TH;
    const cl = Math.max(0.2, Math.cos(c.lat));
    const ry = Math.ceil(rad), rx = Math.ceil(rad / cl);
    const inv = 1 / (rad * rad * 0.45);
    for (let dy = -ry; dy <= ry; dy++) {
      const ty = Math.floor(ty0) + dy; if (ty < 0 || ty >= TH) continue;
      const fy = ty + 0.5 - ty0;
      for (let dx = -rx; dx <= rx; dx++) {
        const txr = Math.floor(tx0) + dx, tx = ((txr % TW) + TW) % TW;
        const fx = (txr + 0.5 - tx0) * cl;
        const d2 = fx * fx + fy * fy;
        if (d2 > rad * rad) continue;
        const ti = ty * TW + tx;
        if (WATER[ti]) continue;
        const hv = tH[ti] / 255;
        LIGHTS[ti] += inten * Math.exp(-d2 * inv) * (hv > 0.35 ? 0.4 + 0.6 * hv : 0.12);
      }
    }
    if (n.mult.rail || n.mult.light >= 1) {
      for (const id of c.links) {
        const o = cmap.get(id); if (!o || o.id < c.id) continue;
        let dl = o.lon - c.lon; if (dl > PI) dl -= TAU; if (dl < -PI) dl += TAU;
        const steps = 24;
        for (let s = 1; s < steps; s++) {
          const f = s / steps, lat = c.lat + (o.lat - c.lat) * f, lon = c.lon + dl * f;
          const tx = ((Math.floor((lon + PI) / TAU * TW) % TW) + TW) % TW, ty = clamp(Math.floor((PI / 2 - lat) / PI * TH), 0, TH - 1);
          const ti = ty * TW + tx;
          if (!WATER[ti]) LIGHTS[ti] += 0.22 * elec;
        }
      }
    }
  }
  for (let i = 0; i < TN; i++) if (LIGHTS[i] > 1.6) LIGHTS[i] = 1.6;
}

