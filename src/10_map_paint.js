/* =====================================================================
   Painted world map (16 map px per simulation cell)
   One resolution-independent terrain shader, paintRegion(), renders both
   the 3072×1536 base bitmap (1 sample per map px) and the hi-res detail
   tiles used when zoomed in (R samples per map px). Coasts follow a
   Catmull-Rom elevation surface plus fractal noise (anti-aliased, with
   beaches and surf); relief is hill-shaded from the north-west off a
   B-spline-smoothed surface with ridges and valley occlusion; snow, ice
   sheets and broken pack ice follow temperature; water is graded
   continuously by depth. Dirty cells repaint within a time budget.
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
// overlay masks (0..255 per texel), kept in step with the painted map:
//   LMASK: sea coverage at 2 map px per texel, accumulated from the anti-aliased coast while painting — traced into
//          per-cell shoreline shapes that clip the land data layers (coastClass)
//   WMASK: open-water glint strength per 4-px texel (fades out in the shallows and under sea ice) — drawWaterGlints
const LMASK = { d: new Uint8ClampedArray(MW * MH / 4), w: MW / 2, h: MH / 2 }, WMASK = new Uint8Array(TN);
// per-cell shoreline class / traced shape for overlays (see coastClass), reset around every repainted cell
const CCLS = new Uint8Array(N), CPOLY = new Array(N).fill(null);
function coastInvalidate(ci) { const cy = (ci / W) | 0, cx = ci - cy * W; for (let dy = -1; dy <= 1; dy++) { const y = cy + dy; if (y >= 0 && y < H) for (let dx = -1; dx <= 1; dx++) { const j = y * W + (cx + dx + W) % W; CCLS[j] = 0; CPOLY[j] = null; } } }
function wmaskCell(ci) {
  const cy = (ci / W) | 0, cx = ci - cy * W, tE = WORLD.tElev, tT = WORLD.tT, d = WMASK, rise = S.seaRise, tan = S.tanom;
  for (let ty = cy * TS; ty < cy * TS + TS; ty++) {
    const ta = tan * AMP_TEX[ty];
    for (let tx = cx * TS; tx < cx * TS + TS; tx++) {
      const i = ty * TW + tx;
      let a = (rise - tE[i] - 0.012) * 11; a = a <= 0 ? 0 : a >= 1 ? 1 : a * a * (3 - 2 * a);
      const ice = (-0.45 - (-5.6 - tT[i] - ta) * 0.42 - iceNoise(tx * 4 + 2, ty * 4 + 2)) * 2.5; a *= ice <= 0 ? 0 : ice >= 1 ? 1 : ice;
      d[i] = a * 255;
    }
  }
}
let HSEED = 0;
const CROPS = [[214, 186, 92], [118, 162, 62], [168, 142, 84], [190, 198, 88], [150, 170, 70], [204, 170, 70]];
function hash2(x, y) { let h = (Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ HSEED) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; }

// ---- tileable value-noise textures (512² wraps the 3072×1536 map exactly), C1-smooth via Catmull-Rom ----
const NT = 512, NTM = NT - 1;
let NZF = null, NZC = null;
function crw(t) { const t2 = t * t, t3 = t2 * t; return [(-t3 + 2 * t2 - t) / 2, (3 * t3 - 5 * t2 + 2) / 2, (-3 * t3 + 4 * t2 + t) / 2, (t3 - t2) / 2]; }
function noiseTile(seed, oct) {
  const out = new Float32Array(NT * NT), rnd = mulberry32(seed), row = new Float32Array(NT * 4);
  for (const [p, a] of oct) {
    const n = NT / p, L = new Float32Array(n * n), RX = new Float32Array(n * NT);
    for (let k = 0; k < L.length; k++) L[k] = rnd() * 2 - 1;
    for (let x = 0; x < NT; x++) { const u = x / p, i = Math.floor(u), w = crw(u - i); for (let k = 0; k < 4; k++) row[x * 4 + k] = w[k]; }
    for (let j = 0; j < n; j++) for (let x = 0; x < NT; x++) {
      const i = Math.floor(x / p), o = j * n;
      RX[j * NT + x] = row[x * 4] * L[o + (i + n - 1) % n] + row[x * 4 + 1] * L[o + i % n] + row[x * 4 + 2] * L[o + (i + 1) % n] + row[x * 4 + 3] * L[o + (i + 2) % n];
    }
    for (let y = 0; y < NT; y++) {
      const v = y / p, j = Math.floor(v), w = crw(v - j), r0 = ((j + n - 1) % n) * NT, r1 = (j % n) * NT, r2 = ((j + 1) % n) * NT, r3 = ((j + 2) % n) * NT;
      for (let x = 0; x < NT; x++) out[y * NT + x] += (w[0] * RX[r0 + x] + w[1] * RX[r1 + x] + w[2] * RX[r2 + x] + w[3] * RX[r3 + x]) * a;
    }
  }
  let s2 = 0; for (let k = 0; k < out.length; k++) s2 += out[k] * out[k];
  const sc = 0.42 / Math.sqrt(s2 / out.length); for (let k = 0; k < out.length; k++) out[k] = clamp(out[k] * sc, -1, 1);
  return out;
}
// coarse noise for the sea-ice margin: two samples of the 512-px tile at scales 1 and 5/6 (both wrap the 3072-px map
// exactly), so the floe edge no longer repeats six times around the world
function iceNoise(x, y) { return (NZC[(y & NTM) * NT + (x & NTM)] + NZC[((((y * 5) / 6) | 0) + 211 & NTM) * NT + ((((x * 5) / 6) | 0) & NTM)]) * 0.8; }
function initNoise() {
  NZF = noiseTile(7717, [[16, 1], [8, 0.62], [4, 0.36], [2, 0.16]]);
  NZC = noiseTile(4241, [[256, 1], [128, 0.7], [64, 0.45], [32, 0.25]]);
}

// ---- palettes ----
const MG = [[0,0,0],[0,0,0],[234,240,247],[146,140,114],[102,116,82],[118,144,74],[130,160,72],[220,192,136],[184,166,92],[90,130,58],[124,112,98],[170,160,104]];
const MF = [[0,0,0],[0,0,0],[234,240,247],[132,128,108],[34,72,54],[44,98,46],[86,128,52],[212,184,128],[106,126,54],[24,90,42],[64,84,62],[150,146,96]];
const TREE_COV = [0, 0, 0, 0, 0.95, 0.95, 0.12, 0, 0.35, 0.97, 0.3, 0];
const WLUT = new Float32Array(256 * 3);
(() => {
  const st = [[0, 120, 208, 206], [0.06, 78, 184, 200], [0.13, 50, 152, 188], [0.22, 33, 118, 172], [0.32, 25, 90, 152], [0.5, 19, 64, 126], [0.75, 15, 50, 110], [1, 12, 40, 96]];
  for (let i = 0; i < 256; i++) {
    const k = i / 255; let s = 0; while (s < st.length - 2 && st[s + 1][0] < k) s++;
    const a = st[s], b = st[s + 1], f = clamp((k - a[0]) / (b[0] - a[0]), 0, 1), q = f * f * (3 - 2 * f);
    for (let c = 0; c < 3; c++) WLUT[i * 3 + c] = a[c + 1] + (b[c + 1] - a[c + 1]) * q;
  }
})();
// light from the north-west, ~38° above the horizon
const LZ = 0.62, LXY = -Math.sqrt((1 - LZ * LZ) / 2);

// ---- Catmull-Rom resampling of a texture onto a sample grid ----
// texel i is centred at (i + 0.5) * sc map px; x wraps every tw texels, y wraps if wy else clamps.
// Writes nx × ny samples (R per map px, sample s centred at X0 + (s + 0.5) / R) into out, stride nx.
// bs: cubic B-spline weights instead (C2, approximating — a smoothed surface for shading).
let CR_CX = new Int32Array(64), CR_XI = new Int32Array(64), CR_XW = new Float32Array(256), CR_COL = new Float32Array(64);
function crPatch(src, tw, th, sc, wy, X0, Y0, nx, ny, R, out, bs) {
  if (R * sc === 1 && !bs && X0 === Math.floor(X0) && Y0 === Math.floor(Y0)) {   // samples sit on texel centres: plain copy
    for (let r = 0; r < ny; r++) {
      let j = Y0 + r; j = wy ? ((j % th) + th) % th : j < 0 ? 0 : j >= th ? th - 1 : j;
      const so = j * tw, ro = r * nx; let x = ((X0 % tw) + tw) % tw;
      for (let s = 0; s < nx; s++) { out[ro + s] = src[so + x]; if (++x === tw) x = 0; }
    }
    return;
  }
  const inv = 1 / (R * sc), u0 = X0 / sc - 0.5 + 0.5 * inv, base = Math.floor(u0) - 1;
  const nc = Math.floor(u0 + (nx - 1) * inv) + 4 - base;
  if (CR_CX.length < nc) { CR_CX = new Int32Array(nc * 2); CR_COL = new Float32Array(nc * 2); }
  if (CR_XI.length < nx) { CR_XI = new Int32Array(nx * 2); CR_XW = new Float32Array(nx * 8); }
  const CX = CR_CX, XI = CR_XI, XW = CR_XW, COL = CR_COL;
  for (let c = 0; c < nc; c++) CX[c] = (((base + c) % tw) + tw) % tw;
  for (let s = 0; s < nx; s++) {
    const u = u0 + s * inv, t0 = Math.floor(u), t = u - t0, t2 = t * t, t3 = t2 * t;
    XI[s] = t0 - 1 - base;
    if (bs) { const m = 1 - t; XW[s * 4] = m * m * m / 6; XW[s * 4 + 1] = (3 * t3 - 6 * t2 + 4) / 6; XW[s * 4 + 2] = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6; XW[s * 4 + 3] = t3 / 6; }
    else { XW[s * 4] = (-t3 + 2 * t2 - t) * 0.5; XW[s * 4 + 1] = (3 * t3 - 5 * t2 + 2) * 0.5; XW[s * 4 + 2] = (-3 * t3 + 4 * t2 + t) * 0.5; XW[s * 4 + 3] = (t3 - t2) * 0.5; }
  }
  const ivr = 1 / R;
  for (let r = 0; r < ny; r++) {
    const v = (Y0 + (r + 0.5) * ivr) / sc - 0.5, j = Math.floor(v), t = v - j, t2 = t * t, t3 = t2 * t;
    const m = 1 - t, w0 = bs ? m * m * m / 6 : (-t3 + 2 * t2 - t) * 0.5, w1 = bs ? (3 * t3 - 6 * t2 + 4) / 6 : (3 * t3 - 5 * t2 + 2) * 0.5, w2 = bs ? (-3 * t3 + 3 * t2 + 3 * t + 1) / 6 : (-3 * t3 + 4 * t2 + t) * 0.5, w3 = bs ? t3 / 6 : (t3 - t2) * 0.5;
    let j0 = j - 1, j1 = j, j2 = j + 1, j3 = j + 2;
    if (wy) { j0 = ((j0 % th) + th) % th; j1 = ((j1 % th) + th) % th; j2 = ((j2 % th) + th) % th; j3 = ((j3 % th) + th) % th; }
    else { const m = th - 1; j0 = j0 < 0 ? 0 : j0 > m ? m : j0; j1 = j1 < 0 ? 0 : j1 > m ? m : j1; j2 = j2 < 0 ? 0 : j2 > m ? m : j2; j3 = j3 < 0 ? 0 : j3 > m ? m : j3; }
    const o0 = j0 * tw, o1 = j1 * tw, o2 = j2 * tw, o3 = j3 * tw;
    for (let c = 0; c < nc; c++) { const x = CX[c]; COL[c] = w0 * src[o0 + x] + w1 * src[o1 + x] + w2 * src[o2 + x] + w3 * src[o3 + x]; }
    const ro = r * nx;
    for (let s = 0; s < nx; s++) { const i = XI[s], q = s * 4; out[ro + s] = XW[q] * COL[i] + XW[q + 1] * COL[i + 1] + XW[q + 2] * COL[i + 2] + XW[q + 3] * COL[i + 3]; }
  }
}

// land biome with the largest bilinear weight among the 4 texels around (jx, jy) map px; 0 if all are sea
function softBiome(tB, jx, jy) {
  const u = jx * 0.25 - 0.5, v = jy * 0.25 - 0.5, i = Math.floor(u), j = Math.floor(v), a = u - i, c = v - j;
  const i0 = i < 0 ? i + TW : i >= TW ? i - TW : i, i1 = i0 + 1 >= TW ? 0 : i0 + 1;
  const j0 = j < 0 ? 0 : j >= TH ? TH - 1 : j, j1 = j + 1 >= TH ? TH - 1 : j + 1 < 0 ? 0 : j + 1;
  const b0 = tB[j0 * TW + i0], b1 = tB[j0 * TW + i1], b2 = tB[j1 * TW + i0], b3 = tB[j1 * TW + i1];
  if (b0 === b1 && b0 === b2 && b0 === b3) return b0;
  const w0 = (1 - a) * (1 - c), w1 = a * (1 - c), w2 = (1 - a) * c, w3 = a * c;
  let best = 0, bw = -1, t;
  if (b0 > 1) { t = w0 + (b1 === b0 ? w1 : 0) + (b2 === b0 ? w2 : 0) + (b3 === b0 ? w3 : 0); if (t > bw) { bw = t; best = b0; } }
  if (b1 > 1 && b1 !== b0) { t = w1 + (b2 === b1 ? w2 : 0) + (b3 === b1 ? w3 : 0); if (t > bw) { bw = t; best = b1; } }
  if (b2 > 1 && b2 !== b0 && b2 !== b1) { t = w2 + (b3 === b2 ? w3 : 0); if (t > bw) { bw = t; best = b2; } }
  if (b3 > 1 && b3 !== b0 && b3 !== b1 && b3 !== b2 && w3 > bw) best = b3;
  return best;
}
// ---- the terrain shader ----
let PSZ = 0, PES, PEB, PTT, PNF, PJ1, PJ2;
function paintRegion(buf, bw, bo, X0, Y0, nx, ny, R) {
  if (!NZF) initNoise();
  const pw = nx + 2, ph = ny + 2, inv = 1 / R, mX = X0 - inv, mY = Y0 - inv;
  if (PSZ < pw * ph) { PSZ = pw * ph; PES = new Float32Array(PSZ); PEB = new Float32Array(PSZ); PTT = new Float32Array(PSZ); PNF = new Float32Array(PSZ); PJ1 = new Float32Array(PSZ); PJ2 = new Float32Array(PSZ); }
  const ES = PES, EB = PEB, TP = PTT, NF = PNF, J1 = PJ1, J2 = PJ2;
  crPatch(WORLD.tElev, TW, TH, 4, false, mX, mY, pw, ph, R, ES);
  crPatch(WORLD.tElev, TW, TH, 4, false, mX, mY, pw, ph, R, EB, true);
  crPatch(WORLD.tT, TW, TH, 4, false, mX, mY, pw, ph, R, TP);
  crPatch(NZF, NT, NT, 1, true, mX, mY, pw, ph, R, NF);
  crPatch(NZF, NT, NT, 1, true, mX + 173, mY + 291, pw, ph, R, J1);
  crPatch(NZF, NT, NT, 1, true, mX + 331, mY + 67, pw, ph, R, J2);
  const tB = WORLD.tBiome, F0 = WORLD.forest0, SF = S.forest, SFA = S.farm, SSM = S.smog, mtn = WORLD.mtn;
  const rise = S.seaRise, tan = S.tanom, hr = 0.5 * R, wm = buf === M32, bwd = R === 1 ? 1 : 0.6, LD = LMASK.d, R2 = R * R;
  let lci = -1, fr = 1, farm = 0, smog = 0;
  for (let sy = 1; sy <= ny; sy++) {
    const fy = mY + (sy + 0.5) * inv, myi = Math.floor(fy), cyi = clamp(myi >> 4, 0, H - 1);
    const amp = AMP_TEX[clamp(Math.floor(fy * 0.25), 0, TH - 1)];
    const rowB = bo + (sy - 1) * bw, rowW = myi * MW, rowL = (myi >> 1) * (MW >> 1);
    for (let sx = 1; sx <= nx; sx++) {
      const o = sy * pw + sx;
      let fx = mX + (sx + 0.5) * inv; if (fx < 0) fx += MW; else if (fx >= MW) fx -= MW;
      const mxi = fx | 0, ci = cyi * W + (mxi >> 4);
      if (ci !== lci) { lci = ci; const f0 = F0[ci]; fr = f0 > 0.01 ? Math.min(1, SF[ci] / f0) : 1; farm = SFA[ci]; smog = SSM[ci]; }
      const es = ES[o], nf = NF[o];
      const gxs = (ES[o + 1] - ES[o - 1]) * hr, gys = (ES[o + pw] - ES[o - pw]) * hr;
      const gm = Math.sqrt(gxs * gxs + gys * gys) + 1e-5;
      let sd = (es - rise) / gm; sd = sd > 40 ? 40 : sd < -40 ? -40 : sd; sd += nf * 1.35;
      let cov = sd * R + 0.5; cov = cov < 0 ? 0 : cov > 1 ? 1 : cov;
      const T = TP[o] + tan * amp, ncv = NZC[(myi & NTM) * NT + (mxi & NTM)];
      // relief normal: B-spline-smoothed surface (hides texel-scale steps) with some interpolating detail, plus fine
      // noise and ridged crests (along the noise zero-lines) on high ground; snow and ice sheets are smoother still
      const cold = T < -3 ? Math.min(1, (-3 - T) * 0.25) : 0, dk = 0.35 * (1 - cold);
      const bxs = (EB[o + 1] - EB[o - 1]) * hr, bys = (EB[o + pw] - EB[o - pw]) * hr, sgx = bxs + (gxs - bxs) * dk, sgy = bys + (gys - bys) * dk;
      const rs = 1 - 0.82 * cold * (es > mtn ? Math.max(0, 1 - (es - mtn) * 5) : 1), ra = es > 0 ? (0.002 + es * 0.03) * (1 - 0.7 * cold) - (es > 0.1 ? (nf > 0 ? 1 : -1) * Math.min(0.07, (es - 0.1) * 0.16) * (1 - cold) : 0) : 0.0012, K = (es > 0 ? 30 + es * 34 : 30) * rs;
      const nxv = -(sgx + (NF[o + 1] - NF[o - 1]) * hr * ra) * K, nyv = -(sgy + (NF[o + pw] - NF[o - pw]) * hr * ra) * K;
      // slopes steeper than ~58° (terraformed cliffs, texel-scale steps) are clamped so they shade like steep ground
      let nm = nxv * nxv + nyv * nyv, nf2 = 1; if (nm > 2.56) { nf2 = 1.6 / Math.sqrt(nm); nm = 2.56; }
      let sh = ((nxv + nyv) * nf2 * LXY + LZ) / (Math.sqrt(nm + 1) * LZ);
      sh = sh < 0.3 ? 0.3 : sh > 1.5 ? 1.5 : sh;
      let ao = (EB[o + 1] + EB[o - 1] + EB[o + pw] + EB[o - pw] - 4 * EB[o]) * R2 * 300; ao = es > 0 ? 1 - (ao > 0.16 ? 0.16 : ao < -0.08 ? -0.08 : ao) * rs : 1;
      let r = 0, g = 0, b = 0;
      if (cov > 0) {
        // biome: soft categorical interpolation of the 4 nearest texels at a noise-jittered position → organic boundaries
        let jx = fx + J1[o] * 2.6, jy = fy + J2[o] * 2.6, bio = 0;
        for (let k = 0; k < 3 && bio <= 1; k++) { bio = softBiome(tB, jx, jy); jx += gxs / gm * 4; jy += gys / gm * 4; }
        if (bio <= 1) bio = B.GRASS;
        if (bio === B.ICE && T > -9.5 + nf * 1.6) bio = B.TUNDRA;
        const c0 = MG[bio], c1 = MF[bio];
        r = c0[0]; g = c0[1]; b = c0[2];
        if (bio === B.MOUNTAIN) { const k = clamp((es - mtn) * 3, 0, 1) * 0.8 + nf * 0.12; r += (152 - r) * k; g += (148 - g) * k; b += (144 - b) * k; }
        else if (bio === B.DESERT) { const du = Math.sin(fx * 0.8 + fy * 0.3 + ncv * 10 + nf * 2); const k = 1 + du * 0.045; r *= k; g *= k; b *= k * 0.98; }
        else if (bio === B.ICE) { const k = 1 + nf * 0.04; r *= k; g *= k; }
        if (BIOME_FOREST[bio] > 0.5) { const k = 0.45 * fr; r = (r + (c1[0] - r) * k) * 0.94; g = (g + (c1[1] - g) * k) * 0.94; b = (b + (c1[2] - b) * k) * 0.94; }
        const vv = 1 + ncv * 0.07 + nf * 0.035; r *= vv; g *= vv; b *= vv;
        // beaches: a band of ~1–2.5 map px along gentle, temperate shores
        if (sd < 3 && T > -2 && bio !== B.MOUNTAIN && bio !== B.ICE && gm < 0.035) {
          const bwid = 1.2 + (ncv + 1) * 0.75, bk = clamp((bwid - sd) / 0.8, 0, 1);
          if (bk > 0) { const wet = clamp(1 - sd * 1.6, 0, 1), sr = 228 - wet * 30, sg = 212 - wet * 28, sb = 160 - wet * 22; r += (sr - r) * bk; g += (sg - g) * bk; b += (sb - b) * bk; }
        }
        // snow cover by temperature
        let sn = 0;
        if (bio !== B.ICE) { sn = clamp((-3.4 - T - nf * 2.6) / 2.2, 0, 1); if (sn > 0) { r += (240 - r) * sn; g += (245 - g) * sn; b += (251 - b) * sn; } }
        let lit = bio === B.ICE || sn > 0.5 ? 0.56 + 0.44 * sh : 0.26 + 0.74 * sh;
        if (R > 1) { const mt = NZF[((fy * 4) & NTM) * NT + ((fx * 4) & NTM)] + ((hash2(fx * 16, fy * 16) & 255) - 128) * 0.0016; lit *= 1 + mt * (bio === B.DESERT || bio === B.ICE ? 0.04 : 0.09); }
        // fields
        let field = false;
        if (farm > 0.04 && sn < 0.3 && FARMABLE[bio]) {
          const p8 = Math.floor(fx * 0.125), q8 = Math.floor(fy * 0.125), hp = hash2(p8, q8 + 9001);
          if ((hp & 255) / 255 < farm * 0.85) {
            field = true;
            const lx = fx - p8 * 8, ly = fy - q8 * 8, kind = ((hp >>> 8) & 7) % 6, half = (hp >>> 12) & 3;
            const edge = lx < bwd || ly < bwd || (half === 1 && ly >= 4 && ly < 4 + bwd * 0.7) || (half === 2 && lx >= 4 && lx < 4 + bwd * 0.7);
            if (edge) { r = 138; g = 124; b = 84; }
            else {
              const cc = CROPS[(kind + (half && (half === 1 ? ly >= 4 : lx >= 4) ? 3 : 0)) % 6], row = Math.floor((kind & 1) ? lx * 1.0 : ly) & 1, k = (row ? 1 : 0.86) * (0.95 + ((hp >>> 16) & 15) * 0.007);
              r = cc[0] * k; g = cc[1] * k; b = cc[2] * k;
            }
            lit = 0.55 + 0.45 * sh;
          }
        }
        // trees: jittered grid of canopies with lit crowns and soft south-east shadows
        let tc = 0, tlx = 0, tly = 0, trt = 1, ths = 0, shad = false;
        if (!field && sn < 0.9) {
          const tcov = fr * TREE_COV[bio];
          if (tcov > 0.01) {
            const sp = bio === B.JUNGLE ? 3 : 4, gw = MW / sp, gx0 = Math.floor(fx / sp), gy0 = Math.floor(fy / sp), lx = fx - gx0 * sp, ly = fy - gy0 * sp;
            const conif = bio === B.TAIGA || bio === B.MOUNTAIN;
            let best = -1e9;
            for (let gy = gy0 - (ly < 1.7 ? 1 : 0); gy <= gy0 + (ly > sp - 0.9 ? 1 : 0); gy++) for (let gx = gx0 - (lx < 1.7 ? 1 : 0); gx <= gx0 + (lx > sp - 0.9 ? 1 : 0); gx++) {
              const hs = hash2((gx < 0 ? gx + gw : gx >= gw ? gx - gw : gx) * 3 + 1, gy * 5 + 7);
              if ((hs & 255) / 255 >= tcov) continue;
              const cx = gx * sp + sp * 0.5 + (((hs >>> 8) & 255) / 255 - 0.5) * (sp - 2), cy = gy * sp + sp * 0.5 + (((hs >>> 16) & 255) / 255 - 0.5) * (sp - 2);
              const rt = (sp === 3 ? 1.22 : 1.3) + ((hs >>> 24) & 7) * 0.06, dx = fx - cx, dy = fy - cy;
              const inC = conif ? (dy > -rt * 1.3 && dy < rt * 0.85 && Math.abs(dx) < (dy + rt * 1.3) * 0.42) : dx * dx + dy * dy < rt * rt;
              if (inC) { if (cy > best) { best = cy; tc = 1; tlx = dx; tly = dy; trt = rt; ths = hs; } }
              else { const ex = dx - 0.8, ey = dy - 0.7; if (ex * ex + ey * ey < rt * rt * (conif ? 0.55 : 0.9)) shad = true; }
            }
            if (tc) {
              const vk = 0.86 + ((ths >>> 4) & 15) * 0.018;
              let br = conif ? 0.9 - tlx / trt * 0.32 - (tly + trt) / trt * 0.06 : 0.9 - (tlx + tly) / trt * 0.2 - (tlx * tlx + tly * tly) / (trt * trt) * 0.16;
              br *= vk * (0.62 + 0.38 * sh);
              r = c1[0] * br; g = c1[1] * br; b = c1[2] * br;
              if (sn > 0) { const k = sn * 0.55; r += (236 - r) * k; g += (242 - g) * k; b += (248 - b) * k; }
              lit = 1;
            } else if (shad) { r *= 0.64; g *= 0.68; b *= 0.74; }
          }
        }
        if (smog > 0.15) { const k = Math.min(0.5, smog * 0.6) * (0.7 + nf * 0.5); r += (96 - r) * k; g += (88 - g) * k; b += (76 - b) * k; }
        lit *= ao; r *= lit; g *= lit; b *= lit;
        if (lit < 1 && (bio === B.ICE || sn > 0.3)) { const q = (1 - lit) * 0.5; r *= 1 - q * 0.35; g *= 1 - q * 0.1; b *= 1 + q * 0.5; }
      }
      if (cov < 1) {
        // water: continuous depth ramp, sunlit seabed in the shallows, turquoise rim, broken surf line, sea ice
        const d = rise - es;
        let k = d > 0 ? Math.sqrt(d) : 0; k = k > 1 ? 255 : (k * 255) | 0;
        const vw = 1 + ncv * (k > 120 ? 0.035 : 0.06) + nf * 0.012;
        let wr = WLUT[k * 3] * vw, wg = WLUT[k * 3 + 1] * vw, wb = WLUT[k * 3 + 2] * vw;
        if (d < 0.1) { const q = 1 + (sh - 1) * 0.5 * (1 - d * 10); wr *= q; wg *= q; wb *= q; }
        if (sd > -5) {
          const q = (sd + 5) * 0.2, q2 = q * q * 0.28; wr += (150 - wr) * q2; wg += (222 - wg) * q2; wb += (216 - wb) * q2;
          if (sd > -1.4) { const f = (sd + 1.4) / 1.4, fo = f * f * clamp(0.35 + J1[o] * 1.6, 0, 1) * 0.8; wr += (238 - wr) * fo; wg += (248 - wg) * fo; wb += (250 - wb) * fo; }
        }
        const ib = (-5.6 - T) * 0.42 + nf * 0.3 + iceNoise(mxi, myi);
        if (ib > -0.9) {
          // pack ice: solid sheet in the cold, broken floes with dark leads toward a ragged margin
          const fl = (ib - 0.5 + J1[o] * 0.7 + J2[o] * 0.35 + ncv * 0.25) * 2.6 * (R > 1 ? 1.5 : 1) + 0.5, ik = (fl <= 0 ? 0 : fl >= 1 ? 1 : fl) * (0.95 + ncv * 0.04);
          if (ib > -0.5 && ik < 1) { const q = Math.min(1, (ib + 0.5) * 0.4); wr *= 1 - q * 0.28; wg *= 1 - q * 0.18; wb *= 1 - q * 0.1; }
          if (ik > 0) {
            const ed = ik < 1 ? 1 + (1 - ik) * 0.05 : 1, dr = 1 + nf * 0.035 + J1[o] * 0.02;
            let ir = 214 * dr * ed, ig = 228 * dr * ed, ibl = 240 * (1 + nf * 0.015);
            // refrozen leads: a faint crack network along the fine-noise zero lines, denser toward the margin
            const cw = 0.03 + (1 - ik) * 0.05 + (ib < 1.4 ? 0.02 : 0), ca = J2[o] < 0 ? -J2[o] : J2[o];
            if (ca < cw) { const q = (1 - ca / cw) * (ib < 1.6 ? 0.22 : 0.12); ir *= 1 - q * 0.45; ig *= 1 - q * 0.3; ibl *= 1 - q * 0.14; }
            wr += (ir - wr) * ik; wg += (ig - wg) * ik; wb += (ibl - wb) * ik;
          }
        }
        if (cov > 0) { r = wr + (r - wr) * cov; g = wg + (g - wg) * cov; b = wb + (b - wb) * cov; } else { r = wr; g = wg; b = wb; }
      }
      if (wm) { MWATER[rowW + mxi] = cov < 0.5 ? 1 : 0; const li = rowL + (mxi >> 1), v = (1 - cov) * 63.75; if (mxi & 1 || myi & 1) LD[li] += v; else LD[li] = v; }
      buf[rowB + sx - 1] = 0xff000000 | ((b > 255 ? 255 : b < 0 ? 0 : b | 0) << 16) | ((g > 255 ? 255 : g < 0 ? 0 : g | 0) << 8) | (r > 255 ? 255 : r < 0 ? 0 : r | 0);
    }
  }
}
function paintMapCell(ci) { const cy = (ci / W) | 0, cx = ci - cy * W; paintRegion(M32, MW, cy * PX * MW + cx * PX, cx * PX, cy * PX, PX, PX, 1); }
function paintMapAll() {
  MDIRTY.fill(0); mdirtyList = []; tilesClear();
  for (let y = 0; y < MH; y += 64) for (let x = 0; x < MW; x += 128) paintRegion(M32, MW, y * MW + x, x, y, 128, 64, 1);
  for (let i = 0; i < N; i++) wmaskCell(i);
  CCLS.fill(0); CPOLY.fill(null);
  mctx.putImageData(mapImg, 0, 0); polarDirty = true;
}
// repaint dirty cells within a time budget (cells on screen first; the rest stay queued for the next flush), then
// upload one dirty band per touched cell row to the base bitmap
const FL_X0 = new Int16Array(H), FL_X1 = new Int16Array(H);
function flushMapDirty() {
  let list = mdirtyList; mdirtyList = [];
  const t0 = performance.now(), budget = list.length > 300 ? 45 : 8;   // a big backlog (view switch, fast-forward) clears in ~1 s
  if (list.length > 256 && viewMode === 'map') {
    const hw = view.w / 2 / cam.z + PX, hh = view.h / 2 / cam.z + PX, vis = [], rest = [];
    for (const i of list) { const cy = (i / W) | 0, cx = i - cy * W; (Math.abs(wrapDx((cx + 0.5) * PX - cam.x)) < hw && Math.abs((cy + 0.5) * PX - cam.y) < hh ? vis : rest).push(i); }
    list = vis.concat(rest);
  }
  FL_X0.fill(W); FL_X1.fill(-1);
  let n = 0;
  for (; n < list.length; n++) {
    if (n >= 48 && (n & 15) === 0 && performance.now() - t0 > budget) break;
    const i = list[n], cy = (i / W) | 0, cx = i - cy * W;
    MDIRTY[i] = 0; paintMapCell(i); wmaskCell(i); coastInvalidate(i); tileDirtyCell(i);
    if (cy < 2 || cy >= H - 2) polarDirty = true;
    if (cx < FL_X0[cy]) FL_X0[cy] = cx; if (cx > FL_X1[cy]) FL_X1[cy] = cx;
  }
  if (n < list.length) mdirtyList = list.slice(n).concat(mdirtyList);
  for (let cy = 0; cy < H; cy++) {
    const a = FL_X0[cy], w = FL_X1[cy] - a + 1; if (w <= 0) continue;
    mctx.putImageData(mapImg, 0, 0, a * PX, cy * PX, w * PX, PX);
  }
}

/* ---- hi-res detail tiles: 64 map px squares rendered at R samples per map px (+1 sample margin for seamless
   filtering), painted progressively within a per-frame time budget, LRU-cached ---- */
const TILE = 64, TILES = new Map(), TIMG = new Map();
let tileUse = 0;
function tilesClear() { TILES.clear(); }
function tileImg(w, h) { const k = w * 4096 + h; let im = TIMG.get(k); if (!im) { im = mctx.createImageData(w, h); im.u32 = new Uint32Array(im.data.buffer); TIMG.set(k, im); } return im; }
function tileGet(tx, ty, R, make) {
  const k = (R * 32 + ty) * 64 + tx; let t = TILES.get(k);
  if (!t && make) {
    const n = TILE * R + 2, cv = document.createElement('canvas'); cv.width = cv.height = n;
    t = { k, tx, ty, R, n, cv, cx: cv.getContext('2d'), row: 0, ready: false, t0: 0, used: 0, dirty: [] };
    TILES.set(k, t);
  }
  return t;
}
function tileDirtyCell(ci) {
  if (!TILES.size) return;
  const cy = (ci / W) | 0, cx = ci - cy * W, tx = cx >> 2, ty = cy >> 2;
  for (let R = 2; R <= 4; R += 2) { const t = tileGet(tx, ty, R, false); if (!t) continue; if (t.ready) { if (!t.dirty.includes(ci)) t.dirty.push(ci); } else t.row = Math.min(t.row, ((cy & 3) * PX) * R); }
}
// paint one step of tile t (a band of rows, or one dirty cell); returns false when nothing is left to do
function tileStep(t) {
  const R = t.R, n = t.n, inv = 1 / R, X0 = t.tx * TILE - inv, Y0 = t.ty * TILE - inv;
  if (!t.ready) {
    const rows = Math.min(n - t.row, 8 * R), im = tileImg(n, rows);
    paintRegion(im.u32, n, 0, X0, Y0 + t.row * inv, n, rows, R);
    t.cx.putImageData(im, 0, t.row); t.row += rows;
    if (t.row >= n) { t.ready = true; t.t0 = animT; }
    return true;
  }
  if (!t.dirty.length) return false;
  const ci = t.dirty.shift(), cy = (ci / W) | 0, cx = ci - cy * W, s = PX * R + 2, ox = ((cx & 3) * PX) * R, oy = ((cy & 3) * PX) * R, im = tileImg(s, s);
  paintRegion(im.u32, s, 0, X0 + ox * inv, Y0 + oy * inv, s, s, R);
  t.cx.putImageData(im, ox, oy);
  return true;
}
// run tile work for up to ms milliseconds, nearest-first; evict least-recently-used tiles beyond the cap
function tilesWork(list, ms) {
  const t0 = performance.now();
  for (const t of list) { while (tileStep(t)) { if (performance.now() - t0 > ms) return; } }
}
function tilesEvict(cap) {
  if (TILES.size <= cap) return;
  const arr = [...TILES.values()].sort((a, b) => a.used - b.used);
  for (let k = 0; k < arr.length - cap; k++) TILES.delete(arr[k].k);
}
